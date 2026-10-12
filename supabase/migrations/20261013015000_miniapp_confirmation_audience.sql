begin;
-- A completion document is read during submission as well as through the page API.
create function public.guard_miniapp_request_confirmation() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if new.confirmation_snapshot is not null and not coalesce(mathin_internal.experience_audience(new.confirmation_snapshot->>'audience'),false) then raise exception 'FORBIDDEN'; end if;
  return new;
end $$;
create trigger miniapp_request_confirmation_guard before insert on public.miniapp_experience_requests for each row execute function public.guard_miniapp_request_confirmation();
create or replace function mathin_internal.experience_request_json(r public.miniapp_experience_requests) returns jsonb
language sql stable set search_path=public,pg_temp as $$
  select jsonb_build_object('id',r.id,'serviceId',r.service_id,'serviceName',coalesce(r.service_snapshot->'name',r.form_snapshot->'title'),
    'formId',r.form_id,'createdAt',r.created_at,'status',r.status,'version',r.version,'note',r.note,'participantIds',to_jsonb(r.participant_ids),
    'form',r.form_snapshot,'answers',r.answers,'confirmation',r.confirmation_snapshot,
    'canCancel',r.status in ('submitted','confirmed') and coalesce(r.policy_snapshot->>'cancellation','self')='self',
    'completionAction',coalesce(r.flow_snapshot->'completionAction','{"kind":"none","target":"","label":{"zh":"","en":""}}'));
$$;
revoke all on function public.guard_miniapp_request_confirmation() from public,anon,authenticated;
notify pgrst,'reload schema';
commit;
