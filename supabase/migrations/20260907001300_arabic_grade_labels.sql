-- 1–7 年级的业务名称与标签统一使用阿拉伯数字。
-- 数值年级、身份、来源凭据、内容 revision、release 与课堂冻结快照保持原值。
create or replace function mathin_internal.normalize_grade_text(value text)
returns text
language plpgsql immutable strict
set search_path = pg_catalog
as $$
declare
  result text := value;
  grade integer;
begin
  for grade in 1..7 loop
    result := regexp_replace(result,
      '(?<![同这那每某另哪各任统上下一二三四五六七八九十百千万零〇两0-9])'
        || substr('一二三四五六七', grade, 1)
        || '(?=(?:\s*[至到、，,/／~～—–-]\s*[一二三四五六七1-7])*\s*年级)',
      grade::text, 'g');
  end loop;
  return result;
end
$$;

create or replace function mathin_internal.normalize_grade_label(value text)
returns text
language plpgsql immutable strict
set search_path = pg_catalog
as $$
declare
  compact text := regexp_replace(normalize(value, NFKC), '\s+', '', 'g');
  grade integer;
  word text;
begin
  for grade in 1..7 loop
    word := substr('一二三四五六七', grade, 1);
    if compact in (grade::text, grade::text || '年级', '第' || grade::text, '第' || grade::text || '年级', word || '年级')
      or (grade <= 6 and compact = '小' || word)
      or (grade = 7 and compact = '初一') then
      return grade::text || '年级';
    end if;
  end loop;
  return mathin_internal.normalize_grade_text(value);
end
$$;

-- 触发器只改写声明的文字列；数据库既有授权、校验和审计继续执行。
create or replace function mathin_internal.normalize_business_grade_labels()
returns trigger
language plpgsql security definer
set search_path = pg_catalog
as $$
declare
  field text;
  current_value jsonb := to_jsonb(new);
  patch jsonb := '{}'::jsonb;
  normalized text;
begin
  foreach field in array tg_argv loop
    normalized := case when field = 'grade_text'
      then mathin_internal.normalize_grade_label(current_value->>field)
      else mathin_internal.normalize_grade_text(current_value->>field) end;
    if normalized is distinct from current_value->>field then
      patch := patch || jsonb_build_object(field, normalized);
    end if;
  end loop;
  if patch <> '{}'::jsonb then new := jsonb_populate_record(new, patch); end if;
  return new;
end
$$;

revoke all on function mathin_internal.normalize_grade_text(text) from public, anon, authenticated;
revoke all on function mathin_internal.normalize_grade_label(text) from public, anon, authenticated;
revoke all on function mathin_internal.normalize_business_grade_labels() from public, anon, authenticated;

-- 兼容旧导入名称与新名称的等值匹配，沿用已有班级与课程身份。
create or replace function public.normalize_mofaxiao_class_text(value text)
returns text
language sql immutable
set search_path = public, pg_temp
as $$
  select regexp_replace(lower(trim(mathin_internal.normalize_grade_text(coalesce(value, '')))), '\s+', '', 'g')
$$;

create or replace function public.normalize_teacher_microcourse_course_name(p_title text)
returns text
language sql immutable
set search_path = public, pg_temp
as $$
  select lower(regexp_replace(btrim(mathin_internal.normalize_grade_text(normalize(coalesce(p_title, ''), NFKC))), '[[:space:]]+', ' ', 'g'))
$$;

do $$
declare
  target record;
  columns_sql text;
  arguments_sql text;
  assignments_sql text;
  changed_sql text;
