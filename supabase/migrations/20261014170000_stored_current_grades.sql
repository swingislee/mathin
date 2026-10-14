-- 当前年级改为存储字段。读取直接使用存储值；导入、建档与人工修改时，按记录日期所在学年换算到当前学年再写入；
-- 学年切换时统一升级一次。来源原文保留在归档记录中，换算只在写入时发生。
-- 多个来源时以记录时间最新的明确年级为准；人工清空的年级同样按时间参与。
alter table public.students add column grade_observed_at timestamptz;
alter table public.leads add column grade_observed_at timestamptz;
comment on column public.students.grade_basis_code is '当前年级代码：-3 托班 … 0 大班，1–12 年级，13 已毕业。读取直接使用。';
comment on column public.students.grade_basis_year is '当前年级所在学年（起始年）；学年切换时与年级一起升级。';
comment on column public.students.grade_observed_at is '该年级依据的记录时间；较新的来源或人工修改覆盖较旧的记录。';
comment on column public.leads.grade_basis_code is '当前年级代码：-3 托班 … 0 大班，1–12 年级，13 已毕业。读取直接使用。';
comment on column public.leads.grade_basis_year is '当前年级所在学年（起始年）；学年切换时与年级一起升级。';
comment on column public.leads.grade_observed_at is '该年级依据的记录时间；较新的来源或人工修改覆盖较旧的记录。';

-- 机构时区的内部读取：迁移、导入与触发器无登录身份时同样可用。
create function public.school_organization_timezone() returns text
language sql stable security definer set search_path=public,pg_temp as $$
  select coalesce((select timezone from public.organizations where singleton_key=1),'Asia/Shanghai')
$$;

create function public.school_grade_label(p_code integer) returns text
language sql immutable set search_path=public,pg_temp as $$
  select case p_code when -3 then '托班' when -2 then '小班' when -1 then '中班' when 0 then '大班' when 13 then '已毕业'
    else case when p_code between 1 and 12 then p_code||'年级' end end
$$;

-- 当前学年以管理端启用的学年为准；尚未建立学年时按 7 月换学年推定。
create function public.school_current_grade_year() returns integer
language sql stable set search_path=public,pg_temp as $$
  select coalesce((select start_year from public.school_years where id=public.current_school_year_id()),
    public.school_grade_year((now() at time zone public.school_organization_timezone())::date))
$$;

-- 记录学年的年级换算到目标学年；已毕业不再升级，较早学年不回退。
create function public.school_grade_convert(p_code integer,p_from_year integer,p_to_year integer) returns integer
language sql immutable set search_path=public,pg_temp as $$
  select case when p_code is null then null when p_from_year is null or p_to_year is null then p_code
    else least(13,p_code+greatest(0,p_to_year-p_from_year)) end
$$;

-- 来源记录中的年级及其记录时间：业务获取日期优先，其次为原表登记时间与快照日期。
-- 无任何日期的来源按入库学年计年级，记录时间留空，只在没有其他依据时使用。
create function public.school_source_record_grade(p_record jsonb,p_filter public.school_source_filter_values,p_snapshot_date text,p_imported_at timestamptz)
returns table(code integer,school_year integer,observed_at timestamptz,raw_text text)
language sql stable set search_path=public,pg_temp as $$
  with zone as (select public.school_organization_timezone() as name), observed as (
    select coalesce(
      (p_filter).acquired_on::timestamp at time zone z.name,
      (select to_timestamp((c->'rawValue'->'recMeta'->>'createdTime')::double precision) from jsonb_array_elements(p_record->'cells') c
        where c->>'fieldId'='__record_metadata' and c->'rawValue'->'recMeta'->>'createdTime' ~ '^[0-9]{9,11}(\.[0-9]+)?$' limit 1),
      case when p_snapshot_date ~ '^20[0-9]{2}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$' then p_snapshot_date::date::timestamp at time zone z.name end) as at,
      z.name from zone z
  ) select (p_filter).grade_code,
      coalesce((p_filter).grade_year,public.school_grade_year((coalesce(o.at,p_imported_at) at time zone o.name)::date)),o.at,(p_filter).grade_text
    from observed o where nullif(btrim((p_filter).grade_text),'') is not null
