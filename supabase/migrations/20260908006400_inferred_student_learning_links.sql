-- 自动关联保留推定依据；人工核对发生在老师实际办理时。
alter table public.history_import_associations add column match_state text not null default 'confirmed' check(match_state in ('inferred','confirmed'));
alter table public.history_import_associations add column match_reason jsonb not null default '{}'::jsonb;
alter table public.history_import_associations alter column confirmed_by drop not null;
alter table public.history_import_association_events alter column recorded_by drop not null;
CREATE OR REPLACE FUNCTION public.get_student_source_archive(p_student_id uuid, p_page integer DEFAULT 1)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare batch uuid; result jsonb; total bigint;
begin
  if auth.uid() is null then raise exception 'UNAUTHENTICATED';end if;
  if not public.is_staff(auth.uid()) or not public.can_access_student(p_student_id,auth.uid()) then raise exception 'FORBIDDEN';end if;
  if p_page is null or p_page<1 or p_page>100000 then raise exception 'VALIDATION';end if;
  select id into batch from public.history_import_batches where manifest->>'mode'='complete_source_import' order by imported_at desc limit 1;
  with scoped as (
    select h.id,h.record_data,h.source_data,coalesce(a.student_id,h.student_id)=p_student_id linked,coalesce(a.version,0) version,coalesce(a.match_state,'confirmed') match_state
    from public.history_import_batch_records br join public.history_import_records h on h.id=br.record_id
    left join public.history_import_associations a on a.record_id=h.id
    where br.batch_id=batch and h.record_data->>'hasContent'='true' and (
      coalesce(a.student_id,h.student_id)=p_student_id or (a.record_id is null and h.student_id is null and h.lead_id is null
      and public.can_confirm_history_source() and not public.history_source_is_shared(h.record_data) and exists(select 1 from public.history_import_identity_candidates c where c.record_id=h.id and c.student_id=p_student_id)))
  ), paged as (select * from scoped order by case source_data->>'format' when 'feishu-base' then 0 else 1 end,linked desc nulls last,record_data->>'tableName',id offset (p_page-1)*20 limit 20)
  select (select count(*) from scoped),coalesce(jsonb_agg(jsonb_build_object('id',id,'title',record_data->>'tableName','source',source_data->>'filename',
    'name',record_data->>'label','dateLabel',record_data->>'dateLabel','linked',coalesce(linked,false),'version',version,'matchState',match_state,
    'cells',(select coalesce(jsonb_agg(jsonb_build_object('name',c->>'fieldName','text',c->>'text')),'[]') from jsonb_array_elements(record_data->'cells') c where c->>'kind'<>'system' and btrim(coalesce(c->>'text',''))<>'')) order by case source_data->>'format' when 'feishu-base' then 0 else 1 end,linked desc nulls last,record_data->>'tableName',id),'[]') into total,result from paged;
  return jsonb_build_object('rows',result,'total',total,'page',p_page,'pageSize',20,'canConfirm',public.can_confirm_history_source());
