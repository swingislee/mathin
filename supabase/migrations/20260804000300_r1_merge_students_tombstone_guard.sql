-- P4E 缺口修复（BUG-R1M-004）：merge_students 对两侧都不校验 deleted_at。
--
-- 人工验收 §4.2 MERGE-04 实测：两名员工分别停在 A、B 的学生页，甲把 B 合并进 A 成功后，
-- 乙的过期页面再把 A 合并进 B（B 已是墓碑）**同样成功且不报错**，结果 A、B 的 deleted_at
-- 同时非空、两份数据全部堆到墓碑档案 B 上，两个学生一起从正常列表消失。
-- can_access_student 也不过滤软删，因此权限层挡不住这条路径；反向重复合并只会撞
-- student_merges.merged_id 的唯一约束，前端只能显示通用 actionFailed。
--
-- 修复：在行锁之后、任何迁移写入之前校验两侧状态，抛可映射的领域码。
--   · STUDENT_DELETED —— 保留档案或来源档案已软删（含「已是墓碑」）。
--   · ALREADY_MERGED  —— 来源档案已被合并过，替换唯一约束的原始报错文本。
-- 客户端候选列表在挂载时取一次、之后不再校验新鲜度，因此服务端是唯一防线。

begin;

create or replace function public.merge_students(p_kept_id uuid, p_merged_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid uuid := auth.uid();
  old_balance numeric;
  old_lessons numeric;
  merged_user uuid;
  kept_deleted timestamptz;
  merged_deleted timestamptz;
begin
 if p_kept_id=p_merged_id then raise exception 'SAME_STUDENT'; end if;
 if uid is null or not public.has_perm(uid,'student.edit') or not public.can_access_student(p_kept_id,uid) or not public.can_access_student(p_merged_id,uid)
 then raise exception 'FORBIDDEN'; end if;
 perform 1 from public.students where id in(p_kept_id,p_merged_id) order by id for update;

 -- 取锁之后再判定状态，避免并发页面在检查与写入之间把对方档案改成墓碑。
 select deleted_at into kept_deleted from public.students where id = p_kept_id;
 select deleted_at into merged_deleted from public.students where id = p_merged_id;
 if kept_deleted is not null or merged_deleted is not null then raise exception 'STUDENT_DELETED'; end if;
 if exists(select 1 from public.student_merges where merged_id in (p_kept_id, p_merged_id)) then raise exception 'ALREADY_MERGED'; end if;

 select user_id into merged_user from public.students where id=p_merged_id;
 insert into public.student_guardians(student_id,guardian_id,relation,scope,created_at)
 select p_kept_id,guardian_id,relation,scope,created_at from public.student_guardians where student_id=p_merged_id
 on conflict(student_id,guardian_id) do update set scope=(select array(select distinct unnest(public.student_guardians.scope||excluded.scope)));
 delete from public.student_guardians where student_id=p_merged_id;
 update public.student_follow_ups set student_id=p_kept_id where student_id=p_merged_id;
 update public.orders set student_id=p_kept_id where student_id=p_merged_id;
 update public.account_ledger set student_id=p_kept_id where student_id=p_merged_id;
 update public.lesson_ledger set student_id=p_kept_id where student_id=p_merged_id;
 update public.session_videos set student_id=p_kept_id where student_id=p_merged_id;
 update public.session_changes set student_id=p_kept_id where student_id=p_merged_id;
 delete from public.activity_registrations a using public.activity_registrations k where a.student_id=p_merged_id and k.student_id=p_kept_id and k.activity_id=a.activity_id;
 update public.activity_registrations set student_id=p_kept_id where student_id=p_merged_id;
 -- 以下复合唯一表若 kept 已有同一事实，保留 kept 行并删除 merged 行。
 delete from public.session_attendance a using public.session_attendance k where a.student_id=p_merged_id and k.student_id=p_kept_id and k.session_id=a.session_id;
 update public.session_attendance set student_id=p_kept_id where student_id=p_merged_id;
 delete from public.session_reviews a using public.session_reviews k where a.student_id=p_merged_id and k.student_id=p_kept_id and k.session_id=a.session_id;
 update public.session_reviews set student_id=p_kept_id where student_id=p_merged_id;
 delete from public.enrollments a using public.enrollments k where a.student_id=p_merged_id and k.student_id=p_kept_id and k.classroom_id=a.classroom_id and k.left_at is not distinct from a.left_at;
 update public.enrollments set student_id=p_kept_id where student_id=p_merged_id;
 delete from public.student_grade_history a using public.student_grade_history k where a.student_id=p_merged_id and k.student_id=p_kept_id and k.term_id=a.term_id;
 update public.student_grade_history set student_id=p_kept_id where student_id=p_merged_id;
 update public.guardian_consents set student_id=p_kept_id where student_id=p_merged_id;
 update public.guardian_bind_invitations set student_id=p_kept_id where student_id=p_merged_id;
 select balance,lesson_balance into old_balance,old_lessons from public.student_accounts where student_id=p_merged_id for update;
 insert into public.student_accounts(student_id,balance,lesson_balance) values(p_kept_id,coalesce(old_balance,0),coalesce(old_lessons,0))
 on conflict(student_id) do update set balance=public.student_accounts.balance+excluded.balance,lesson_balance=public.student_accounts.lesson_balance+excluded.lesson_balance,updated_at=now();
 delete from public.student_accounts where student_id=p_merged_id;
 update public.students set deleted_at=now(),user_id=null where id=p_merged_id;
 update public.students set user_id=coalesce(user_id,merged_user) where id=p_kept_id;
 insert into public.student_merges(kept_id,merged_id,operated_by) values(p_kept_id,p_merged_id,uid);
 perform public.emit_domain_event('student.merged','student',p_kept_id,jsonb_build_object('mergedId',p_merged_id),null,null);
end $$;

commit;
