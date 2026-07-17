-- ----------------------------------------------------------------------------
-- P6-0 ⑤：课件资产存储桶（docs/plan/16 §3 D3；拍板记录 §10 第 1/4 项）
--
-- cw-objects：CAS 对象桶（sha256/<前2位>/<完整hash>），私有。
--   读 = staff 直读（中台/备课）；学生不直读桶——候课由 Server Action 校验教室成员
--   身份后按 courseware_resolved 清单批签 signed URL（P6-2 getSessionAssetUrls）。
--   写/删 = 仅 service key（导入 CLI / 服务端上传，绕过 RLS），故不建 authenticated 写策略。
--
-- cw-h5：H5 patched 包桶（packages/<packageHash>/<包内相对路径>），public。
--   拍板理由：iframe 包内子资源请求无法携带鉴权，private 桶技术不可行；
--   路径含 packageHash 不可枚举。写/删同样仅 service key。
-- ----------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit)
values ('cw-objects', 'cw-objects', false, 209715200)  -- 200MB；镜像库实测最大对象 145MB
on conflict (id) do nothing;

insert into storage.buckets (id, name, public, file_size_limit)
values ('cw-h5', 'cw-h5', true, 209715200)             -- 200MB，包内单文件上限
on conflict (id) do nothing;

create policy "cw_objects_select_staff" on storage.objects
  for select to authenticated
  using (bucket_id = 'cw-objects' and public.is_staff((select auth.uid())));