$$;

-- 主体的年级依据：存储值、人工更正、来源表、表单、正式档案与手工建立线索的原值中，记录时间最新的明确年级。
-- 由来源导入的线索，其年级字段取自来源记录，以来源记录的日期为准，不以线索入库时间计。
create function public.school_resolve_subject_grades(p_subjects jsonb)
returns table(key text,code integer,school_year integer,observed_at timestamptz,raw_text text,source text)
language sql stable security definer set search_path=public,pg_temp as $$
  with subjects as materialized (
    select * from jsonb_to_recordset(p_subjects) as v(key text,"studentId" uuid,"leadId" uuid)
  ), zone as materialized (
    select public.school_organization_timezone() as name,public.school_current_grade_year() as current_year
  ), history_refs as materialized (
    select distinct v.key,links.source_id from subjects v
    join public.school_source_subject_links links on links.subject_key=coalesce('student:'||v."studentId",'lead:'||v."leadId")
    join public.school_source_current_records cr on cr.id=links.source_id
  ), evidence as (
    select v.key,s.grade_basis_code as code,s.grade_basis_year as school_year,s.grade_observed_at as observed_at,null::text as raw_text,'stored'::text as source,2 as rank
    from subjects v join public.students s on s.id=v."studentId" where s.grade_basis_year is not null
    union all
    select v.key,l.grade_basis_code,l.grade_basis_year,l.grade_observed_at,l.grade_text,'stored',2
    from subjects v join public.leads l on l.id=v."leadId" where v."studentId" is null and l.grade_basis_year is not null
    union all
    select v.key,nullif(c.after_data->>'grade','')::integer,public.school_grade_year((c.recorded_at at time zone z.name)::date),c.recorded_at,null,'correction',1
    from subjects v cross join zone z join public.school_support_change_log c on
      (v."studentId" is not null and c.student_id=v."studentId" or v."studentId" is null and c.lead_id=v."leadId")
    where c.kind='profile' and c.before_data->'grade' is distinct from c.after_data->'grade'
    union all
    select r.key,g.code,g.school_year,g.observed_at,g.raw_text,'source',3
    from history_refs r join public.history_import_records h on h.id=r.source_id
    cross join lateral public.school_source_record_grade(h.record_data,h.school_filter_values,h.source_snapshot_date,h.imported_at) g
    union all
    select v.key,public.school_grade_code(r.raw_grade_text),public.school_grade_year((coalesce(r.submitted_at,r.created_at) at time zone z.name)::date),
      coalesce(r.submitted_at,r.created_at),r.raw_grade_text,'intake',4
    from subjects v cross join zone z join public.leads l on l.id=v."leadId" or l.student_id=v."studentId"
    join public.lead_source_records r on r.lead_id=l.id where nullif(btrim(r.raw_grade_text),'') is not null
    union all
    select v.key,s.grade,coalesce(y.start_year,z.current_year),coalesce(y.recorded_at,s.created_at),null,'profile',5
    from subjects v cross join zone z join public.students s on s.id=v."studentId"
    left join lateral (select school_year.start_year,history.recorded_at from public.student_school_year_grades history
      join public.school_years school_year on school_year.id=history.school_year_id
      where history.student_id=s.id and history.grade=s.grade order by school_year.start_year desc,history.recorded_at desc limit 1) y on true
    where s.grade is not null and s.grade_basis_year is null
    union all
    select v.key,coalesce(l.grade_hint,public.school_grade_code(l.grade_text)),public.school_grade_year((l.created_at at time zone z.name)::date),l.created_at,l.grade_text,'lead',6
    from subjects v cross join zone z join public.leads l on l.id=v."leadId" or l.student_id=v."studentId"
    where l.source_record_id is null and l.grade_basis_year is null and (l.grade_hint is not null or nullif(btrim(l.grade_text),'') is not null)
  ) select distinct on(e.key) e.key,e.code,e.school_year,e.observed_at,e.raw_text,e.source from evidence e
    order by e.key,(e.code is null and e.source<>'correction'),e.observed_at desc nulls last,e.rank
