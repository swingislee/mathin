-- 一次归集当前行的参与人和组别，复用同一集合生成展示与范围标记。
-- 全量名单的字段筛选会读取每行投影，避免在同一行重复遍历来源与参与经历。
create or replace function public.school_subject_participant_rows(p_student_id uuid,p_lead_id uuid)
returns setof public.school_subject_participants
language sql stable security definer set search_path=public,pg_temp as $$
  with subject as materialized (select coalesce(p_student_id,(select student_id from public.leads where id=p_lead_id)) as sid),
  refs as materialized (select id from public.leads where id=p_lead_id or student_id=(select sid from subject))
  select p.* from public.school_subject_participants p where p.student_id=(select sid from subject)
  union all select p.* from refs join public.school_subject_participants p on p.lead_id=refs.id;
$$;

create or replace function public.school_subject_group_rows(p_student_id uuid,p_lead_id uuid)
returns setof public.school_business_groups
language sql stable security definer set search_path=public,pg_temp as $$
  with subject as materialized (select coalesce(p_student_id,(select student_id from public.leads where id=p_lead_id)) as sid),
  refs as materialized (select id from public.leads where id=p_lead_id or student_id=(select sid from subject)),
  group_ids as (
    select group_id from public.school_subject_groups g where g.student_id=(select sid from subject)
    union select g.group_id from refs join public.school_subject_groups g on g.lead_id=refs.id
    union select m.group_id from public.school_subject_participant_rows(p_student_id,p_lead_id) p
      join public.school_business_group_members m on m.user_id=p.user_id and m.removed_at is null
  ) select g.* from public.school_business_groups g where g.id in(select group_id from group_ids);
$$;

create or replace function public.school_collaboration_projection(p_student_id uuid,p_lead_id uuid,p_uid uuid)
returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
  with subject as materialized (
    select coalesce(p_student_id,(select student_id from public.leads where id=p_lead_id)) as sid
  ), refs as materialized (
    select id from public.leads where id=p_lead_id or student_id=(select sid from subject)
  ), participant_links as materialized (
    select p.* from public.school_subject_participants p where p.student_id=(select sid from subject)
    union all select p.* from refs join public.school_subject_participants p on p.lead_id=refs.id
  ), participants as materialized (
    select distinct p.user_id,profile.display_name,coalesce(r.business_role,p.business_role) as business_role
    from participant_links p join public.profiles profile on profile.id=p.user_id
      left join public.school_staff_business_roles r on r.user_id=p.user_id
  ), group_ids as materialized (
    select group_id from public.school_subject_groups g
      where g.student_id=(select sid from subject)
    union select g.group_id from refs join public.school_subject_groups g on g.lead_id=refs.id
    union select m.group_id from participants p join public.school_business_group_members m
      on m.user_id=p.user_id and m.removed_at is null
  ), groups as materialized (
    select id,name from public.school_business_groups where id in(select group_id from group_ids)
  ), actor as materialized (select public.is_staff(p_uid) as active)
  select jsonb_build_object(
    'participants',coalesce((select jsonb_agg(jsonb_build_object('userId',user_id,'name',display_name,'role',business_role) order by display_name,business_role) from participants),'[]'::jsonb),
    'groups',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name) order by name) from groups),'[]'::jsonb),
    'isParticipant',(select active from actor) and exists(select 1 from participants where user_id=p_uid),
    'inMyGroups',(select active from actor) and exists(select 1 from groups g join public.school_business_group_members m
      on m.group_id=g.id where m.user_id=p_uid and m.removed_at is null),
    'supportNames',coalesce((select string_agg(distinct display_name,'、' order by display_name) from participants where business_role='school_support'),''),
    'assessmentTeacherNames',coalesce((select string_agg(distinct display_name,'、' order by display_name) from participants where business_role in ('assessment_teacher','teacher')),'')
  );
$$;
