-- 来源凭据与业务生命周期分别保存；导入的业务记录进入现有工作流。
-- 空缺日期、身份、课程关系保持空值，在实际操作时确认。
alter table public.leads add column source_record_id text references public.history_import_records(id) on delete restrict,
  add column note text not null default '';
alter table public.leads alter column created_by drop not null,alter column phone_normalized drop not null,
  drop constraint leads_phone_check,drop constraint leads_phone_normalized_check,
  add constraint leads_phone_check check(length(btrim(phone)) between 6 and 40 or (source_record_id is not null and phone='')),
  add constraint leads_phone_normalized_check check((phone_normalized is not null and phone_normalized ~ '^[0-9]{6,20}$') or (source_record_id is not null and phone_normalized is null)),
  add constraint leads_created_by_check check(created_by is not null or source_record_id is not null);
alter table public.lead_communications add column source_record_id text references public.history_import_records(id) on delete restrict,
  add column source_key text unique,add column occurred_on date;
alter table public.lead_communications alter column occurred_at drop not null,alter column recorded_by drop not null,
  alter column outcome drop not null,drop constraint lead_communications_note_check,drop constraint lead_communications_reachability_check,
  add constraint lead_communications_note_check check(length(note)<=2000 or (source_record_id is not null and length(note)<=20000)),
  add constraint lead_communications_source_fields_check check(source_record_id is not null or (occurred_at is not null and recorded_by is not null and outcome is not null)),
  add constraint lead_communications_reachability_check check(outcome in ('connected','declined') or (wechat_added is distinct from true and visit_committed is distinct from true) or (source_record_id is not null and outcome is null));
alter table public.assessment_results add column score_max numeric check(score_max>0 and score<=score_max);

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
    if linked is distinct from target then raise exception 'SOURCE_ASSOCIATION_REQUIRED';end if;
  end if;
  return new;
end;
$$;

do $$
declare relation text;item record;definition text;
begin
  foreach relation in array array['activities','activity_registrations','assessment_results','course_opportunities','course_enrollments','course_enrollment_assignments','student_follow_ups'] loop
    execute format('alter table public.%I drop constraint %I',relation,relation||'_history_source_check');
    execute format('drop policy %I on public.%I',relation||'_history_scope',relation);
    execute format('alter table public.%I add constraint %I check ((source_record_id is null and history_key is null and history_batch_id is null and source_payload_sha256 is null and cardinality(source_field_ids)=0) or (source_record_id is not null and history_key is not null and history_batch_id is not null and source_payload_sha256 ~ ''^[a-f0-9]{64}$'' and cardinality(source_field_ids)>0 and history_imported_at is not null))',relation,relation||'_source_provenance_check');
    for item in select conname,pg_get_constraintdef(oid) def from pg_constraint where conrelid=format('public.%I',relation)::regclass and contype='c' and pg_get_constraintdef(oid) like '%record_state%' loop
      if item.conname like '%historical_work_check' then execute format('alter table public.%I drop constraint %I',relation,item.conname);continue;end if;
      definition:=replace(item.def,'(record_state = ''historical''::text)','(source_record_id IS NOT NULL)');
      if definition<>item.def then execute format('alter table public.%I drop constraint %I, add constraint %I %s',relation,item.conname,item.conname,definition);end if;
    end loop;
    execute format('update public.%I set record_state=''current'' where record_state=''historical''',relation);
  end loop;
end;
$$;

-- 学生归属确认前仍可核对原工作表，分班操作先绑定学生。
alter table public.course_enrollments alter column student_id drop not null,
  add constraint course_enrollments_subject_check check(student_id is not null or source_record_id is not null);
create policy course_enrollments_pending_source_read on public.course_enrollments for select to authenticated
  using(student_id is null and source_record_id is not null and public.can_confirm_history_source());
create policy course_enrollment_assignments_pending_source_read on public.course_enrollment_assignments for select to authenticated
  using(source_record_id is not null and public.can_confirm_history_source());

update public.assessment_results set strengths=concat_ws(E'\n',nullif(strengths,''),'原测评等级：未达A'),assessment_band=null where assessment_band='below_a';
alter table public.assessment_results drop constraint assessment_results_assessment_band_check,
  add constraint assessment_results_assessment_band_check check(assessment_band in ('x_plus','g_plus','a','a_plus','s','c'));
update public.course_opportunities set stage='planning',note=concat_ws(E'\n',nullif(note,''),'原续报结果：未记录') where stage='unknown';
alter table public.course_opportunities drop constraint course_opportunities_stage_check,
  add constraint course_opportunities_stage_check check(stage in ('planning','contacted','considering','committed','payment_pending','enrolled','not_enrolled','nurturing'));

-- 来源记录的字段修订继续走原有审计入口。
do $$
declare fn regprocedure;definition text;
begin
  foreach fn in array array['public.business_record_revision_rows(text,uuid)'::regprocedure,'public.get_business_record_revision(text,uuid)'::regprocedure] loop
    definition:=pg_get_functiondef(fn);
    definition:=replace(definition,'record_state=''historical''','source_record_id is not null');
    definition:=replace(definition,'record_state=''''historical''''','source_record_id is not null');
    execute definition;
  end loop;
end;
$$;

-- 业务变更由现有 RPC 权限校验；来源标记不再阻止操作。
create or replace function public.require_current_business_record(p_relation text,p_id uuid) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if p_relation not in ('activities','activity_registrations','assessment_results','course_opportunities','course_enrollments','course_enrollment_assignments','student_follow_ups') then raise exception 'VALIDATION';end if;
end;
$$;

drop trigger activities_fill_term on public.activities;
create trigger activities_fill_term before insert on public.activities for each row when(new.source_record_id is null) execute function public.fill_current_term();
drop trigger student_followups_touch_student on public.student_follow_ups;
create trigger student_followups_touch_student after insert on public.student_follow_ups for each row when(new.source_record_id is null) execute function public.touch_student_follow_up();
drop trigger activity_registrations_seed_public_class_records on public.activity_registrations;
create trigger activity_registrations_seed_public_class_records after insert or update of status on public.activity_registrations for each row when(new.source_record_id is null) execute function public.seed_public_class_registration_records();
drop trigger assessment_results_sync_actual_assessor on public.assessment_results;
create trigger assessment_results_sync_actual_assessor after insert or update of assessed_by on public.assessment_results for each row when(new.assessed_by is not null) execute function public.sync_completed_assessment_actual_assessor();

grant select(source_record_id,note) on public.leads to authenticated;
grant select(source_record_id,source_key,occurred_on) on public.lead_communications to authenticated;
grant select(score_max) on public.assessment_results to authenticated;

-- 每个已确认的来源同时绑定该行已物化的报名事实。
create function public.bind_confirmed_source_business() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if tg_op='UPDATE' and old.student_id<>new.student_id and exists(select 1 from public.course_enrollment_assignments a join public.course_enrollments e on e.id=a.course_enrollment_id where e.source_record_id=new.record_id and a.classroom_id is not null) then raise exception 'SOURCE_IN_USE';end if;
  update public.course_enrollments set student_id=new.student_id where source_record_id=new.record_id and student_id is distinct from new.student_id;
  return new;
end;
$$;
create trigger history_import_associations_bind_business after insert or update on public.history_import_associations for each row execute function public.bind_confirmed_source_business();
revoke all on function public.bind_confirmed_source_business() from public,anon,authenticated,service_role;
