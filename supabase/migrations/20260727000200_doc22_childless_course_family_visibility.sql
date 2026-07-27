-- docs/plan/22 §5.15 收尾：让还没有任何版本的课程产品在直接表读里也可见。
--
-- 20260727000100 已经修好了 list_course_families（并上一条零版本分支）。回归验收又暴露
-- 第二处同源问题：`course_families` 的 SELECT 策略同样带一条
-- `exists (select 1 from courses where family_id = ...)`，因此零版本产品对**任何直接表读**
-- 都不存在。表现是课程产品库能搜到刚建的产品，点进详情页却 404——详情页会先直接查一次
-- `course_families` 再调 security definer 的 get_course_family_detail，RPC 数据是好的，
-- 被挡住的是那次直接读。
--
-- 这条 exists 是**可见性启发式**而不是授权条件：真正的闸门是 has_perm(course.view) 与
-- status。它原本的意图是"没有任何可见版本的产品别出现在列表里"，那个意图对零版本产品
-- 不适用——那是一个刚建好、正等着补版本的产品，不是一个空壳。
--
-- 因此只放开"确实一个版本都没有"这一种情况：全部版本都对当前用户不可见（草稿/停用/
-- 已回收）的产品继续隐藏，语义不变。
drop policy if exists "course_families_select_course_view" on public.course_families;
create policy "course_families_select_course_view" on public.course_families
  for select to authenticated
  using (
    public.has_perm((select auth.uid()), 'course.view')
    and (status = 'enabled' or public.has_perm((select auth.uid()), 'course.manage'))
    and (
      exists (
        select 1 from public.courses course_row
         where course_row.family_id = public.course_families.id
           and course_row.trashed_at is null
           and (course_row.status = 'enabled' or public.has_perm((select auth.uid()), 'course.manage'))
      )
      -- 零版本产品：刚由 create_course_family 建立、尚未补版本。
      or not exists (
        select 1 from public.courses course_row
         where course_row.family_id = public.course_families.id
           and course_row.trashed_at is null
      )
    )
  );
