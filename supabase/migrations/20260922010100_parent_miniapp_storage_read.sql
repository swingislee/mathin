-- 明确限定 Storage 外层路径，避免附件 name 列遮蔽 storage.objects.name。
drop policy miniapp_practice_storage_read on storage.objects;
create policy miniapp_practice_storage_read on storage.objects for select to authenticated
using(bucket_id='miniapp-practice' and exists(
  select 1 from public.miniapp_practice_uploads u where u.object_path=storage.objects.name and u.ready
    and ((public.miniapp_can_participate(u.student_id) and (u.kind='image' or public.miniapp_can_participate(u.student_id,'video')))
      or (public.is_staff((select auth.uid())) and public.can_access_student(u.student_id,(select auth.uid()))))));
