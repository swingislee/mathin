do $$
declare
  grade integer;
  legacy text;
  actual text;
begin
  for grade in 1..7 loop
    legacy := substr('一二三四五六七', grade, 1) || '年级';
    if mathin_internal.normalize_grade_text('数学' || legacy || '秋季') <> '数学' || grade::text || '年级秋季'
      or mathin_internal.normalize_grade_label(legacy) <> grade::text || '年级'
      or mathin_internal.normalize_grade_label(grade::text) <> grade::text || '年级' then
      raise exception 'GRADE_LABEL_NORMALIZATION_FAILED: %', grade;
    end if;
  end loop;
  actual := mathin_internal.normalize_grade_text('同一年级，一年级和七年级；三至六年级；一、三、四年级；十一年级；十二年级；周六；一对一');
  if actual <> '同一年级，1年级和7年级；3至6年级；1、3、4年级；十一年级；十二年级；周六；一对一'
    or mathin_internal.normalize_grade_text(actual) <> actual
    or mathin_internal.normalize_grade_label('第 ６ 年级') <> '6年级'
    or mathin_internal.normalize_grade_label('初一') <> '7年级'
    or mathin_internal.normalize_grade_label('大班') <> '大班'
    or mathin_internal.normalize_grade_text(null) is not null then
    raise exception 'GRADE_LABEL_BOUNDARY_FAILED';
  end if;
  if public.normalize_mofaxiao_class_text('E系列数学一年级秋季B[全国版]')
      <> public.normalize_mofaxiao_class_text('E系列数学1年级秋季B[全国版]')
    or public.normalize_teacher_microcourse_course_name(' 五年级  Ａ班 ')
      <> public.normalize_teacher_microcourse_course_name('5年级 A班') then
    raise exception 'GRADE_LABEL_LEGACY_MATCH_FAILED';
  end if;
  actual := mathin_internal.build_mofaxiao_roster_class_name('{"system":"科学思维","gradeText":"七年级","seasonText":"秋季","classType":"A+","campusName":"校区","teacherInitials":"ZL","weekday":"周六","startTime":"09:00"}');
  if actual <> '【科学思维】7年级秋季A+|校区ZL周六09:00' then
    raise exception 'GRADE_LABEL_ROSTER_NAME_FAILED';
  end if;
  if has_function_privilege('authenticated', 'mathin_internal.normalize_business_grade_labels()', 'execute')
    or has_function_privilege('anon', 'mathin_internal.normalize_grade_text(text)', 'execute') then
    raise exception 'GRADE_LABEL_INTERNAL_PRIVILEGE_FAILED';
  end if;
end
$$;

-- 使用事务内临时表验证写入触发器，保留正式身份与业务记录。
create temporary table grade_label_contract (title text, grade_text text, grade integer, source_key text) on commit drop;
create trigger normalize_grade_labels before insert or update of title, grade_text on grade_label_contract
  for each row execute function mathin_internal.normalize_business_grade_labels('title', 'grade_text');
grant select, insert, update on grade_label_contract to authenticated;
set local role authenticated;
insert into grade_label_contract values ('三年级数学', '初一', 7, 'source::七年级');
update grade_label_contract set title='同一年级的五、六年级', grade_text='第 ６ 年级';
reset role;
do $$
begin
  if not exists (select 1 from grade_label_contract
    where title='同一年级的5、6年级' and grade_text='6年级' and grade=7 and source_key='source::七年级') then
    raise exception 'GRADE_LABEL_TRIGGER_FAILED';
  end if;
end
$$;