end;
$function$;
CREATE OR REPLACE FUNCTION public.get_history_source_context(p_record_id text, p_student_id uuid DEFAULT NULL::uuid, p_query text DEFAULT ''::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare source public.history_import_records; association public.history_import_associations; target uuid; options jsonb; can_confirm boolean;
begin
  if auth.uid() is null then raise exception 'UNAUTHENTICATED';end if;
  if not public.is_staff(auth.uid()) then raise exception 'FORBIDDEN';end if;
  if p_record_id is null or length(p_record_id)>160 or p_query is null or length(p_query)>100 then raise exception 'VALIDATION';end if;
  select * into source from public.history_import_records where id=p_record_id;
  if source.id is null or source.match_data->>'reason'='non_student_source' then raise exception 'NOT_FOUND';end if;
  select * into association from public.history_import_associations where record_id=p_record_id;
  target:=coalesce(association.student_id,source.student_id);can_confirm:=public.can_confirm_history_source();
  if target is not null then
    if not public.can_access_student(target,auth.uid()) or (p_student_id is not null and p_student_id<>target) then raise exception 'FORBIDDEN';end if;
  elsif not can_confirm then raise exception 'FORBIDDEN';end if;
  if p_student_id is not null and not public.can_access_student(p_student_id,auth.uid()) then raise exception 'FORBIDDEN';end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'name',s.name,'grade',s.grade,'phone',coalesce(nullif(s.parent_phone,''),s.phone)) order by s.name,s.id),'[]') into options from (
    select s.id,s.name,s.grade,s.phone,s.parent_phone from public.students s
    where s.deleted_at is null and public.can_access_student(s.id,auth.uid()) and (
      (target is not null and s.id=target) or (can_confirm and length(btrim(p_query))>=2 and (s.name ilike '%'||btrim(p_query)||'%' or s.phone ilike '%'||btrim(p_query)||'%' or s.parent_phone ilike '%'||btrim(p_query)||'%')) or (target is null and (
        (p_student_id is not null and s.id=p_student_id) or
        (p_student_id is null and length(btrim(p_query))>=2 and (s.name ilike '%'||btrim(p_query)||'%' or s.phone ilike '%'||btrim(p_query)||'%' or s.parent_phone ilike '%'||btrim(p_query)||'%')) or
        (p_student_id is null and btrim(p_query)='' and exists(select 1 from public.history_import_identity_candidates c where c.record_id=p_record_id and c.student_id=s.id)))))
    order by s.name,s.id limit 25
  ) s;
  return jsonb_build_object('recordId',source.id,'title',source.record_data->>'tableName','source',source.source_data->>'filename','name',source.record_data->>'label',
    'studentId',target,'version',coalesce(association.version,0),'matchState',coalesce(association.match_state,'confirmed'),'canConfirm',can_confirm and source.student_id is null and (source.lead_id is null or not exists(select 1 from public.leads l where l.id=source.lead_id and l.student_id is not null)) and not public.history_source_is_shared(source.record_data),
    'students',options,'cells',(select coalesce(jsonb_agg(jsonb_build_object('name',c->>'fieldName','text',c->>'text')),'[]') from jsonb_array_elements(source.record_data->'cells') c where c->>'kind'<>'system' and btrim(coalesce(c->>'text',''))<>''));