$$;

-- 按依据重写存储年级（换算到当前学年）；来源导入后调用。参数均为空时处理全部学生与线索。
create function public.school_refresh_subject_grades(p_student_ids uuid[] default null,p_lead_ids uuid[] default null)
returns integer language plpgsql security definer set search_path=public,pg_temp as $$
declare current_year integer:=public.school_current_grade_year(); everyone boolean:=p_student_ids is null and p_lead_ids is null;
  changed integer:=0; n integer;
begin
  perform set_config('mathin.grade_system_write','on',true);
  create temp table if not exists school_grade_resolution(key text primary key,current_code integer,observed_at timestamptz,raw_text text,known boolean) on commit drop;
  truncate school_grade_resolution;
  insert into school_grade_resolution(key,current_code,observed_at,raw_text,known)
  select r.key,public.school_grade_convert(r.code,r.school_year,current_year),r.observed_at,r.raw_text,r.code is not null or r.source='correction'
  from public.school_resolve_subject_grades((select coalesce(jsonb_agg(jsonb_build_object('key',s.key,'studentId',s.student_id,'leadId',s.lead_id)),'[]'::jsonb) from (
    select 'student:'||s.id as key,s.id as student_id,null::uuid as lead_id from public.students s
    where everyone or s.id=any(p_student_ids) or s.id in (select l.student_id from public.leads l where l.id=any(p_lead_ids))
    union all
    select 'lead:'||l.id,null,l.id from public.leads l where l.student_id is null and (everyone or l.id=any(p_lead_ids))
  ) s)) r;

  update public.students s set grade_basis_code=r.current_code,grade_basis_year=current_year,grade_observed_at=r.observed_at,
      grade=case when r.current_code between 1 and 12 then r.current_code end
    from school_grade_resolution r
    where r.known and r.key='student:'||s.id and (s.grade_basis_code,s.grade_basis_year,s.grade_observed_at,s.grade)
      is distinct from (r.current_code,current_year,r.observed_at,case when r.current_code between 1 and 12 then r.current_code end);
  get diagnostics n=row_count; changed:=changed+n;
  -- 线索与其正式学生共用一个年级。
  update public.leads l set grade_basis_code=r.current_code,grade_basis_year=current_year,grade_observed_at=r.observed_at,
      grade_hint=case when r.current_code between 1 and 12 then r.current_code end,
      grade_text=coalesce(public.school_grade_label(r.current_code),'')
    from school_grade_resolution r
    where r.known and r.key=coalesce('student:'||l.student_id,'lead:'||l.id) and (l.grade_basis_code,l.grade_basis_year,l.grade_observed_at,l.grade_hint,l.grade_text)
      is distinct from (r.current_code,current_year,r.observed_at,case when r.current_code between 1 and 12 then r.current_code end,coalesce(public.school_grade_label(r.current_code),''));
  get diagnostics n=row_count; changed:=changed+n;
  -- 年级无法确定时保留最新来源的原文（如“二升三年级”），只补空白，不覆盖已有文字。
  update public.leads l set grade_text=btrim(r.raw_text)
    from school_grade_resolution r
    where not r.known and r.key=coalesce('student:'||l.student_id,'lead:'||l.id)
      and nullif(btrim(l.grade_text),'') is null and nullif(btrim(r.raw_text),'') is not null;
  get diagnostics n=row_count; changed:=changed+n;
  -- 正式档案的学年年级历史标记为系统换算，而非人工修改。
  update public.student_school_year_grades set source='migration' where source='manual' and recorded_by is null and recorded_at=now();
  perform set_config('mathin.grade_system_write','off',true);
  return changed;
