-- 与名册相同的可见班级范围：教材待确认不影响共享标签的读取。
begin;
do $$
declare definition text := pg_get_functiondef('public.get_class_student_labels(uuid[])'::regprocedure);
        condition text := 'and c.course_id is not null';
begin
  if (length(definition) - length(replace(definition, condition, ''))) / length(condition) <> 1 then
    raise exception 'ROSTER_LABEL_READER_PATCH_MISMATCH';
  end if;
  execute replace(definition, condition, '');
end $$;
select pg_notify('pgrst', 'reload schema');
commit;
