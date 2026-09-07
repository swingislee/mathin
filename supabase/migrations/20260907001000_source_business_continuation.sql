-- 对照原表时保留日期精度；确认学生与班级后使用现有分班动作。
do $$
declare definition text;
begin
  definition:=pg_get_functiondef('public.get_activity_enrollment_context(uuid,uuid)'::regprocedure);
  definition:=replace(definition,'''activityAt'',a.scheduled_at','''activityAt'',coalesce(a.scheduled_at::text,a.occurred_on::text,'''')');
  definition:=replace(definition,'ar.id is not null and r.status=''attended''','ar.id is not null and r.status=''attended'' and (ar.source_record_id is null or ar.assessment_band is not null or ar.score is not null or ar.strengths ~ ''(原测评等级|学习力测评等级)：'')');
  execute definition;
  definition:=pg_get_functiondef('public.ensure_assessment_report(uuid)'::regprocedure);
  definition:=replace(definition,'''totalScore'',pv.total_score','''totalScore'',case when ar.result_source=''teacher'' then pv.total_score else ar.score_max end');
  definition:=replace(definition,'''assessedAt'',coalesce(ar.result_finalized_at,r.assessment_completed_at,ar.updated_at,pr.updated_at)',
    '''assessedAt'',case when ar.source_record_id is not null and ar.result_source=''legacy'' then coalesce(ar.assessed_on::text,a.occurred_on::text) else coalesce(ar.result_finalized_at,r.assessment_completed_at,ar.updated_at,pr.updated_at)::text end');
  definition:=replace(definition,'(ar.result_source=''legacy'' and r.assessment_started_at is null)','(ar.result_source=''legacy'' and r.assessment_started_at is null and (ar.source_record_id is null or (r.status=''attended'' and (ar.assessment_band is not null or ar.score is not null or ar.strengths ~ ''(原测评等级|学习力测评等级)：''))))');
  execute definition;
end;
$$;

-- 由业务操作写入的来源行递增修订号，后续幂等导入保留这些人工版本。
create or replace function public.guard_business_record_state() returns trigger language plpgsql set search_path=public,pg_temp as $$
declare old_value jsonb;new_value jsonb;target uuid;linked uuid;
begin
  if tg_op='DELETE' then
    if old.source_record_id is not null then raise exception 'SOURCE_BUSINESS_RECORD_PROTECTED';end if;
    return old;
  end if;
  new_value:=to_jsonb(new);
  if tg_op='UPDATE' then
    old_value:=to_jsonb(old);
    if auth.uid() is not null and (old_value->'source_record_id',old_value->'source_field_ids',old_value->'history_key',old_value->'history_batch_id',old_value->'source_payload_sha256')
       is distinct from (new_value->'source_record_id',new_value->'source_field_ids',new_value->'history_key',new_value->'history_batch_id',new_value->'source_payload_sha256') then raise exception 'SOURCE_PROVENANCE_IMMUTABLE';end if;
  end if;
  if new.source_record_id is null then return new;end if;
  if tg_op='INSERT' and not(session_user in ('postgres','supabase_admin') and current_user='postgres' and auth.uid() is null) then raise exception 'SOURCE_IMPORT_REQUIRED';end if;
  target:=(new_value->>'student_id')::uuid;
  if auth.uid() is not null and target is not null and (tg_op='INSERT' or old_value->>'student_id' is distinct from new_value->>'student_id') then
    select coalesce(a.student_id,h.student_id,l.student_id) into linked from public.history_import_records h
      left join public.history_import_associations a on a.record_id=h.id left join public.leads l on l.id=h.lead_id where h.id=new.source_record_id;
    if linked is distinct from target and not exists(select 1 from public.leads l where l.id=(old_value->>'lead_id')::uuid and l.student_id=target) then raise exception 'SOURCE_ASSOCIATION_REQUIRED';end if;
  end if;
  if tg_op='UPDATE' and auth.uid() is not null and (new_value-'updated_at'-'history_revision') is distinct from (old_value-'updated_at'-'history_revision') then new.history_revision:=old.history_revision+1;end if;
  return new;
end;
$$;

create function public.prepare_source_enrollment(p_enrollment_id uuid,p_student_id uuid,p_classroom_id uuid) returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
declare enrollment public.course_enrollments;classroom public.classrooms;target uuid;opportunity uuid;membership uuid;
begin
  if auth.uid() is null then raise exception 'UNAUTHENTICATED';end if;
  if not public.has_perm(auth.uid(),'enrollment.manage') or not public.can_access_student(p_student_id,auth.uid()) then raise exception 'FORBIDDEN';end if;
  select * into enrollment from public.course_enrollments where id=p_enrollment_id for update;
  if enrollment.id is null or enrollment.source_record_id is null or enrollment.status<>'active' then raise exception 'ENROLLMENT_NOT_ACTIVE';end if;
  select coalesce(a.student_id,h.student_id) into target from public.history_import_records h left join public.history_import_associations a on a.record_id=h.id where h.id=enrollment.source_record_id;
  if target is distinct from p_student_id or (enrollment.student_id is not null and enrollment.student_id<>p_student_id) then raise exception 'SOURCE_ASSOCIATION_REQUIRED';end if;
  select * into classroom from public.classrooms where id=p_classroom_id for update;
  if classroom.id is null or classroom.trashed_at is not null or classroom.archived_at is not null or classroom.purpose<>'production'
    or classroom.offering_type<>'long_term_formal' or classroom.operational_status not in ('planning','active') then raise exception 'CLASS_NOT_AVAILABLE';end if;
  if not public.can_manage_classroom(classroom.id,auth.uid()) then raise exception 'FORBIDDEN_SCOPE';end if;
  if exists(select 1 from public.course_enrollments e where e.student_id=p_student_id and e.course_id=classroom.course_id and e.term_id=classroom.term_id and e.status='active' and e.id<>enrollment.id) then raise exception 'ALREADY_ENROLLED_FOR_COURSE';end if;
  if enrollment.course_id is not null and (enrollment.course_id<>classroom.course_id or enrollment.term_id<>classroom.term_id) then raise exception 'CLASS_TARGET_MISMATCH';end if;
  opportunity:=enrollment.opportunity_id;
  if opportunity is null then
    select id into opportunity from public.course_opportunities where student_id=p_student_id and opportunity_type='new' and course_id=classroom.course_id and term_id=classroom.term_id for update;
    if opportunity is null then
      insert into public.course_opportunities(student_id,opportunity_type,course_id,term_id,stage,owner_id,created_by,updated_by,note)
        values(p_student_id,'new',classroom.course_id,classroom.term_id,'enrolled',auth.uid(),auth.uid(),auth.uid(),'确认已有报名的学生与课程安排。') returning id into opportunity;
    else raise exception 'ALREADY_ENROLLED_FOR_COURSE';end if;
  end if;
  update public.course_enrollments set student_id=p_student_id,opportunity_id=opportunity,course_id=classroom.course_id,term_id=classroom.term_id,
    confirmed_by=coalesce(confirmed_by,auth.uid()),confirmed_at=coalesce(confirmed_at,clock_timestamp()) where id=enrollment.id;
  membership:=public.assign_course_enrollment(enrollment.id,classroom.id,'确认已有报名的分班安排。',clock_timestamp());
  return membership;
end;
$$;
revoke all on function public.prepare_source_enrollment(uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.prepare_source_enrollment(uuid,uuid,uuid) to authenticated;

create function public.get_business_source_records(p_ids text[]) returns table(id text,source_data jsonb,record_data jsonb)
language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
  if auth.uid() is null then raise exception 'UNAUTHENTICATED';end if;
  if not public.is_staff(auth.uid()) then raise exception 'FORBIDDEN';end if;
  if p_ids is null or cardinality(p_ids)>100 then raise exception 'VALIDATION';end if;
  return query select h.id,h.source_data,h.record_data from public.history_import_records h
    left join public.history_import_associations a on a.record_id=h.id where h.id=any(p_ids)
    and (public.can_confirm_history_source() or public.can_access_student(coalesce(a.student_id,h.student_id),auth.uid()));
end;
$$;
revoke all on function public.get_business_source_records(text[]) from public,anon,authenticated,service_role;
grant execute on function public.get_business_source_records(text[]) to authenticated;

-- 仅更新尚无人工联系记录的来源线索；归属和人工工作状态保持现有值。
update public.leads l set status=case contact.outcome when 'connected' then 'contacted' when 'declined' then 'nurture' when 'invalid_number' then 'invalid' else 'uncontacted' end
from (select distinct on(lead_id) lead_id,outcome from public.lead_communications where source_record_id is not null and outcome is not null
  order by lead_id,coalesce(occurred_at::date,occurred_on) desc nulls last,id desc) contact
where l.id=contact.lead_id and l.status='unassigned' and l.source_record_id is not null
  and not exists(select 1 from public.lead_communications manual where manual.lead_id=l.id and manual.source_record_id is null);

-- 修正本批默认到访类型的投影；仅处理本批自动生成且未人工修订的行。
create temp table source_visit_projection on commit drop as
select a.id,a.history_batch_id,a.source_record_id,a.source_field_ids,a.source_payload_sha256,
  coalesce((select c->>'text' from jsonb_array_elements(h.record_data->'cells') c where c->>'fieldName' in ('参与内容','选拔产品项目') and btrim(c->>'text')<>'' limit 1),'') content,
  exists(select 1 from jsonb_array_elements(h.record_data->'cells') c where c->>'fieldName' in ('思维测评等级','学习力测评等级','测评成绩（分数）') and btrim(c->>'text')<>'') result_present,
  exists(select 1 from jsonb_array_elements(h.record_data->'cells') c where c->>'fieldName'='学员出勤情况' and c->>'text'='出勤') attended
from public.activities a join public.history_import_records h on h.id=a.source_record_id
where a.history_key like 'operation-visit:%' and a.history_revision=0 and a.kind='assessment_1v1';
update public.activities a set kind='competition',title=p.content from source_visit_projection p where a.id=p.id and p.content in ('思闯','数独');
update public.activity_registrations r set status='attended' from source_visit_projection p where r.activity_id=p.id and p.attended and r.history_revision=0 and r.status='booked';


-- 思维等级与学习力等级各按原维度保存；备考/英语分数留在备注。
update public.assessment_results a set assessment_band=case upper(replace(btrim(coalesce(v.band,'')),'＋','+'))
  when 'A' then 'a' when 'A+' then 'a_plus' when 'S' then 's' when 'C' then 'c' when 'G+' then 'g_plus' when 'X+' then 'x_plus' else null end,
  score=null,strengths=concat_ws(E'\n',nullif(a.strengths,''),case when v.learning<>'' and position('学习力测评等级：'||v.learning in a.strengths)=0 then '学习力测评等级：'||v.learning end)
from (select h.id,
  (select c->>'text' from jsonb_array_elements(h.record_data->'cells') c where c->>'fieldName'='思维测评等级' limit 1) band,
  (select c->>'text' from jsonb_array_elements(h.record_data->'cells') c where c->>'fieldName'='学习力测评等级' limit 1) learning
  from public.history_import_records h where h.record_data->>'tableName'='到访数据与信息表1.0-总') v
where a.source_record_id=v.id and a.history_revision=0;

-- 原表“学科老师”对应测评老师，“学服老师”对应当前学辅责任；只采用唯一现有员工。
create temp table source_staff on commit drop as
select h.id source_record_id,c->>'fieldName' field_name,min(p.id::text)::uuid user_id
from public.history_import_records h cross join lateral jsonb_array_elements(h.record_data->'cells') c
join public.profiles p on btrim(p.display_name)=btrim(c->>'text') and p.role in ('staff','admin') and p.is_active and p.account_status='active'
where h.source_data->>'format'='feishu-base' and c->>'fieldName' in ('学科老师','学服老师','跟进人','确认人员') and btrim(c->>'text')<>''
group by h.id,c->>'fieldName' having count(distinct p.id)=1;
update public.assessment_results a set assessed_by=s.user_id from source_staff s
where a.source_record_id=s.source_record_id and s.field_name='学科老师' and a.assessed_by is null and a.history_revision=0;
update public.lead_communications c set recorded_by=s.user_id from source_staff s
where c.source_record_id=s.source_record_id and c.recorded_by is null
  and s.field_name=case when c.source_key like '%:followup' then '跟进人' when c.source_key like '%:confirmation' then '确认人员' end;
update public.leads l set owner_id=s.user_id from source_staff s
where l.source_record_id=s.source_record_id and s.field_name='学服老师' and l.owner_id is null
  and not exists(select 1 from public.lead_communications c where c.lead_id=l.id and c.source_record_id is null);
