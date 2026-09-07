-- 测评统一工作表的只读排序键；各来源继续通过调用人的原表 RLS 读取。
-- 发生日按机构午夜参与比较，不用导入/更新时间补造测评日期。
create or replace view public.assessment_workbench_read_order
with (security_invoker = true) as
with registrations as (
  select r.id as registration_id, a.id as activity_id, a.kind, a.source_invitation_id,
    a.scheduled_at,
    coalesce(result.assessed_on, a.occurred_on) as occurred_on
  from public.activity_registrations r
  join public.activities a on a.id = r.activity_id
  left join public.assessment_results result on result.activity_registration_id = r.id
  where a.deleted_at is null and r.status <> 'cancelled'
), segments as (
  select 'segment:' || s.id::text || ':' || r.registration_id::text as id,
    r.registration_id, s.scheduled_at as assessment_at
  from registrations r
  join public.public_class_segments s on s.activity_id = r.activity_id and r.kind = 'public_class'
  left join public.public_class_participant_records record
    on record.segment_id = s.id and record.registration_id = r.registration_id
  where s.kind = 'group_assessment' or length(btrim(coalesce(record.assessment_summary, ''))) > 0
), rows as (
  select 'invitation:' || invitation.id::text as id, invitation.scheduled_at as assessment_at
  from public.lead_invitation_threads invitation
  join public.leads lead on lead.id = invitation.lead_id
  where invitation.kind = 'assessment_1v1' and invitation.state = 'confirmed'
    and invitation.scheduled_at is not null
    and not exists (select 1 from public.activities activity
      where activity.deleted_at is null and activity.source_invitation_id = invitation.id)
  union all
  select case when r.source_invitation_id is not null then 'invitation:' || r.source_invitation_id::text
      else 'registration:' || r.registration_id::text end,
    coalesce(r.scheduled_at, r.occurred_on::timestamp at time zone (select public.get_organization_timezone_v2()))
  from registrations r
  where not exists (select 1 from segments s where s.registration_id = r.registration_id)
  union all
  select s.id, s.assessment_at from segments s
)
select distinct id, assessment_at from rows;

comment on view public.assessment_workbench_read_order is
  '测评工作表来源行键与业务日期；Supabase 按 assessment_at desc nulls last, id 排序。无业务写入能力。';
revoke all on public.assessment_workbench_read_order from public, anon, authenticated;
grant select on public.assessment_workbench_read_order to authenticated;
