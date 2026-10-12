begin;
alter table public.assessment_reports add column miniapp_report_document jsonb;
alter table public.learning_result_revisions add column miniapp_report_document jsonb;
create function mathin_internal.miniapp_report_document(p_kind text) returns jsonb
language sql stable security definer set search_path=public,pg_temp as $$
  select p from miniapp_settings s cross join lateral jsonb_array_elements(s.published#>'{experience,reportBindings}') b
    cross join lateral jsonb_array_elements(s.published#>'{experience,pages}') p
  where s.singleton and b->'enabled'='true' and b->>'kind'=p_kind and b->>'serviceId'='' and p->>'id'=b->>'pageId' and p->'enabled'='true' limit 1;
$$;
create or replace function public.snapshot_miniapp_report_template() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if tg_table_name='assessment_reports' then
    new.miniapp_report_template:=public.miniapp_report_template('assessment');
    new.miniapp_report_document:=mathin_internal.miniapp_report_document('assessment');
  elsif exists(select 1 from learning_result_heads where id=new.head_id and kind='session_review') then
    new.miniapp_report_template:=public.miniapp_report_template('feedback');
    new.miniapp_report_document:=mathin_internal.miniapp_report_document('feedback');
  else new.miniapp_report_template:=null; new.miniapp_report_document:=null; end if;
  return new;
end $$;
alter function public.miniapp_assessment_reports() rename to miniapp_assessment_reports_before_content;
alter function public.miniapp_feedback_reports(timestamptz,timestamptz) rename to miniapp_feedback_reports_before_content;
revoke all on function public.miniapp_assessment_reports_before_content(),public.miniapp_feedback_reports_before_content(timestamptz,timestamptz) from public,anon,authenticated;
create function public.miniapp_assessment_reports() returns jsonb
language sql stable security definer set search_path=public,pg_temp as $$
  select coalesce(jsonb_agg(item||jsonb_build_object('contentDocument',p.miniapp_report_document,'reportData',jsonb_build_object(
    'assessmentBand',p.payload->'assessmentBand','assessedAt',p.payload->'assessedAt','gradeText',p.payload->'gradeText',
    'recordedByName',p.payload->'recordedByName','recommendedClass',p.payload->'recommendedClass')) order by ord),'[]')
  from jsonb_array_elements(public.miniapp_assessment_reports_before_content()) with ordinality rows(item,ord)
  join assessment_reports p on p.id=(item->>'id')::uuid;
$$;
create function public.miniapp_feedback_reports(p_from timestamptz,p_to timestamptz) returns jsonb
language sql stable security definer set search_path=public,pg_temp as $$
  select coalesce(jsonb_agg(item||jsonb_build_object('contentDocument',r.miniapp_report_document) order by ord),'[]')
  from jsonb_array_elements(public.miniapp_feedback_reports_before_content(p_from,p_to)) with ordinality rows(item,ord)
  join learning_result_heads h on h.kind='session_review' and h.session_id::text||':'||h.student_id::text=item->>'id' and h.status='published'
  join learning_result_revisions r on r.id=h.published_revision_id;
$$;
do $copy$ begin
  execute replace(pg_get_functiondef('public.can_access_miniapp_content_image(text,boolean)'::regprocedure),
    'public.can_access_miniapp_content_image(', 'mathin_internal.can_access_miniapp_content_image_before_snapshots(');
end $copy$;
create or replace function public.can_access_miniapp_content_image(p_path text,p_write boolean default false) returns boolean
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare base text;
begin
  if mathin_internal.can_access_miniapp_content_image_before_snapshots(p_path,p_write) then return true; end if;
  if p_write is distinct from false or not coalesce(mathin_internal.experience_audience('signedIn'),false)
    or p_path is null or p_path !~ '^[0-9a-f-]{36}(\.thumb)?\.webp$' then return false; end if;
  base:=replace(p_path,'.thumb.webp','.webp');
  return exists(select 1 from assessment_workflow_states w join assessment_reports p on p.id=w.sent_report_id and p.registration_id=w.registration_id
      join activity_registrations a on a.id=w.registration_id where w.sent_at is not null and public.miniapp_can_participate(a.student_id)
      and base in(select * from mathin_internal.experience_images(p.miniapp_report_document)))
    or exists(select 1 from learning_result_heads h join learning_result_revisions r on r.id=h.published_revision_id
      where h.kind='session_review' and h.status='published' and public.miniapp_can_participate(h.student_id)
      and base in(select * from mathin_internal.experience_images(r.miniapp_report_document)))
    or exists(select 1 from miniapp_experience_requests r where r.owner_id=auth.uid()
      and base in(select * from mathin_internal.experience_images(r.confirmation_snapshot)));
end $$;
revoke all on function mathin_internal.miniapp_report_document(text),mathin_internal.can_access_miniapp_content_image_before_snapshots(text,boolean),public.miniapp_assessment_reports(),public.miniapp_feedback_reports(timestamptz,timestamptz) from public,anon,authenticated;
grant execute on function public.miniapp_assessment_reports(),public.miniapp_feedback_reports(timestamptz,timestamptz) to authenticated;
notify pgrst,'reload schema';
commit;