end;
$$;

-- 人工修改年级时记录修改时间，作为之后比较来源新旧的依据；系统换算与学年升级不改记录时间。
create function public.mark_school_grade_observed() returns trigger
language plpgsql set search_path=public,pg_temp as $$
begin
  if coalesce(current_setting('mathin.grade_system_write',true),'')<>'on' and auth.uid() is not null
    and (new.grade_basis_code,new.grade_basis_year) is distinct from (old.grade_basis_code,old.grade_basis_year)
    and new.grade_observed_at is not distinct from old.grade_observed_at then
    new.grade_observed_at:=now();
  end if;
  return new;
end;
$$;
create trigger students_grade_observed before update of grade,grade_basis_code,grade_basis_year on public.students
  for each row execute function public.mark_school_grade_observed();
create trigger leads_grade_observed before update of grade_hint,grade_basis_code,grade_basis_year on public.leads
  for each row execute function public.mark_school_grade_observed();

-- 新建档案与导入：年级按其记录日期所在学年换算为当前年级。导入的线索以来源记录为准，
-- 其余以建档时间为准（补录的历史档案按原建档日期）。
create function public.school_initial_grade() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare current_year integer; code integer; from_year integer; observed timestamptz; sourced boolean:=false;
begin
  if new.grade_basis_year is not null then return new; end if;
  current_year:=public.school_current_grade_year();
  observed:=coalesce(new.grade_observed_at,new.created_at,now());
  from_year:=public.school_grade_year((observed at time zone public.school_organization_timezone())::date);
  if tg_table_name='students' then
    if new.grade is null then return new; end if;
    new.grade_basis_code:=public.school_grade_convert(new.grade,from_year,current_year); new.grade_basis_year:=current_year; new.grade_observed_at:=observed;
    new.grade:=case when new.grade_basis_code between 1 and 12 then new.grade_basis_code end;
    return new;
  end if;
  code:=coalesce(new.grade_hint,public.school_grade_code(new.grade_text));
  if code is null then return new; end if;
  if new.source_record_id is not null then
    select g.school_year,g.observed_at into from_year,observed from public.history_import_records h
      cross join lateral public.school_source_record_grade(h.record_data,h.school_filter_values,h.source_snapshot_date,h.imported_at) g
      where h.id=new.source_record_id;
    sourced:=found;
  end if;
  if new.source_record_id is not null and not sourced then
    -- 来源记录尚未入库：先按建档学年写入，记录时间留空，由导入后的刷新按来源日期改正。
    observed:=null;
    from_year:=public.school_grade_year((coalesce(new.created_at,now()) at time zone public.school_organization_timezone())::date);
  end if;
  new.grade_basis_code:=public.school_grade_convert(code,coalesce(from_year,current_year),current_year);
  new.grade_basis_year:=current_year;
  new.grade_observed_at:=observed;
  new.grade_hint:=case when new.grade_basis_code between 1 and 12 then new.grade_basis_code end;
  new.grade_text:=coalesce(public.school_grade_label(new.grade_basis_code),new.grade_text);
  return new;
end;
$$;
create trigger students_initial_grade before insert on public.students for each row execute function public.school_initial_grade();
create trigger leads_initial_grade before insert on public.leads for each row execute function public.school_initial_grade();

