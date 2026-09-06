-- 历史记录在原业务表中修订，原始导入凭据与每次修改前后值继续保留。
create table public.business_record_revisions (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('activity','assessment','renewal','enrollment','communication')),
  record_id uuid not null,
  before_data jsonb not null,
  after_data jsonb not null,
  reason text not null default '' check (length(reason)<=1000),
  recorded_by uuid not null references public.profiles(id) on delete restrict,
  recorded_at timestamptz not null default clock_timestamp(),
  transaction_id bigint not null default txid_current()
);
create index business_record_revisions_record_idx on public.business_record_revisions(kind,record_id,recorded_at desc,id);
alter table public.business_record_revisions enable row level security;
create policy business_record_revisions_read on public.business_record_revisions for select to authenticated using(public.is_admin((select auth.uid())));
revoke all on public.business_record_revisions from public,anon,authenticated,service_role;
grant select on public.business_record_revisions to authenticated;
create trigger business_record_revisions_immutable before update or delete on public.business_record_revisions
  for each row execute function public.guard_communication_record_revision();

do $migration$ declare relation text; begin
  foreach relation in array array['activities','activity_registrations','assessment_results','course_opportunities','course_enrollments','course_enrollment_assignments','student_follow_ups'] loop
    execute format('alter table public.%I add column history_revision integer not null default 0 check(history_revision>=0)',relation);
  end loop;
end $migration$;

-- 新补录的结果可以没有原资料字段；已有来源引用保持原样。
alter table public.activity_registrations drop constraint activity_registrations_reported_result_check,
  add constraint activity_registrations_reported_result_check check (
    (result_link_status='none' and reported_result='')
    or (result_link_status<>'none' and btrim(reported_result)<>''
      and ((result_source_record_id is null and cardinality(result_field_ids)=0)
        or (result_source_record_id is not null and cardinality(result_field_ids)>0))));

create function public.business_record_revision_fields(p_relation text) returns text[]
language sql immutable set search_path=public,pg_temp as $$
  select case p_relation
    when 'activities' then array['title','kind','occurred_on','location','remark']
    when 'activity_registrations' then array['registered_on','status','reported_result','result_link_status']
    when 'assessment_results' then array['assessed_on','assessment_band','score','strengths']
    when 'course_opportunities' then array['period_year','period_key','stage','note','class_label','teacher_label']
    when 'course_enrollments' then array['registered_on','period_label','amount','amount_original']
    when 'course_enrollment_assignments' then array['class_label','teacher_label','room_label','schedule_label']
    when 'student_follow_ups' then array['occurred_on','author_label','content']
  end;
$$;

