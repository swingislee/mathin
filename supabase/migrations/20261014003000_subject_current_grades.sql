-- 当前年级由基准年级与学年推算。每年 7 月换学年；历史采集在 2026-07 前统一按 2025 学年。
-- 原始来源不回写。人工更正记录当前学年，未知年级保持未知。
alter table public.leads add column grade_basis_year integer check(grade_basis_year between 2000 and 2200),
  add column grade_basis_code smallint check(grade_basis_code between -3 and 13);
alter table public.students add column grade_basis_year integer check(grade_basis_year between 2000 and 2200),
  add column grade_basis_code smallint check(grade_basis_code between -3 and 13);

create function public.school_grade_year(p_on date) returns integer
language sql immutable strict set search_path=public,pg_temp as $$
  select extract(year from p_on)::integer-case when extract(month from p_on)<7 then 1 else 0 end
$$;
create function public.school_grade_code(p_text text) returns integer
language sql immutable set search_path=public,pg_temp as $$
  select case btrim(p_text) when '托班' then -3 when '小班' then -2 when '中班' then -1 when '大班' then 0
    when '已毕业' then 13 else public.school_source_grade_number(p_text) end
$$;
create function public.school_grade_projection(p_code integer,p_year integer,p_on date) returns jsonb
language sql immutable set search_path=public,pg_temp as $$
  with current_value as (select case when p_code is not null then least(13,p_code+greatest(0,public.school_grade_year(p_on)-p_year)) end as code)
  select jsonb_build_object('code',code,'grade',case when code between 1 and 12 then code end,
    'gradeText',case code when -3 then '托班' when -2 then '小班' when -1 then '中班' when 0 then '大班'
      when 13 then '已毕业' else case when code is not null then code||'年级' else '' end end,'basisYear',p_year) from current_value
$$;
create function public.school_source_acquisition_date(p_record jsonb) returns date
language plpgsql immutable set search_path=public,pg_temp as $$
declare value text; parts text[];
begin
  select nullif(btrim(c->>'text'),'') into value from jsonb_array_elements(coalesce(p_record->'cells','[]')) c
    where regexp_replace(c->>'fieldName','^A:[[:space:]]*','') in ('获取日期','获取时间','采集日期','采集时间')
    and nullif(btrim(c->>'text'),'') is not null limit 1;
  parts:=regexp_match(value,'^(20[0-9]{2})[-/.年]([0-9]{1,2})[-/.月]([0-9]{1,2})');
  if parts is null then return null; end if;
  return make_date(parts[1]::integer,parts[2]::integer,parts[3]::integer);
exception when datetime_field_overflow then return null;
end;
$$;