-- 读取直接使用存储年级；保留原有返回结构与调用参数。年级无法确定时显示来源原文。
create or replace function public.school_current_subject_grades(p_subjects jsonb,p_on date)
returns table(key text,value jsonb) language sql stable security definer set search_path=public,pg_temp as $$
  select v.key,jsonb_build_object('code',g.code,'grade',case when g.code between 1 and 12 then g.code end,
      'gradeText',coalesce(public.school_grade_label(g.code),case when g.code is null then coalesce(nullif(btrim(l.grade_text),''),
        (select btrim(linked.grade_text) from public.leads linked where s.id is not null and linked.student_id=s.id
          and nullif(btrim(linked.grade_text),'') is not null order by linked.updated_at desc,linked.id limit 1)) end,''),'basisYear',g.year)
  from jsonb_to_recordset(p_subjects) as v(key text,"studentId" uuid,"leadId" uuid)
  left join public.students s on s.id=v."studentId" left join public.leads l on l.id=v."leadId"
  cross join lateral (select
    case when s.id is not null then coalesce(s.grade_basis_code,s.grade,l.grade_basis_code,l.grade_hint) else coalesce(l.grade_basis_code,l.grade_hint) end as code,
    case when s.id is not null then coalesce(s.grade_basis_year,l.grade_basis_year) else l.grade_basis_year end as year) g
$$;

-- 学年切换时同时升级全部存储年级（含幼儿园与线索）；系统升级不改年级记录时间。
do $activation$
declare definition text; anchor text;
begin
  definition:=pg_get_functiondef('public.activate_school_year(uuid,date,integer)'::regprocedure);
  anchor:='  update public.students set grade = grade + 1, grade_basis_code = grade + 1, grade_basis_year = target.start_year';
  if position(anchor in definition)=0 then raise exception 'STORED_GRADE_ACTIVATION_CHANGED'; end if;
  definition:=replace(definition,anchor,'  perform set_config(''mathin.grade_system_write'',''on'',true);'||chr(10)||anchor);
  anchor:='and grade between 1 and 11 and coalesce(grade_basis_year,current_year.start_year)<target.start_year;';
  if position(anchor in definition)=0 then raise exception 'STORED_GRADE_ACTIVATION_END_CHANGED'; end if;
  definition:=replace(definition,anchor,anchor||$promote$
  update public.students set grade_basis_code = public.school_grade_convert(grade_basis_code, grade_basis_year, target.start_year),
      grade = case when public.school_grade_convert(grade_basis_code, grade_basis_year, target.start_year) between 1 and 12
        then public.school_grade_convert(grade_basis_code, grade_basis_year, target.start_year) else grade end,
      grade_basis_year = target.start_year
    where deleted_at is null and grade_basis_year < target.start_year;
  update public.leads set grade_basis_code = public.school_grade_convert(grade_basis_code, grade_basis_year, target.start_year),
      grade_basis_year = target.start_year,
      grade_hint = case when public.school_grade_convert(grade_basis_code, grade_basis_year, target.start_year) between 1 and 12
        then public.school_grade_convert(grade_basis_code, grade_basis_year, target.start_year) end,
      grade_text = coalesce(public.school_grade_label(public.school_grade_convert(grade_basis_code, grade_basis_year, target.start_year)), grade_text)
    where grade_basis_year < target.start_year and grade_basis_code is not null;
  perform set_config('mathin.grade_system_write', 'off', true);$promote$);
  execute definition;
end $activation$;

revoke all on function public.school_organization_timezone(),public.school_grade_label(integer),public.school_current_grade_year(),public.school_grade_convert(integer,integer,integer),
  public.school_source_record_grade(jsonb,public.school_source_filter_values,text,timestamptz),public.school_resolve_subject_grades(jsonb),
  public.school_refresh_subject_grades(uuid[],uuid[]),public.mark_school_grade_observed(),public.school_initial_grade()
  from public,anon,authenticated;
grant execute on function public.school_refresh_subject_grades(uuid[],uuid[]) to service_role;

-- 一次写入现有学生与线索的当前年级；技术换算不改变业务更新时间。
alter table public.students disable trigger students_set_updated_at;
alter table public.leads disable trigger leads_set_updated_at;
select public.school_refresh_subject_grades();
alter table public.students enable trigger students_set_updated_at;
alter table public.leads enable trigger leads_set_updated_at;
notify pgrst,'reload schema';
