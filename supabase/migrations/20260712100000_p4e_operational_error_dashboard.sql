-- P4E-V3：内建服务端错误看板。写入仅 service role，员工只按 audit.view 只读。
create table public.operational_errors (
  id uuid primary key default gen_random_uuid(),
  occurred_at timestamptz not null default now(),
  level text not null default 'error' check(level in ('warning','error','critical')),
  event text not null default 'request.error' check(length(event) between 1 and 100),
  message text not null check(length(message) between 1 and 2000),
  digest text check(digest is null or length(digest)<=200),
  path text check(path is null or length(path)<=500),
  method text check(method is null or length(method)<=20),
  router_kind text check(router_kind is null or length(router_kind)<=50),
  route_path text check(route_path is null or length(route_path)<=500),
  route_type text check(route_type is null or length(route_type)<=50),
  environment text check(environment is null or length(environment)<=50),
  release text check(release is null or length(release)<=100)
);
create index operational_errors_recent_idx on public.operational_errors(occurred_at desc);
create index operational_errors_digest_idx on public.operational_errors(digest,occurred_at desc) where digest is not null;

create function public.guard_operational_errors_immutable() returns trigger
language plpgsql set search_path=public,pg_temp as $$
begin raise exception 'OPERATIONAL_ERRORS_APPEND_ONLY'; end $$;
create trigger operational_errors_immutable before update or delete on public.operational_errors
for each row execute function public.guard_operational_errors_immutable();

alter table public.operational_errors enable row level security;
create policy operational_errors_audit_read on public.operational_errors for select to authenticated
using(public.has_perm((select auth.uid()),'audit.view'));

revoke all on public.operational_errors from anon,authenticated;
grant select on public.operational_errors to authenticated;
