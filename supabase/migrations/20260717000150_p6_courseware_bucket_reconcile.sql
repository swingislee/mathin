-- P6-0 状态修复：开发库曾出现 cw_objects_select_staff 已存在、两个桶缺失的
-- 不完整状态。保持历史 migration 不变，以可重复执行的补偿 migration 收敛。

insert into storage.buckets (id, name, public, file_size_limit)
values ('cw-objects', 'cw-objects', false, 209715200)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public, file_size_limit)
values ('cw-h5', 'cw-h5', true, 209715200)
on conflict (id) do nothing;

drop policy if exists "cw_objects_select_staff" on storage.objects;
create policy "cw_objects_select_staff" on storage.objects
  for select to authenticated
  using (bucket_id = 'cw-objects' and public.is_staff((select auth.uid())));