-- 内部读取同时确定关系闭包。保存按固定顺序锁住这些真实记录后再比较版本。
create function public.business_record_revision_rows(p_kind text,p_id uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare root jsonb; rows jsonb; relation text;
begin
  relation:=case p_kind when 'activity' then 'activity_registrations' when 'assessment' then 'assessment_results'
    when 'renewal' then 'course_opportunities' when 'enrollment' then 'course_enrollments' when 'communication' then 'student_follow_ups' end;
  if relation is null then raise exception 'VALIDATION'; end if;
  execute format('select to_jsonb(t) from public.%I t where id=$1 and record_state=''historical''',relation) into root using p_id;
  if root is null then raise exception 'NOT_FOUND'; end if;
  if p_kind='renewal' and root->>'opportunity_type'<>'renewal' then raise exception 'VALIDATION'; end if;
  rows:=jsonb_build_array(jsonb_build_object('relation',relation,'id',p_id,'data',root));
  if p_kind='activity' then
    select rows||jsonb_build_array(jsonb_build_object('relation','activities','id',a.id,'data',to_jsonb(a))) into rows
      from public.activities a where a.id=(root->>'activity_id')::uuid and a.record_state='historical';
  elsif p_kind='enrollment' then
    select rows||coalesce(jsonb_agg(jsonb_build_object('relation','course_enrollment_assignments','id',a.id,'data',to_jsonb(a)) order by a.id),'[]') into rows
      from public.course_enrollment_assignments a where a.course_enrollment_id=p_id and a.record_state='historical';
    if jsonb_array_length(rows)>2 then raise exception 'MULTIPLE_ASSIGNMENTS'; end if;
  end if;
  if rows is null then raise exception 'NOT_FOUND'; end if;
  return (select jsonb_agg(value order by value->>'relation',value->>'id') from jsonb_array_elements(rows));
end;
$$;

create function public.get_business_record_revision(p_kind text,p_id uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare rows jsonb; sections jsonb:='[]'; item jsonb; fields jsonb; feedback text;
begin
  if auth.uid() is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.is_admin(auth.uid()) then raise exception 'FORBIDDEN'; end if;
  rows:=public.business_record_revision_rows(p_kind,p_id);
  for item in select value from jsonb_array_elements(rows) loop
    select jsonb_object_agg(key,value) into fields from jsonb_each(item->'data')
      where key=any(public.business_record_revision_fields(item->>'relation'));
    if p_kind='assessment' then
      -- 编辑器与工作表共用一份反馈；第一次修订时吸收同源沟通，来源原文仍在凭据中。
      select string_agg(line,E'\n' order by first_seen) into feedback from (
        select btrim(line) line,min(ordinality) first_seen from regexp_split_to_table(
          concat_ws(E'\n',item->'data'->>'strengths',item->'data'->>'parent_concerns',
            case when (item->'data'->>'history_revision')::int=0 then (
              select string_agg(f.content,E'\n' order by f.id) from public.student_follow_ups f
              where f.record_state='historical' and f.context_kind='assessment'
                and f.student_id=(item->'data'->>'student_id')::uuid and f.source_record_id=item->'data'->>'source_record_id'
                and f.source_field_ids && array(select jsonb_array_elements_text(item->'data'->'source_field_ids'))
            ) end),E'\r?\n') with ordinality as lines(line,ordinality)
        where btrim(line)<>'' group by btrim(line)
      ) unique_lines;
      fields:=fields||jsonb_build_object('strengths',coalesce(feedback,''));
    end if;
    sections:=sections||jsonb_build_array(jsonb_build_object('relation',item->>'relation','values',fields));
  end loop;
  return jsonb_build_object('version',md5(rows::text),'sections',sections,'revisions',(
    select coalesce(jsonb_agg(rev order by rev.recorded_at desc,rev.id),'[]') from (
      select r.id,r.recorded_at,coalesce(p.display_name,'') recorded_by,r.reason,r.before_data,r.after_data
        from public.business_record_revisions r left join public.profiles p on p.id=r.recorded_by
        where exists(select 1 from jsonb_array_elements(r.after_data) changed join jsonb_array_elements(rows) target
          on changed->>'relation'=target->>'relation' and changed->>'id'=target->>'id')
        order by r.recorded_at desc,r.id limit 50
    ) rev));
end;
$$;

create function public.revise_business_record(p_kind text,p_id uuid,p_expected_version text,p_values jsonb,p_reason text default '') returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
declare rows jsonb; after_rows jsonb:='[]'; item jsonb; patch jsonb; changed jsonb; pair record; revision_id uuid; assignments text; relation text;
begin
  if auth.uid() is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.is_admin(auth.uid()) then raise exception 'FORBIDDEN'; end if;
  if p_values is null or jsonb_typeof(p_values)<>'object' or p_reason is null or length(p_reason)>1000 then raise exception 'VALIDATION'; end if;
  rows:=public.business_record_revision_rows(p_kind,p_id);
  for item in select value from jsonb_array_elements(rows) loop
    execute format('select 1 from public.%I where id=$1 for update',item->>'relation') using (item->>'id')::uuid;
  end loop;
  rows:=public.business_record_revision_rows(p_kind,p_id);
  if md5(rows::text) is distinct from p_expected_version then raise exception 'REVISION_CONFLICT'; end if;
  if exists(select 1 from jsonb_object_keys(p_values) k where not exists(select 1 from jsonb_array_elements(rows) i where i->>'relation'=k)) then raise exception 'VALIDATION'; end if;
  for item in select value from jsonb_array_elements(rows) loop
    relation:=item->>'relation'; patch:=coalesce(p_values->relation,'{}');
    if jsonb_typeof(patch)<>'object' then raise exception 'VALIDATION'; end if;
    for pair in select * from jsonb_each(patch) loop
      if not pair.key=any(public.business_record_revision_fields(relation)) or jsonb_typeof(pair.value) not in ('string','number','null') then raise exception 'VALIDATION'; end if;
      if jsonb_typeof(pair.value)='number' and pair.key not in ('score','amount','period_year') then raise exception 'VALIDATION'; end if;
      if jsonb_typeof(pair.value)='string' and (pair.key in ('score','amount','period_year') or length(pair.value#>>'{}')>20000) then raise exception 'VALIDATION'; end if;
    end loop;
    if relation='assessment_results' and patch ? 'strengths' then patch:=patch||jsonb_build_object('parent_concerns',''); end if;
    if relation='student_follow_ups' and patch ? 'occurred_on' then patch:=patch||jsonb_build_object('date_basis',case when patch->>'occurred_on' is null then 'unknown' else 'source_explicit' end); end if;
    changed:=(item->'data')||patch;
    if changed is distinct from item->'data' then
      changed:=changed||jsonb_build_object('history_revision',(item->'data'->>'history_revision')::int+1);
    end if;
    after_rows:=after_rows||jsonb_build_array(item||jsonb_build_object('data',changed));
  end loop;
  if after_rows=rows then raise exception 'NO_CHANGES'; end if;
  insert into public.business_record_revisions(kind,record_id,before_data,after_data,reason,recorded_by)
    values(p_kind,p_id,rows,after_rows,btrim(p_reason),auth.uid()) returning id into revision_id;
  perform set_config('app.business_record_revision',revision_id::text,true);
  for item in select value from jsonb_array_elements(after_rows) loop
    relation:=item->>'relation';
    if item=(select value from jsonb_array_elements(rows) where value->>'relation'=relation) then continue; end if;
    select string_agg(format('%I=v.%I',key,key),',') into assignments from jsonb_object_keys(item->'data') key
      where key=any(public.business_record_revision_fields(relation)||array['history_revision']
        ||case when relation='assessment_results' then array['parent_concerns'] when relation='student_follow_ups' then array['date_basis'] else '{}'::text[] end);
    execute format('update public.%I t set %s from jsonb_populate_record(null::public.%I,$1) v where t.id=$2',relation,assignments,relation)
      using item->'data',(item->>'id')::uuid;
  end loop;
  perform set_config('app.business_record_revision','',true);
  return revision_id;
exception when invalid_text_representation or datetime_field_overflow or check_violation or not_null_violation or numeric_value_out_of_range then raise exception 'VALIDATION';
end;
$$;

-- 凭同事务内、管理员 RPC 签发的精确前后值放行修订；普通写入和删除继续受保护。
create or replace function public.guard_business_record_state() returns trigger language plpgsql set search_path=public,pg_temp as $guard$
declare subject_id uuid; parent_state text;
begin
  if tg_op<>'INSERT' and old.record_state='historical' then
    if tg_op='UPDATE' and current_user='postgres' and public.is_admin(auth.uid()) and exists(
      select 1 from public.business_record_revisions r
      join lateral jsonb_array_elements(r.before_data) b on b->>'relation'=tg_table_name and b->>'id'=old.id::text
      join lateral jsonb_array_elements(r.after_data) a on a->>'relation'=tg_table_name and a->>'id'=old.id::text
      where r.id::text=current_setting('app.business_record_revision',true) and r.recorded_by=auth.uid() and r.transaction_id=txid_current()
        and ((b->'data')-'updated_at')=(to_jsonb(old)-'updated_at') and ((a->'data')-'updated_at')=(to_jsonb(new)-'updated_at')
    ) then return new; end if;
    raise exception 'HISTORICAL_RECORD_READ_ONLY';
  end if;
  if tg_op='DELETE' then return old; end if;
  if new.record_state='historical' then
    if tg_op<>'INSERT' or session_user<>'postgres' or auth.uid() is not null
      or coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb->>'role' is not null then raise exception 'HISTORICAL_RECORD_IMPORT_REQUIRED'; end if;
    if tg_table_name='course_enrollment_assignments' then select student_id into subject_id from public.course_enrollments where id=new.course_enrollment_id;
    elsif tg_table_name<>'activities' then subject_id:=new.student_id; end if;
    if tg_table_name<>'activities' and not exists(select 1 from public.history_import_records where id=new.source_record_id and student_id=subject_id) then raise exception 'HISTORICAL_RECORD_IDENTITY_MISMATCH'; end if;
  end if;
  if tg_table_name='activity_registrations' then select record_state into parent_state from public.activities where id=new.activity_id;
  elsif tg_table_name='assessment_results' then select record_state into parent_state from public.activity_registrations where id=new.activity_registration_id;
  elsif tg_table_name='course_enrollment_assignments' then select record_state into parent_state from public.course_enrollments where id=new.course_enrollment_id;
  elsif tg_table_name='course_enrollments' and new.opportunity_id is not null then select record_state into parent_state from public.course_opportunities where id=new.opportunity_id; end if;
  if parent_state is not null and parent_state<>new.record_state then raise exception 'HISTORICAL_RECORD_RELATION_MISMATCH'; end if;
  return new;
end $guard$;

revoke all on function public.business_record_revision_fields(text),public.business_record_revision_rows(text,uuid),
  public.get_business_record_revision(text,uuid),public.revise_business_record(text,uuid,text,jsonb,text) from public,anon,authenticated,service_role;
grant execute on function public.get_business_record_revision(text,uuid),public.revise_business_record(text,uuid,text,jsonb,text) to authenticated;
