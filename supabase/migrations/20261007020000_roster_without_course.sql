-- 名册先承接已知班级与学生；教材选择可以随后补齐。
-- 保留两个读取入口原有的身份与班级范围校验。
begin;

create function pg_temp.patch_roster_reader(signature regprocedure, old_text text, new_text text)
returns void language plpgsql as $$
declare definition text := replace(pg_get_functiondef(signature), E'\r\n', E'\n');
begin
  if (length(definition) - length(replace(definition, old_text, ''))) / length(old_text) <> 1 then
    raise exception 'ROSTER_READER_PATCH_MISMATCH: %', signature;
  end if;
  execute replace(definition, old_text, new_text);
end $$;

select pg_temp.patch_roster_reader('public.get_phase3_enrollment_options()',
  'and classroom.course_id is not null', '');
select pg_temp.patch_roster_reader('public.get_phase3_enrollment_options()',
  '''courseId'', classroom.course_id,',
  '''courseId'', classroom.course_id,
          ''grade'', classroom.grade,
          ''businessClassType'', (select s.business_class_type from public.classroom_material_settings s where s.classroom_id=classroom.id),');

select pg_temp.patch_roster_reader('mathin_internal.get_teacher_enrollment_placement_board()',
  'and c.course_id is not null', '');
select pg_temp.patch_roster_reader('mathin_internal.get_teacher_enrollment_placement_board()',
  '''courseId'',c.course_id,',
  '''courseId'',c.course_id,''grade'',c.grade,
      ''businessClassType'',(select s.business_class_type from public.classroom_material_settings s where s.classroom_id=c.id),');

select pg_notify('pgrst', 'reload schema');
commit;
