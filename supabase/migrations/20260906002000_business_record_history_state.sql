-- 历史是业务记录的状态。来源原文继续保留在导入凭据中，领域事实归入现有业务表。
-- 当前流程继续要求完整关联；历史记录按原资料保留日期、经办人与班级缺项。
do $migration$
declare relation text;
begin
  foreach relation in array array['activities','activity_registrations','assessment_results','course_opportunities','course_enrollments','course_enrollment_assignments','student_follow_ups'] loop
    execute format('alter table public.%I
      add column record_state text not null default ''current'' check(record_state in (''current'',''historical'')),
      add column history_key text unique,
      add column history_batch_id uuid references public.history_import_batches(id) on delete restrict,
      add column source_record_id text references public.history_import_records(id) on delete restrict,
      add column source_field_ids text[] not null default ''{}'',
      add column source_payload_sha256 text,
      add column history_imported_at timestamptz,
      add constraint %I check (
        (record_state=''current'' and history_key is null and history_batch_id is null and source_record_id is null and source_payload_sha256 is null and cardinality(source_field_ids)=0)
        or (record_state=''historical'' and history_key is not null and history_batch_id is not null and source_record_id is not null and cardinality(source_field_ids)>0 and source_payload_sha256 is not null and source_payload_sha256 ~ ''^[a-f0-9]{64}$'' and history_imported_at is not null))', relation,relation||'_history_source_check');
    execute format('create policy %I on public.%I as restrictive for all to authenticated using (record_state=''current'' or public.is_admin((select auth.uid()))) with check(record_state=''current'')',relation||'_history_scope',relation);
  end loop;
end $migration$;

alter table public.activities alter column scheduled_at drop not null,
  add column occurred_on date,
  add constraint activities_current_schedule_check check(record_state='historical' or scheduled_at is not null);
drop trigger activities_fill_term on public.activities;
create trigger activities_fill_term before insert on public.activities for each row
  when (new.record_state='current') execute function public.fill_current_term();

alter table public.activity_registrations add column registered_on date,
  add column reported_result text not null default '',
  add column result_link_status text not null default 'none' check(result_link_status in ('none','edition_unconfirmed','confirmed')),
  add column result_source_record_id text references public.history_import_records(id) on delete restrict,
  add column result_field_ids text[] not null default '{}',
  add constraint activity_registrations_reported_result_check check(
    (result_link_status='none' and reported_result='' and result_source_record_id is null)
    or (result_link_status<>'none' and btrim(reported_result)<>'' and result_source_record_id is not null and cardinality(result_field_ids)>0));
alter table public.assessment_results add column assessed_on date;

alter table public.course_opportunities
  alter column course_id drop not null, alter column term_id drop not null,
  alter column owner_id drop not null, alter column created_by drop not null, alter column updated_by drop not null,
  add column period_year integer check(period_year between 1900 and 2200),
  add column period_key text check(period_key in ('summer','autumn')),
  add column term_label text not null default '',
  add column class_label text not null default '', add column teacher_label text not null default '',
  drop constraint course_opportunities_stage_check,
  add constraint course_opportunities_stage_check check(stage in ('planning','contacted','considering','committed','payment_pending','enrolled','not_enrolled','nurturing') or (record_state='historical' and stage='unknown')),
  add constraint course_opportunities_current_fields_check check(record_state='historical' or (course_id is not null and term_id is not null and owner_id is not null and created_by is not null and updated_by is not null)),
  add constraint course_opportunities_historical_work_check check(record_state='current' or (next_action='' and next_action_at is null));

alter table public.course_enrollments
  alter column opportunity_id drop not null, alter column course_id drop not null, alter column term_id drop not null,
  alter column confirmed_by drop not null, alter column confirmed_at drop not null,
  add column registered_on date, add column period_label text not null default '',
  add column amount numeric(14,2) check(amount>=0), add column amount_original text not null default '',
  add constraint course_enrollments_current_fields_check check(record_state='historical' or (opportunity_id is not null and course_id is not null and term_id is not null and confirmed_by is not null and confirmed_at is not null));

alter table public.course_enrollment_assignments
  alter column classroom_id drop not null, alter column classroom_membership_id drop not null,
  alter column assigned_by drop not null, alter column assigned_at drop not null,
  add column class_label text not null default '', add column teacher_label text not null default '',
  add column room_label text not null default '', add column schedule_label text not null default '',
  drop constraint course_enrollment_assignments_status_check,
  drop constraint course_enrollment_assignments_status_shape_check,
  add constraint course_enrollment_assignments_status_check check(status in ('active','completed','transferred_out','withdrawn') or (record_state='historical' and status='unknown')),
  add constraint course_enrollment_assignments_status_shape_check check((status='active' and left_at is null) or (status<>'active' and left_at is not null) or (record_state='historical' and status='unknown' and left_at is null)),
  add constraint course_enrollment_assignments_current_fields_check check(record_state='historical' or (classroom_id is not null and classroom_membership_id is not null and assigned_by is not null and assigned_at is not null));

alter table public.student_follow_ups alter column author_id drop not null,
  add column occurred_on date,
  add column context_kind text check(context_kind in ('renewal','assessment')),
  add column author_label text,
  add column date_basis text not null default 'unknown' check(date_basis in ('unknown','source_explicit')),
  add constraint student_follow_ups_current_author_check check(record_state='historical' or author_id is not null),
  add constraint student_follow_ups_historical_work_check check(record_state='current' or (next_follow_up_at is null and status_after is null));
drop trigger student_followups_touch_student on public.student_follow_ups;
create trigger student_followups_touch_student after insert on public.student_follow_ups
  for each row when(new.record_state='current') execute function public.touch_student_follow_up();
drop trigger activity_registrations_seed_public_class_records on public.activity_registrations;
create trigger activity_registrations_seed_public_class_records after insert or update of status on public.activity_registrations
  for each row when(new.record_state='current') execute function public.seed_public_class_registration_records();
drop trigger assessment_results_sync_actual_assessor on public.assessment_results;
create trigger assessment_results_sync_actual_assessor after insert or update of assessed_by on public.assessment_results
  for each row when(new.record_state='current') execute function public.sync_completed_assessment_actual_assessor();

-- 历史关系可以并存于后续的新业务轮次，不占用当前目标的唯一位置。
drop index public.course_opportunities_route_target_key;
drop index public.course_opportunities_student_target_key;
drop index public.course_opportunities_lead_target_key;
create unique index course_opportunities_route_target_key on public.course_opportunities(source_activity_route_id,opportunity_type,course_id,term_id) where source_activity_route_id is not null and record_state='current';
create unique index course_opportunities_student_target_key on public.course_opportunities(student_id,opportunity_type,course_id,term_id) where student_id is not null and record_state='current';
create unique index course_opportunities_lead_target_key on public.course_opportunities(lead_id,opportunity_type,course_id,term_id) where lead_id is not null and record_state='current';
drop index public.course_enrollments_one_active_target_idx;
create unique index course_enrollments_one_active_target_idx on public.course_enrollments(student_id,course_id,term_id) where status='active' and record_state='current';
drop index public.course_enrollment_assignments_one_active_idx;
create unique index course_enrollment_assignments_one_active_idx on public.course_enrollment_assignments(course_enrollment_id) where status='active' and record_state='current';

-- API/RPC 的写入也执行同一状态边界；历史导入由已核对目标的数据库事务执行。
create function public.guard_business_record_state() returns trigger language plpgsql set search_path=public,pg_temp as $guard$
declare subject_id uuid; parent_state text;
begin
  if tg_op<>'INSERT' and old.record_state='historical' then raise exception 'HISTORICAL_RECORD_READ_ONLY'; end if;
  if tg_op='DELETE' then return old; end if;
  if new.record_state='historical' then
    if tg_op<>'INSERT' or session_user<>'postgres' or auth.uid() is not null
      or coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb->>'role' is not null then
      raise exception 'HISTORICAL_RECORD_IMPORT_REQUIRED';
    end if;
    if tg_table_name='course_enrollment_assignments' then
      select student_id into subject_id from public.course_enrollments where id=new.course_enrollment_id;
    elsif tg_table_name<>'activities' then subject_id:=new.student_id; end if;
    if tg_table_name<>'activities' and not exists(select 1 from public.history_import_records where id=new.source_record_id and student_id=subject_id) then
      raise exception 'HISTORICAL_RECORD_IDENTITY_MISMATCH';
    end if;
  end if;
  if tg_table_name='activity_registrations' then select record_state into parent_state from public.activities where id=new.activity_id;
  elsif tg_table_name='assessment_results' then select record_state into parent_state from public.activity_registrations where id=new.activity_registration_id;
  elsif tg_table_name='course_enrollment_assignments' then select record_state into parent_state from public.course_enrollments where id=new.course_enrollment_id;
  elsif tg_table_name='course_enrollments' then
    if new.opportunity_id is not null then select record_state into parent_state from public.course_opportunities where id=new.opportunity_id; end if;
  end if;
  if parent_state is not null and parent_state<>new.record_state then raise exception 'HISTORICAL_RECORD_RELATION_MISMATCH'; end if;
  return new;
end $guard$;
revoke all on function public.guard_business_record_state() from public,anon,authenticated,service_role;
do $migration$ declare relation text; begin
  foreach relation in array array['activities','activity_registrations','assessment_results','course_opportunities','course_enrollments','course_enrollment_assignments','student_follow_ups'] loop
    execute format('create trigger business_record_state_guard before insert or update or delete on public.%I for each row execute function public.guard_business_record_state()',relation);
  end loop;
end $migration$;

-- 迁移先前本机试验的领域事实；id 和来源指纹可复核，原始导入凭据保持原样。
insert into public.activities(id,kind,title,scheduled_at,occurred_on,record_state,history_key,history_batch_id,source_record_id,source_field_ids,source_payload_sha256,history_imported_at)
select md5(id||':activity')::uuid,activity_kind,activity_name,null::timestamptz,occurred_on,'historical',id||':activity',import_batch_id,source_record_id,source_field_ids,payload_sha256,imported_at from public.student_activity_history
union all select md5(id||':activity')::uuid,'assessment_1v1','1 对 1 测评',null::timestamptz,assessed_on,'historical',id||':activity',import_batch_id,source_record_id,source_field_ids,payload_sha256,imported_at from public.student_assessment_history;
insert into public.activity_registrations(id,activity_id,student_id,status,registered_on,reported_result,result_link_status,result_source_record_id,result_field_ids,record_state,history_key,history_batch_id,source_record_id,source_field_ids,source_payload_sha256,history_imported_at)
select md5(id)::uuid,md5(id||':activity')::uuid,student_id,case participation_status when 'registered' then 'booked' when 'attended' then 'attended' when 'no_show' then 'no_show' else 'booked' end,registered_on,reported_result,result_link_status,result_source_record_id,result_field_ids,'historical',id,import_batch_id,source_record_id,source_field_ids,payload_sha256,imported_at from public.student_activity_history
union all select md5(id||':registration')::uuid,md5(id||':activity')::uuid,student_id,'attended',null,'','none',null,'{}','historical',id||':registration',import_batch_id,source_record_id,source_field_ids,payload_sha256,imported_at from public.student_assessment_history;
insert into public.assessment_results(id,activity_registration_id,student_id,assessment_band,assessed_on,score,strengths,parent_concerns,record_state,history_key,history_batch_id,source_record_id,source_field_ids,source_payload_sha256,history_imported_at)
select md5(id)::uuid,md5(id||':registration')::uuid,student_id,case assessment_band when 'A+' then 'a_plus' when 'A' then 'a' when 'S' then 's' when 'C' then 'c' when 'G+' then 'g_plus' when 'X+' then 'x_plus' else assessment_band end,assessed_on,score,learning_notes,parent_notes,'historical',id,import_batch_id,source_record_id,source_field_ids,payload_sha256,imported_at from public.student_assessment_history;
insert into public.course_opportunities(id,student_id,opportunity_type,stage,note,period_year,period_key,term_label,class_label,teacher_label,record_state,history_key,history_batch_id,source_record_id,source_field_ids,source_payload_sha256,history_imported_at)
select md5(id)::uuid,student_id,'renewal',case outcome when 'renewed' then 'enrolled' when 'not_renewed' then 'not_enrolled' else 'unknown' end,decision_note,period_year,period_key,coalesce(period_year::text,'')||case period_key when 'summer' then '暑假' else '秋季' end,class_label,teacher_label,'historical',id,import_batch_id,source_record_id,source_field_ids,payload_sha256,imported_at from public.student_renewal_history;
insert into public.course_enrollments(id,student_id,status,confirmed_at,registered_on,period_label,amount,amount_original,record_state,history_key,history_batch_id,source_record_id,source_field_ids,source_payload_sha256,history_imported_at)
select md5(id)::uuid,student_id,'active',null,registered_on,period_label,amount,amount_original,'historical',id,import_batch_id,source_record_id,source_field_ids,payload_sha256,imported_at from public.student_enrollment_history;
insert into public.course_enrollment_assignments(id,course_enrollment_id,status,assigned_at,class_label,teacher_label,room_label,schedule_label,record_state,history_key,history_batch_id,source_record_id,source_field_ids,source_payload_sha256,history_imported_at)
select md5(id||':assignment')::uuid,md5(id)::uuid,'unknown',null,class_label,teacher_label,room_label,schedule_label,'historical',id||':assignment',import_batch_id,source_record_id,source_field_ids,payload_sha256,imported_at from public.student_enrollment_history;
insert into public.student_follow_ups(id,student_id,content,kind,occurred_on,context_kind,author_label,date_basis,record_state,history_key,history_batch_id,source_record_id,source_field_ids,source_payload_sha256,history_imported_at)
select md5(id)::uuid,student_id,content,'note',occurred_on,context_kind,author_label,date_basis,'historical',id,import_batch_id,source_record_id,source_field_ids,payload_sha256,imported_at from public.student_communication_history;

-- 把已有 RPC 的显式业务对象参数接入同一历史只读门，覆盖分流、报名、测评与活动写入。
create function public.require_current_business_record(p_relation text,p_id uuid) returns void
language plpgsql security definer set search_path=public,pg_temp as $guard$
declare historical boolean;
begin
  if p_id is null then return; end if;
  if p_relation not in ('activities','activity_registrations','course_opportunities','course_enrollments') then raise exception 'VALIDATION'; end if;
  execute format('select record_state=''historical'' from public.%I where id=$1',p_relation) into historical using p_id;
  if historical then raise exception 'HISTORICAL_RECORD_READ_ONLY'; end if;
end $guard$;
revoke all on function public.require_current_business_record(text,uuid) from public,anon,authenticated,service_role;
do $migration$
declare routine record; argument text; relation text; guards text; definition text;
begin
  for routine in select p.oid,p.proargnames,p.prosrc from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.prokind='f' and p.prolang=(select oid from pg_language where lanname='plpgsql')
      and p.proargnames && array['p_activity_id','p_registration_id','p_opportunity_id','p_course_enrollment_id']
      and p.proname in ('mark_activity_result','create_activity_opportunity','save_activity_assessment','book_activity','begin_activity_assessment',
        'save_activity_route','save_activity_assessment_row','save_teacher_assessment_question','save_assessment_workbench_route',
        'save_teacher_assessment_observation','complete_teacher_assessment','get_teacher_assessment_workbench','save_course_opportunity',
        'confirm_course_enrollment','cancel_course_enrollment','assign_course_enrollment','transfer_course_enrollment',
        'confirm_activity_enrollment','get_activity_enrollment_context','move_enrollment_placement','update_activity','delete_activity','set_activity_target_grades') loop
    guards:='';
    foreach argument in array routine.proargnames loop
      relation:=case argument when 'p_activity_id' then 'activities' when 'p_registration_id' then 'activity_registrations'
        when 'p_opportunity_id' then 'course_opportunities' when 'p_course_enrollment_id' then 'course_enrollments' end;
      if relation is not null then guards:=guards||format(E'\n perform public.require_current_business_record(%L,%I);',relation,argument); end if;
    end loop;
    definition:=pg_get_functiondef(routine.oid);
    execute replace(definition,routine.prosrc,regexp_replace(routine.prosrc,'\mBEGIN\M','begin'||guards,'i'));
  end loop;
  -- 现有运营 RPC 只返回当前流程的数据，表格另外读取同表中的历史状态投影。
  for routine in select p.oid,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in ('get_course_opportunity_workbench','get_course_enrollment_workbench','get_renewal_health_facts','get_enrollment_placement_board',
      'save_course_opportunity','confirm_course_enrollment','confirm_activity_enrollment','move_enrollment_placement','prepare_renewal_opportunities') loop
    definition:=pg_get_functiondef(routine.oid);
    definition:=replace(definition,'from public.course_opportunities opportunity','from (select * from public.course_opportunities where record_state=''current'') opportunity');
    definition:=replace(definition,'from public.course_enrollments enrollment','from (select * from public.course_enrollments where record_state=''current'') enrollment');
    definition:=regexp_replace(definition,'from public.course_opportunities(\s+)where',E'from public.course_opportunities\\1where record_state=''current'' and','g');
    definition:=regexp_replace(definition,'from public.course_enrollments(\s+)where',E'from public.course_enrollments\\1where record_state=''current'' and','g');
    definition:=replace(definition,'from public.student_follow_ups f where','from public.student_follow_ups f where f.record_state=''current'' and');
    definition:=replace(definition,'ce.status=''active''','ce.status=''active'' and ce.record_state=''current''');
    execute definition;
  end loop;
end $migration$;

-- 逐字段验证旧试验数据在现有业务对象中的对应事实；任一未知映射使整个事务回滚。
do $verify$
begin
  if exists(select 1 from public.student_renewal_history h left join public.course_opportunities c on c.history_key=h.id
    where c.id is null or h.student_id<>c.student_id or h.payload_sha256<>c.source_payload_sha256 or h.import_batch_id<>c.history_batch_id or h.imported_at<>c.history_imported_at
      or h.source_record_id<>c.source_record_id or h.source_field_ids<>c.source_field_ids
      or h.period_year is distinct from c.period_year or h.period_key<>c.period_key or h.decision_note<>c.note
      or h.class_label<>c.class_label or h.teacher_label<>c.teacher_label or h.renewal_cycle_id is not null
      or h.outcome<>case c.stage when 'enrolled' then 'renewed' when 'not_enrolled' then 'not_renewed' else 'unknown' end)
    or exists(select 1 from public.student_activity_history h left join public.activity_registrations r on r.history_key=h.id left join public.activities a on a.id=r.activity_id
      where r.id is null or h.student_id<>r.student_id or h.payload_sha256<>r.source_payload_sha256 or h.import_batch_id<>r.history_batch_id or h.imported_at<>r.history_imported_at
        or h.source_record_id<>r.source_record_id or h.source_field_ids<>r.source_field_ids or h.activity_id is not null
        or h.activity_name<>a.title or h.activity_kind<>a.kind or h.registered_on is distinct from r.registered_on or h.occurred_on is distinct from a.occurred_on
        or h.reported_result<>r.reported_result or h.result_link_status<>r.result_link_status or h.result_source_record_id is distinct from r.result_source_record_id or h.result_field_ids<>r.result_field_ids
        or h.participation_status<>case r.status when 'booked' then 'registered' else r.status end)
    or exists(select 1 from public.student_assessment_history h left join public.assessment_results r on r.history_key=h.id
      where r.id is null or h.student_id<>r.student_id or h.payload_sha256<>r.source_payload_sha256 or h.import_batch_id<>r.history_batch_id or h.imported_at<>r.history_imported_at
        or h.source_record_id<>r.source_record_id or h.source_field_ids<>r.source_field_ids or h.activity_registration_id is not null
        or h.assessed_on is distinct from r.assessed_on or h.score is distinct from r.score or h.learning_notes<>r.strengths or h.parent_notes<>r.parent_concerns
        or h.assessment_band<>case r.assessment_band when 'a_plus' then 'A+' when 'a' then 'A' when 's' then 'S' when 'c' then 'C' when 'g_plus' then 'G+' when 'x_plus' then 'X+' else r.assessment_band end)
    or exists(select 1 from public.student_enrollment_history h left join public.course_enrollments e on e.history_key=h.id left join public.course_enrollment_assignments a on a.course_enrollment_id=e.id
      where e.id is null or a.id is null or h.student_id<>e.student_id or h.payload_sha256<>e.source_payload_sha256 or h.import_batch_id<>e.history_batch_id or h.imported_at<>e.history_imported_at
        or h.source_record_id<>e.source_record_id or h.source_field_ids<>e.source_field_ids or h.course_enrollment_id is not null
        or h.registered_on is distinct from e.registered_on or h.period_label<>e.period_label or h.amount is distinct from e.amount or h.amount_original<>e.amount_original
        or h.class_label<>a.class_label or h.teacher_label<>a.teacher_label or h.room_label<>a.room_label or h.schedule_label<>a.schedule_label)
    or exists(select 1 from public.student_communication_history h left join public.student_follow_ups f on f.history_key=h.id
      where f.id is null or h.student_id<>f.student_id or h.payload_sha256<>f.source_payload_sha256 or h.import_batch_id<>f.history_batch_id or h.imported_at<>f.history_imported_at
        or h.source_record_id<>f.source_record_id or h.source_field_ids<>f.source_field_ids or h.occurred_on is distinct from f.occurred_on
        or h.context_kind<>f.context_kind or h.content<>f.content or h.author_label is distinct from f.author_label or h.date_basis<>f.date_basis)
    then raise exception 'HISTORICAL_CANONICAL_MAPPING_MISMATCH'; end if;
end $verify$;

-- 旧试验表保留为恢复副本；应用查询已经切换到现有业务表。副本清理另行确认。
do $migration$ declare relation text; begin
  foreach relation in array array['student_renewal_history','student_activity_history','student_assessment_history','student_enrollment_history','student_communication_history'] loop
    execute format('comment on table public.%I is %L',relation,'已迁入现有业务表的历史状态记录；本表仅保留原试验恢复副本，应用不再读取。');
  end loop;
end $migration$;
