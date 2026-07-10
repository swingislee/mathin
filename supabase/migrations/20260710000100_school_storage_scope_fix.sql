-- ============================================================================
-- P4B 代码审查修复（10-§7）：course-assets 私有 bucket 的两处权限坑。
-- 1. INSERT 只放行 is_admin，但模板编辑页按 courseware.template.edit 放行编辑，
--    该权限持有者若非 admin，编辑器内一上传图片/视频就 403——收紧口径不自洽。
-- 2. SELECT 对任何登录用户无条件放行，任意学生/家长凭 path 即可读取与己无关的
--    课件素材；收紧为 staff（course.view/course.manage/courseware.*）或
--    该课程班级的在读学生/监护人（候课预载场景仍然放行）。
-- ============================================================================

drop policy "course_assets_insert_admin" on storage.objects;

create policy "course_assets_insert_scope" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'course-assets'
    and (
      public.is_admin((select auth.uid()))
      or public.staff_has_perm((select auth.uid()), 'courseware.template.edit')
    )
  );

drop policy "course_assets_select_authenticated" on storage.objects;

create policy "course_assets_select_scope" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'course-assets'
    and (
      public.is_admin((select auth.uid()))
      or public.staff_has_perm((select auth.uid()), 'course.view')
      or public.staff_has_perm((select auth.uid()), 'course.manage')
      or public.staff_has_perm((select auth.uid()), 'courseware.template.edit')
      or public.staff_has_perm((select auth.uid()), 'courseware.overlay.edit')
      or exists (
        select 1
          from public.classrooms c
          join public.enrollments e on e.classroom_id = c.id and e.status = 'active'
          join public.students s on s.id = e.student_id
         where c.course_id::text = (storage.foldername(storage.objects.name))[1]
           and (
             s.user_id = (select auth.uid())
             or exists (
               select 1 from public.student_guardians g
                where g.student_id = s.id and g.guardian_id = (select auth.uid())
             )
           )
      )
    )
  );