begin
  -- 此清单限定为可编辑业务标签；原始导入内容和冻结内容不在更新范围内。
  for target in select * from (values
    ('courses', array['title']),
    ('course_families', array['title', 'description']),
    ('course_catalog_versions', array['title']),
    ('classrooms', array['name']),
    ('class_sessions', array['title']),
    ('course_lectures', array['name']),
    ('cw_page_docs', array['title']),
    ('activities', array['title']),
    ('organization_academic_grades', array['name_zh']),
    ('leads', array['grade_text']),
    ('teacher_microcourses', array['variant_name']),
    ('teacher_microcourse_catalog_courses', array['description', 'normalized_name'])
  ) fields(relation, columns)
  loop
    select string_agg(format('%I', field), ', '), string_agg(format('%L', field), ', '),
      string_agg(format('%I = mathin_internal.%I(%I)', field,
        case when field = 'grade_text' then 'normalize_grade_label' else 'normalize_grade_text' end, field), ', '),
      string_agg(format('%I is distinct from mathin_internal.%I(%I)', field,
        case when field = 'grade_text' then 'normalize_grade_label' else 'normalize_grade_text' end, field), ' or ')
    into columns_sql, arguments_sql, assignments_sql, changed_sql
    from unnest(target.columns) field;
    execute format('create trigger normalize_grade_labels before insert or update of %s on public.%I
      for each row execute function mathin_internal.normalize_business_grade_labels(%s)',
      columns_sql, target.relation, arguments_sql);
    execute format('update public.%I set %s where %s', target.relation, assignments_sql, changed_sql);
  end loop;
end
$$;

create or replace function mathin_internal.build_mofaxiao_roster_class_name(p_default jsonb)
returns text
language plpgsql immutable
set search_path = public, pg_temp
as $$
declare
  v_system text := regexp_replace(btrim(coalesce(p_default->>'system', '')), '\s+', '', 'g');
  v_grade text := mathin_internal.normalize_grade_label(regexp_replace(btrim(coalesce(p_default->>'gradeText', '')), '\s+', '', 'g'));
  v_season text := regexp_replace(btrim(coalesce(p_default->>'seasonText', '')), '\s+', '', 'g');
  v_class_type text := regexp_replace(btrim(coalesce(p_default->>'businessClassType', p_default->>'classType', '')), '\s+', '', 'g');
  v_campus text := regexp_replace(btrim(coalesce(p_default->>'campusName', '')), '\s+', '', 'g');
  v_teacher text := regexp_replace(btrim(coalesce(p_default->>'teacherInitials', '')), '\s+', '', 'g');
  v_weekday text := regexp_replace(btrim(coalesce(p_default->>'weekday', '')), '\s+', '', 'g');
  v_time_source text := regexp_replace(btrim(coalesce(p_default->>'time', '')), '\s+', '', 'g');
  v_time text := regexp_replace(btrim(coalesce(p_default->>'startTime', '')), '\s+', '', 'g');
  v_time_parts text[];
begin
  v_system := regexp_replace(v_system, '体系$', '');
  if v_system = '' then
    v_system := '待定系列';
  elsif public.normalize_mofaxiao_class_text(v_system) like '%贯通%' then
    v_system := '贯通思维';
  elsif public.normalize_mofaxiao_class_text(v_system) like '%培优%'
     or public.normalize_mofaxiao_class_text(v_system) like '%科学%' then
    v_system := '科学思维';
  end if;
  if v_grade = '' then v_grade := '待定年级'; end if;
  if v_season = '' then v_season := '待定季节'; end if;
  if v_class_type = '' then v_class_type := '待定班型'; end if;
  if public.normalize_mofaxiao_class_text(v_campus) like '%紫辰%' then v_campus := '紫辰阁'; end if;
  if v_campus = '' then v_campus := '待定校区'; end if;
  if v_teacher = '' then
    v_teacher := regexp_replace(btrim(coalesce(p_default->>'teacherName', '')), '\s+', '', 'g');
  end if;
  if v_teacher = '' then v_teacher := '待定老师'; end if;
  if v_weekday = '' then v_weekday := '待定星期'; end if;
  if v_time !~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$' then
    v_time_parts := regexp_match(v_time_source, '([0-9]{1,2}):([0-9]{2})');
    if v_time_parts is not null and v_time_parts[1]::integer between 0 and 23
       and v_time_parts[2]::integer between 0 and 59 then
      v_time := lpad(v_time_parts[1], 2, '0') || ':' || v_time_parts[2];
    else
      v_time := '待定时间';
    end if;
  end if;
  return left('【' || v_system || '】' || v_grade || v_season || v_class_type ||
    '|' || v_campus || v_teacher || v_weekday || v_time, 100);
exception when invalid_text_representation or numeric_value_out_of_range then
  return left('【' || v_system || '】' || v_grade || v_season || v_class_type ||
    '|' || v_campus || v_teacher || v_weekday || '待定时间', 100);
end
$$;