end;
$function$;
CREATE OR REPLACE FUNCTION public.confirm_history_source(p_record_id text, p_student_id uuid, p_expected_version integer, p_context text DEFAULT 'student_profile'::text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare source public.history_import_records; previous public.history_import_associations; saved public.history_import_associations;
begin
  if auth.uid() is null then raise exception 'UNAUTHENTICATED';end if;
  if not public.can_confirm_history_source() or not public.can_access_student(p_student_id,auth.uid()) then raise exception 'FORBIDDEN';end if;
  if p_record_id is null or length(p_record_id)>160 or p_student_id is null or p_expected_version is null or p_expected_version<0
    or p_context is null or p_context not in ('student_profile','followup','activity','assessment','enrollment','renewal') then raise exception 'VALIDATION';end if;
  if not exists(select 1 from public.students where id=p_student_id and deleted_at is null) then raise exception 'NOT_FOUND';end if;
  select * into source from public.history_import_records where id=p_record_id for update;
  if source.id is null or source.match_data->>'reason'='non_student_source' then raise exception 'NOT_FOUND';end if;
  if public.history_source_is_shared(source.record_data) then raise exception 'SOURCE_SHARED_RECORD';end if;
  if source.student_id is not null or exists(select 1 from public.leads l where l.id=source.lead_id and l.student_id is not null) then
    if source.student_id=p_student_id then return 0;end if;
    raise exception 'SOURCE_ALREADY_LINKED';
  end if;
  select * into previous from public.history_import_associations where record_id=p_record_id for update;
  if previous.match_state='confirmed' and previous.student_id=p_student_id and previous.version in (p_expected_version,p_expected_version+1) then return previous.version;end if;
  if coalesce(previous.version,0)<>p_expected_version then raise exception 'VERSION_CONFLICT';end if;
  if previous.student_id is not null and previous.student_id<>p_student_id and exists(select 1 from public.student_follow_ups where context_source_record_id=p_record_id) then raise exception 'SOURCE_IN_USE';end if;
  insert into public.history_import_associations(record_id,student_id,version,context,confirmed_by)
    values(p_record_id,p_student_id,p_expected_version+1,p_context,auth.uid())
    on conflict(record_id) do update set student_id=excluded.student_id,version=excluded.version,context=excluded.context,confirmed_by=excluded.confirmed_by,confirmed_at=clock_timestamp(),match_state='confirmed'
    returning * into saved;
  insert into public.history_import_association_events(record_id,before_data,after_data,recorded_by)
    values(p_record_id,coalesce(to_jsonb(previous),'{}'),to_jsonb(saved),auth.uid());
  return saved.version;
end;
$function$;
CREATE OR REPLACE FUNCTION public.student_stage_learning_background(p_student_id uuid, p_lead_id uuid, p_stage text, p_preferred_source_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
#variable_conflict use_variable
declare
  lead_ids uuid[]; source_ids text[]; sources jsonb; person public.students%rowtype;
  actual_assessment record; class_fact record; source_fact record;
  owner_name text; teacher_name text; teacher_id uuid;
  band text; learning_band text; class_band text; background_source text;
  candidate_count integer:=0;
begin
  select * into person from public.students where id=p_student_id;
  select coalesce(array_agg(l.id),'{}'::uuid[]) into lead_ids from public.leads l
    where l.id=p_lead_id or p_student_id is not null and l.student_id=p_student_id;
  select coalesce(array_agg(distinct record_id) filter(where record_id is not null),'{}'::text[]) into source_ids from (
    select h.id as record_id from public.history_import_records h where h.student_id=p_student_id or h.lead_id=any(lead_ids)
    union all select a.record_id from public.history_import_associations a where a.student_id=p_student_id
    union all select l.source_record_id from public.leads l where l.id=any(lead_ids)
    union all select c.source_record_id from public.lead_communications c where c.lead_id=any(lead_ids)
    union all select r.source_record_id from public.activity_registrations r where r.student_id=p_student_id or r.lead_id=any(lead_ids)
    union all select a.source_record_id from public.assessment_results a where a.student_id=p_student_id or a.lead_id=any(lead_ids)
    union all select e.source_record_id from public.course_enrollments e where e.student_id=p_student_id
  ) refs;
  select coalesce(jsonb_agg(jsonb_build_object('id',h.id,'table',h.record_data->>'tableName',
    'current',public.business_source_is_current(h.id),'fields',f.fields)),'[]'::jsonb) into sources
    from public.history_import_records h cross join lateral (
      select jsonb_object_agg(c->>'fieldName',btrim(c->>'text')) as fields from jsonb_array_elements(h.record_data->'cells') c
      where c->>'fieldName' in ('学服老师','确认人员','学科老师','报名服务老师','授课学科老师','思维测评等级','学习力测评等级','班型')
        and nullif(btrim(c->>'text'),'') is not null
    ) f where h.id=any(source_ids) and h.source_data->>'format'='feishu-base';

  -- 正式班级提供当前任课老师和实际班型；班型仅作参考，不补造测评完成事件。
  select string_agg(distinct p.display_name,'、' order by p.display_name) filter(where a.responsibility='primary_teacher') as teacher_name,
    string_agg(distinct p.display_name,'、' order by p.display_name) filter(where a.responsibility='learning_support') as owner_name,
    string_agg(distinct (regexp_match(c.name,'(?:春季|暑期|暑假|秋季|寒假)(X[+＋]|G[+＋]|A[+＋]?|S|C|培优|基础)(?:[|｜班]|$)'))[1],'、') as class_band
    into class_fact from public.enrollments e join public.classrooms c on c.id=e.classroom_id
      left join public.school_terms t on t.id=c.term_id
      left join public.classroom_staff_assignments a on a.classroom_id=c.id
      left join public.profiles p on p.id=a.user_id
    where e.student_id=p_student_id and e.status='active' and e.left_at is null and c.archived_at is null and c.trashed_at is null
      and (t.ends_on is null or t.ends_on >= (now() at time zone public.get_organization_timezone_v2())::date);

  select coalesce(nullif(s->'fields'->>'报名服务老师',''),nullif(s->'fields'->>'学服老师',''),nullif(s->'fields'->>'确认人员','')) as name
    into source_fact from jsonb_array_elements(sources) s
    where coalesce(s->'fields'->>'报名服务老师',s->'fields'->>'学服老师',s->'fields'->>'确认人员') is not null
    order by case when p_stage='awaiting_renewal' and s->>'table'='2026秋季在读学员表格' then 0
      when s->>'id'=p_preferred_source_id then 1 when (s->>'current')::boolean then 2 else 3 end,s->>'id' limit 1;
  owner_name:=coalesce(class_fact.owner_name,source_fact.name);
  select coalesce(nullif(s->'fields'->>'授课学科老师',''),nullif(s->'fields'->>'学科老师','')) as name
    into source_fact from jsonb_array_elements(sources) s
    where coalesce(s->'fields'->>'授课学科老师',s->'fields'->>'学科老师') is not null
    order by case when p_stage='awaiting_renewal' and s->>'table'='2026秋季在读学员表格' then 0
      when s->>'id'=p_preferred_source_id then 1 when (s->>'current')::boolean then 2 else 3 end,s->>'id' limit 1;
  teacher_name:=coalesce(case when p_stage='awaiting_renewal' then class_fact.teacher_name end,source_fact.name);

  -- 原始候选保留给人工确认；同名资料不在读取时自动绑定学员。
  select count(distinct h.id)::integer into candidate_count from public.history_import_identity_candidates ic
    join public.history_import_records h on h.id=ic.record_id
    where ic.student_id=p_student_id and h.source_data->>'format'='feishu-base' and not h.id=any(source_ids)
      and exists(select 1 from public.business_assessment_results a join public.business_activity_registrations r on r.id=a.activity_registration_id
        where a.source_record_id=h.id and r.status not in ('no_show','cancelled') and
          (r.assessment_completed_at is not null or a.result_finalized_at is not null or a.result_source='legacy' and
            (a.score is not null or a.assessment_band is not null or a.strengths ~ '(^|[\r\n])(原测评等级|学习力测评等级)：')));

  select a.id,a.score,a.assessment_band,a.assessed_by,r.id as registration_id,a.source_record_id,
    coalesce(a.assessed_on,(coalesce(r.assessment_completed_at,a.result_finalized_at) at time zone public.get_organization_timezone_v2())::date,
      act.occurred_on,(act.scheduled_at at time zone public.get_organization_timezone_v2())::date) as assessed_on,
    nullif(substring(a.strengths from '(?:^|[\r\n])学习力测评等级：([^\r\n]+)'),'') as learning_band
    into actual_assessment from public.business_assessment_results a
      join public.business_activity_registrations r on r.id=a.activity_registration_id
      join public.business_activities act on act.id=r.activity_id
    where (a.student_id=p_student_id or r.student_id=p_student_id or a.lead_id=any(lead_ids) or r.lead_id=any(lead_ids)
      or a.source_record_id=any(source_ids) or r.source_record_id=any(source_ids))
      and act.deleted_at is null and r.status not in ('no_show','cancelled') and
      (r.assessment_completed_at is not null or a.result_finalized_at is not null or a.result_source='legacy' and
        (a.score is not null or a.assessment_band is not null or a.strengths ~ '(^|[\r\n])(原测评等级|学习力测评等级)：'))
    order by coalesce(a.assessed_on,(coalesce(r.assessment_completed_at,a.result_finalized_at) at time zone public.get_organization_timezone_v2())::date,
      act.occurred_on,(act.scheduled_at at time zone public.get_organization_timezone_v2())::date) desc nulls last,a.updated_at desc,a.id limit 1;

  if actual_assessment.id is not null then
    band:=public.student_learning_band(actual_assessment.assessment_band);
    learning_band:=actual_assessment.learning_band;
    background_source:='assessment';
    if teacher_name is null then select display_name into teacher_name from public.profiles where id=actual_assessment.assessed_by;end if;
  end if;
  if p_stage='awaiting_renewal' and actual_assessment.id is null then
    select s->'fields'->>'班型' as class_band into source_fact from jsonb_array_elements(sources) s
      where nullif(s->'fields'->>'班型','') is not null and s->>'table'='2026秋季在读学员表格'
      order by (s->>'table'='2026秋季在读学员表格') desc,(s->>'current')::boolean desc,s->>'id' limit 1;
    class_band:=coalesce(class_fact.class_band,source_fact.class_band);
    if class_band is not null then band:=public.student_learning_band(class_band);background_source:='class_band';end if;
  end if;
  select case when count(*)=1 then (array_agg(p.id))[1] end into teacher_id from public.profiles p
    where p.display_name=teacher_name and p.is_active and p.role in ('staff','admin');
  return jsonb_build_object('ownerName',coalesce(owner_name,''),'teacherName',coalesce(teacher_name,''),'teacherId',teacher_id,
    'assessmentSource',background_source,'assessmentBand',band,'score',actual_assessment.score,
    'assessmentAt',actual_assessment.assessed_on,'assessmentRecordId',actual_assessment.id,
    'learningBand',case when learning_band='未达A' then 'X+' else learning_band end,'classBandLabel',coalesce(class_band,''),'assessmentCandidateCount',candidate_count,'inferredSourceIds',(select coalesce(jsonb_agg(a.record_id),'[]'::jsonb) from public.history_import_associations a where a.record_id=any(source_ids) and a.match_state='inferred'));
end;
$function$;