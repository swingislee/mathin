begin;
create table public.miniapp_remote_bookings (
  id uuid primary key, owner_id uuid not null references public.profiles(id), service_id text not null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  request_hash text not null, snapshot jsonb not null, result jsonb,
  check(octet_length(snapshot::text)<=262144), check(result is null or octet_length(result::text)<=32768)
);
create index miniapp_remote_bookings_owner on public.miniapp_remote_bookings(owner_id,created_at desc);
alter table public.miniapp_remote_bookings enable row level security;
revoke all on public.miniapp_remote_bookings from public,anon,authenticated;
create function public.miniapp_assert_experience_participants(p_ids uuid[]) returns void
language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
  if not coalesce(mathin_internal.experience_audience('signedIn'),false) then raise exception 'FORBIDDEN'; end if;
  if p_ids is null or cardinality(p_ids)>10 or cardinality(p_ids)<>(select count(distinct id) from unnest(p_ids) id)
    or exists(select 1 from unnest(p_ids) id where not coalesce(public.miniapp_can_participate(id),false)) then raise exception 'FORBIDDEN'; end if;
end $$;
create function public.miniapp_remote_bookings_read(p_id uuid default null,p_page integer default 1) returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
  if not coalesce(mathin_internal.experience_audience('signedIn'),false) then raise exception 'FORBIDDEN'; end if;
  if p_page is null or p_page not between 1 and 1000 then raise exception 'VALIDATION'; end if;
  return coalesce((select jsonb_agg(to_jsonb(r)-'owner_id'-'request_hash') from
    (select * from miniapp_remote_bookings where owner_id=auth.uid() and (p_id is null or id=p_id) order by created_at desc limit 30 offset (p_page-1)*30) r),'[]');
end $$;
-- This ledger is written only by the trusted server after user, form and provider checks.
create function public.miniapp_remote_booking_reserve(p_id uuid,p_owner uuid,p_service_id text,p_hash text,p_snapshot jsonb,p_limit integer) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.miniapp_remote_bookings;
begin
  if p_id is null or p_owner is null or p_service_id is null or p_hash is null or jsonb_typeof(p_snapshot)<>'object' or p_limit not between 1 and 1000 then raise exception 'VALIDATION'; end if;
  perform pg_advisory_xact_lock(hashtextextended('remote-booking-owner:'||p_owner::text,914));
  select * into r from miniapp_remote_bookings where id=p_id;
  if r.id is not null then
    if r.owner_id<>p_owner or r.request_hash<>p_hash then raise exception 'CONFLICT'; end if;
    return to_jsonb(r)-'owner_id'-'request_hash';
  end if;
  if (select count(*) from miniapp_remote_bookings where owner_id=p_owner and created_at>now()-interval '1 minute')>=10 then raise exception 'RATE_LIMIT'; end if;
  if (select count(*) from miniapp_remote_bookings where owner_id=p_owner and service_id=p_service_id and coalesce(result->>'status','requested') not in ('cancelled','completed','noShow'))>=p_limit then raise exception 'BOOKING_CLOSED'; end if;
  insert into miniapp_remote_bookings(id,owner_id,service_id,request_hash,snapshot) values(p_id,p_owner,p_service_id,p_hash,p_snapshot) returning * into r;
  return to_jsonb(r)-'owner_id'-'request_hash';
end $$;
create function public.miniapp_remote_booking_store(p_id uuid,p_owner uuid,p_result jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.miniapp_remote_bookings;
begin
  if jsonb_typeof(p_result) is distinct from 'object' or (p_result->>'version')::bigint is null or (p_result->>'version')::bigint<1
    or p_result->>'status' is null or p_result->>'status' not in ('requested','confirmed','cancelled','completed','noShow','waitlisted') then raise exception 'VALIDATION'; end if;
  select * into r from miniapp_remote_bookings where id=p_id and owner_id=p_owner for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if p_result->>'actor' is distinct from r.snapshot->>'actor' or r.result is not null and p_result->>'id' is distinct from r.result->>'id' then raise exception 'CONFLICT'; end if;
  if r.result is not null and (r.result->>'version')::bigint=(p_result->>'version')::bigint and r.result<>p_result then raise exception 'CONFLICT'; end if;
  if r.result is null or (p_result->>'version')::bigint>(r.result->>'version')::bigint then
    update miniapp_remote_bookings set result=p_result,updated_at=now() where id=p_id returning * into r;
  end if;
  return to_jsonb(r)-'owner_id'-'request_hash';
end $$;
do $copy$ begin
  execute replace(pg_get_functiondef('public.can_access_miniapp_content_image(text,boolean)'::regprocedure),
    'public.can_access_miniapp_content_image(', 'mathin_internal.can_access_miniapp_content_image_before_remote(');
end $copy$;
create or replace function public.can_access_miniapp_content_image(p_path text,p_write boolean default false) returns boolean
language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
  if mathin_internal.can_access_miniapp_content_image_before_remote(p_path,p_write) then return true; end if;
  if p_write is distinct from false or not coalesce(mathin_internal.experience_audience('signedIn'),false)
    or p_path is null or p_path !~ '^[0-9a-f-]{36}(\.thumb)?\.webp$' then return false; end if;
  return exists(select 1 from miniapp_remote_bookings r where r.owner_id=auth.uid()
    and replace(p_path,'.thumb.webp','.webp') in(select * from mathin_internal.experience_images(r.snapshot->'confirmation')));
end $$;
revoke all on function mathin_internal.can_access_miniapp_content_image_before_remote(text,boolean) from public,anon,authenticated;
revoke all on function public.miniapp_assert_experience_participants(uuid[]),public.miniapp_remote_bookings_read(uuid,integer),
  public.miniapp_remote_booking_reserve(uuid,uuid,text,text,jsonb,integer),public.miniapp_remote_booking_store(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.miniapp_assert_experience_participants(uuid[]),public.miniapp_remote_bookings_read(uuid,integer) to authenticated;
grant execute on function public.miniapp_remote_booking_reserve(uuid,uuid,text,text,jsonb,integer),public.miniapp_remote_booking_store(uuid,uuid,jsonb) to service_role;
notify pgrst,'reload schema';
commit;
