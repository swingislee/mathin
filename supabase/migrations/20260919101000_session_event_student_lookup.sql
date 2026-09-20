-- 星星事件的学生匹配先按 UUID 定位，再执行原学生/监护人授权。
-- v2 使用学生 ID；旧版分别匹配当前账号或课次名册中保留的历史账号。
-- 只接受 UUID 的规范小写文本，保持旧 id::text 比较的精确语义。
alter policy events_select_student_scope on public.session_events using (
  type = any (array['star'::text, 'star_undo'::text])
  and (
    (payload -> 'schemaVersion' = '2'::jsonb and exists (
      select 1 from public.students student_row
      where student_row.id = case
        when payload ->> 'studentId' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        then (payload ->> 'studentId')::uuid end
      and (
        public.can_access_student(student_row.id, (select auth.uid()))
        or student_row.user_id = (select auth.uid())
        or exists (select 1 from public.student_guardians guardian_row
          where guardian_row.student_id = student_row.id and guardian_row.guardian_id = (select auth.uid()))
      )
    ))
    or (
      (not (payload ? 'schemaVersion') or payload -> 'schemaVersion' = '1'::jsonb)
      and (
        exists (
          select 1 from public.students student_row
          where student_row.user_id = case
            when payload ->> 'studentId' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            then (payload ->> 'studentId')::uuid end
          and (
            public.can_access_student(student_row.id, (select auth.uid()))
            or student_row.user_id = (select auth.uid())
            or exists (select 1 from public.student_guardians guardian_row
              where guardian_row.student_id = student_row.id and guardian_row.guardian_id = (select auth.uid()))
          )
        )
        or exists (
          select 1 from public.session_roster_entries legacy_entry
          join public.students student_row on student_row.id = legacy_entry.student_id
          where legacy_entry.session_id = session_events.session_id
            and legacy_entry.user_id = case
              when payload ->> 'studentId' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              then (payload ->> 'studentId')::uuid end
            and (
              public.can_access_student(student_row.id, (select auth.uid()))
              or student_row.user_id = (select auth.uid())
              or exists (select 1 from public.student_guardians guardian_row
                where guardian_row.student_id = student_row.id and guardian_row.guardian_id = (select auth.uid()))
            )
        )
      )
    )
  )
);