create function public.school_current_subject_grades(p_subjects jsonb,p_on date)
returns table(key text,value jsonb) language sql stable security definer set search_path=public,pg_temp as $$
  with subjects as materialized (
    select * from jsonb_to_recordset(p_subjects) as v(key text,"studentId" uuid,"leadId" uuid)
  ), intake as materialized (
    select distinct on(v.key) v.key,r.raw_grade_text,r.submitted_at
    from subjects v join public.leads l on l.id=v."leadId" or l.student_id=v."studentId"
    join public.lead_source_records r on r.lead_id=l.id where nullif(btrim(r.raw_grade_text),'') is not null
    order by v.key,r.submitted_at desc nulls last,r.created_at desc,r.id
  ), history as materialized (
    select distinct on(v.key) v.key,h.record_data,public.school_source_acquisition_date(h.record_data) as acquired_on,
      fields.grade_text,case when h.record_data->>'tableName'='2026秋季在读学员表格' then 2026 end as school_year
    from subjects v join public.school_source_subject_links links on links.subject_key=coalesce('student:'||v."studentId",'lead:'||v."leadId")
    join public.school_source_current_records cr on cr.id=links.source_id
    join public.history_import_records h on h.id=cr.id
    cross join lateral (select btrim(c->>'text') as grade_text from jsonb_array_elements(h.record_data->'cells') c
      where regexp_replace(c->>'fieldName','^A:[[:space:]]*','') in ('当前年级','年级','年级/26级','年级/25级','学生年级')
        and nullif(btrim(c->>'text'),'') is not null
      order by array_position(array['当前年级','年级','年级/26级','年级/25级','学生年级'],regexp_replace(c->>'fieldName','^A:[[:space:]]*','')) limit 1) fields
    order by v.key,public.school_source_acquisition_date(h.record_data) desc nulls last,h.source_snapshot_date desc,h.id
  ), corrections as materialized (
    select distinct on(v.key) v.key,c.after_data->>'grade' as grade_text,c.recorded_at
    from subjects v join public.school_support_change_log c on
      (v."studentId" is not null and c.student_id=v."studentId" or v."studentId" is null and c.lead_id=v."leadId")
    where c.kind='profile' and c.before_data->'grade' is distinct from c.after_data->'grade'
    order by v.key,c.recorded_at desc,c.id desc
  ), student_years as materialized (
    select distinct on(v.key) v.key,y.start_year from subjects v join public.students s on s.id=v."studentId"
    join public.student_school_year_grades g on g.student_id=s.id and g.grade=s.grade
    join public.school_years y on y.id=g.school_year_id order by v.key,y.start_year desc,g.recorded_at desc
  ), bases as (
    select v.key,
      case when s.grade_basis_year is not null then s.grade_basis_code
        when s.id is null and l.grade_basis_year is not null then l.grade_basis_code
        when c.key is not null then c.grade_text::integer
        when s.id is not null and s.grade is not null then s.grade
        when l.grade_basis_year is not null then l.grade_basis_code
        when i.key is not null then public.school_grade_code(i.raw_grade_text)
        when h.key is not null then public.school_grade_code(h.grade_text)
        else coalesce(l.grade_hint,public.school_grade_code(l.grade_text)) end as code,
      case when s.grade_basis_year is not null then s.grade_basis_year
        when s.id is null and l.grade_basis_year is not null then l.grade_basis_year
        when c.key is not null then public.school_grade_year((c.recorded_at at time zone public.get_organization_timezone_v2())::date)
        when s.id is not null and s.grade is not null then coalesce(sy.start_year,(select start_year from public.school_years where id=public.current_school_year_id()),public.school_grade_year(p_on))
        when l.grade_basis_year is not null then l.grade_basis_year
        when i.key is not null then case when i.submitted_at is not null then greatest(2025,public.school_grade_year((i.submitted_at at time zone public.get_organization_timezone_v2())::date)) end
        when h.key is not null then coalesce(h.school_year,case when h.acquired_on is not null then greatest(2025,public.school_grade_year(h.acquired_on)) end)
        when l.source_record_id is null then greatest(2025,public.school_grade_year((l.created_at at time zone public.get_organization_timezone_v2())::date)) end as basis_year,
      coalesce(i.raw_grade_text,h.grade_text,l.grade_text,'') as raw_text
    from subjects v left join public.students s on s.id=v."studentId" left join public.leads l on l.id=v."leadId"
    left join intake i on i.key=v.key left join history h on h.key=v.key left join corrections c on c.key=v.key left join student_years sy on sy.key=v.key
  ) select b.key,public.school_grade_projection(b.code,b.basis_year,p_on)||jsonb_build_object('gradeText',
    case when b.code is null and b.basis_year is null then b.raw_text else public.school_grade_projection(b.code,b.basis_year,p_on)->>'gradeText' end) from bases b
$$;

create function public.capture_school_grade_basis() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare previous jsonb:=to_jsonb(old); incoming jsonb:=to_jsonb(new); grade_field text:=case when tg_table_name='students' then 'grade' else 'grade_hint' end;
begin
  if auth.uid() is not null and incoming->grade_field is distinct from previous->grade_field
    and incoming->'grade_basis_year' is not distinct from previous->'grade_basis_year'
    and incoming->'grade_basis_code' is not distinct from previous->'grade_basis_code' then
    new.grade_basis_year:=public.school_grade_year((now() at time zone public.get_organization_timezone_v2())::date);
    new.grade_basis_code:=(incoming->>grade_field)::smallint;
  end if;
  return new;
