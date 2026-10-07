-- 复用导入映射保留已知的校区、每周时段与原任课姓名；不据此生成课次或人员身份。
begin;
create function mathin_internal.class_roster_source_summary(p_classroom_id uuid)
returns jsonb language sql stable set search_path=public,pg_temp as $$
  select jsonb_build_object(
    'teacherLabel',coalesce(source_context->>'teacherLabel',''),
    'scheduleLabel',coalesce(source_context->>'scheduleLabel',''),
    'campusId',source_context->>'campusId',
    'campusLabel',coalesce(source_context->>'campusLabel','')
  ) from public.class_roster_source_mappings
  where classroom_id=p_classroom_id and source_system='feishu-base'
  order by updated_at desc,created_at desc limit 1;
$$;
revoke all on function mathin_internal.class_roster_source_summary(uuid) from public,anon,authenticated;
grant execute on function mathin_internal.class_roster_source_summary(uuid) to postgres;

do $$
declare definition text; signature regprocedure; old_text text; new_text text;
begin
  for signature,old_text,new_text in values
    ('public.get_phase3_enrollment_options()'::regprocedure,
      '''grade'', classroom.grade,',
      '''grade'', classroom.grade, ''source'', mathin_internal.class_roster_source_summary(classroom.id),'),
    ('mathin_internal.get_teacher_enrollment_placement_board()'::regprocedure,
      '''courseId'',c.course_id,''grade'',c.grade,',
      '''courseId'',c.course_id,''grade'',c.grade,''source'',mathin_internal.class_roster_source_summary(c.id),')
  loop
    definition:=pg_get_functiondef(signature);
    if (length(definition)-length(replace(definition,old_text,'')))/length(old_text)<>1 then
      raise exception 'ROSTER_SOURCE_READER_PATCH_MISMATCH: %',signature;
    end if;
    execute replace(definition,old_text,new_text);
  end loop;
end $$;
select pg_notify('pgrst','reload schema');
commit;