end;
$$;
create trigger students_current_grade_basis before update of grade on public.students for each row execute function public.capture_school_grade_basis();
create trigger leads_current_grade_basis before update of grade_hint on public.leads for each row execute function public.capture_school_grade_basis();

-- 在现有修订入口读写当前年级，权限、并发版本和修订日志保持同一合同。
do $profile$
declare definition text; anchor text;
begin
  definition:=pg_get_functiondef('public.read_school_support_profile(uuid,uuid)'::regprocedure);
  anchor:='  select coalesce(jsonb_agg(c order by c."recordedAt" desc)';
  if position(anchor in definition)=0 then raise exception 'GRADE_PROFILE_READ_CHANGED'; end if;
  definition:=replace(definition,anchor,$new$  fields:=jsonb_set(fields,'{grade}',coalesce((select value->'code' from public.school_current_subject_grades(
    jsonb_build_array(jsonb_build_object('key',coalesce('student:'||student_id,'lead:'||p_lead_id),'studentId',student_id,'leadId',p_lead_id)),
    (now() at time zone public.get_organization_timezone_v2())::date)),'null'::jsonb));
  select coalesce(jsonb_agg(c order by c."recordedAt" desc)$new$);
  execute definition;
  definition:=pg_get_functiondef('public.update_school_support_profile(uuid,uuid,text,jsonb)'::regprocedure);
  definition:=replace(definition,'remark text:=coalesce(p_values->>''remark'','''');','remark text:=coalesce(p_values->>''remark'',''''); grade_changed boolean; basis_year integer:=public.school_grade_year((now() at time zone public.get_organization_timezone_v2())::date);');
  definition:=replace(definition,'grade not between 1 and 12','grade not between -3 and 13');
  anchor:='  if student_id is not null then'||chr(10)||'    update public.students set name=name,grade=grade,';
  if position(anchor in definition)=0 then raise exception 'GRADE_PROFILE_WRITE_CHANGED'; end if;
  definition:=replace(definition,anchor,$new$  grade_changed:=p_values->'grade' is distinct from snapshot->'values'->'grade';
  if student_id is not null then
    update public.students set name=name,grade=case when grade_changed then case when grade between 1 and 12 then grade end else s.grade end,
      grade_basis_year=case when grade_changed then basis_year else s.grade_basis_year end,
      grade_basis_code=case when grade_changed then grade else s.grade_basis_code end,$new$);
  definition:=replace(definition,'grade_hint=case when linked.grade_hint is not distinct from s.grade then grade else linked.grade_hint end,',
    $new$grade_hint=case when grade_changed and linked.grade_hint is not distinct from s.grade then case when grade between 1 and 12 then grade end else linked.grade_hint end,
      grade_text=case when grade_changed and linked.grade_hint is not distinct from s.grade then public.school_grade_projection(grade,basis_year,(now() at time zone public.get_organization_timezone_v2())::date)->>'gradeText' else linked.grade_text end,
      grade_basis_year=case when grade_changed and linked.grade_hint is not distinct from s.grade then basis_year else linked.grade_basis_year end,
      grade_basis_code=case when grade_changed and linked.grade_hint is not distinct from s.grade then grade else linked.grade_basis_code end,$new$);
  anchor:='grade_hint=grade,note=remark';
  if position(anchor in definition)=0 then raise exception 'GRADE_LEAD_WRITE_CHANGED'; end if;
  definition:=replace(definition,anchor,$new$grade_hint=case when grade_changed then case when grade between 1 and 12 then grade end else l.grade_hint end,
      grade_text=case when grade_changed then public.school_grade_projection(grade,basis_year,(now() at time zone public.get_organization_timezone_v2())::date)->>'gradeText' else l.grade_text end,
      grade_basis_year=case when grade_changed then basis_year else l.grade_basis_year end,
      grade_basis_code=case when grade_changed then grade else l.grade_basis_code end,note=remark$new$);
  execute definition;
end $profile$;

-- 已手工标定目标学年的档案，在管理端启用学年时不再重复升一级。
do $activation$
declare definition text; anchor text;
begin
  definition:=pg_get_functiondef('public.get_school_year_activation_preview(uuid)'::regprocedure);
  anchor:='count(*) filter (where student_row.grade < 12)';
  if position(anchor in definition)=0 then raise exception 'GRADE_ACTIVATION_PREVIEW_CHANGED'; end if;
  definition:=replace(definition,anchor,'count(*) filter (where student_row.grade < 12 and coalesce(student_row.grade_basis_year,current_year.start_year)<target.start_year)');
  execute definition;
  definition:=pg_get_functiondef('public.activate_school_year(uuid,date,integer)'::regprocedure);
  definition:=replace(definition,'and student_row.grade between 1 and 11;',
    'and student_row.grade between 1 and 11 and coalesce(student_row.grade_basis_year,current_year.start_year)<target.start_year;');
  anchor:='update public.students set grade = grade + 1';
  if position(anchor in definition)=0 then raise exception 'GRADE_ACTIVATION_WRITE_CHANGED'; end if;
  definition:=replace(definition,anchor,'update public.students set grade = grade + 1, grade_basis_code = grade + 1, grade_basis_year = target.start_year');
  definition:=replace(definition,'and grade between 1 and 11;',
    'and grade between 1 and 11 and coalesce(grade_basis_year,current_year.start_year)<target.start_year;');
  execute definition;
end $activation$;

-- 共用学生记录读取与保存响应使用同一当前年级，保留原来的可见范围与顺序。
create function public.school_apply_current_grades(p_rows jsonb) returns jsonb
language sql stable security definer set search_path=public,pg_temp as $$
  with rows as materialized (select value,ordinal from jsonb_array_elements(p_rows) with ordinality r(value,ordinal)),
  grades as materialized (select g.* from public.school_current_subject_grades(coalesce((select jsonb_agg(jsonb_build_object(
    'key',ordinal::text,'studentId',value->>'studentId','leadId',value->>'leadId')) from rows),'[]'::jsonb),
    (now() at time zone public.get_organization_timezone_v2())::date) g)
  select coalesce(jsonb_agg(r.value||coalesce(g.value-'code'-'basisYear','{}'::jsonb) order by r.ordinal),'[]'::jsonb)
    from rows r left join grades g on g.key=r.ordinal::text
$$;
do $records$
declare definition text; anchor text;
begin
  definition:=pg_get_functiondef('public.read_student_record_with_context(uuid,uuid,public.business_course_enrollment_subjects[],jsonb)'::regprocedure);
  anchor:='return public.school_collaboration_row(jsonb_build_object(';
  if position(anchor in definition)=0 then raise exception 'GRADE_SINGLE_RECORD_CHANGED'; end if;
  definition:=replace(definition,anchor,'return (public.school_apply_current_grades(jsonb_build_array(public.school_collaboration_row(jsonb_build_object(');
  anchor:=$anchor$'assessmentAt',background->'assessmentAt') else '{}'::jsonb end);$anchor$;
  if position(anchor in definition)=0 then raise exception 'GRADE_SINGLE_RECORD_END_CHANGED'; end if;
  definition:=replace(definition,anchor,$anchor$'assessmentAt',background->'assessmentAt') else '{}'::jsonb end))))->0;$anchor$);
  execute definition;
  definition:=pg_get_functiondef('public.student_record_list_rows(jsonb,public.business_course_enrollment_subjects[])'::regprocedure);
  anchor:='  return (';
  if position(anchor in definition)=0 then raise exception 'GRADE_LIST_RECORD_CHANGED'; end if;
  definition:=replace(definition,anchor,'  result:=public.school_apply_current_grades(result);'||chr(10)||anchor);
  execute definition;
end $records$;

revoke all on function public.school_grade_year(date),public.school_grade_code(text),public.school_grade_projection(integer,integer,date),
  public.school_source_acquisition_date(jsonb),public.school_current_subject_grades(jsonb,date),public.capture_school_grade_basis(),public.school_apply_current_grades(jsonb)
  from public,anon,authenticated,service_role;
notify pgrst,'reload schema';
