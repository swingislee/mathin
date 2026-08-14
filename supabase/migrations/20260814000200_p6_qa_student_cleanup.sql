-- P6-AIX-4：扩展 QA 课程清理范围，删除人工验收数据集的虚构学生档案。
--
-- 首轮课程清理保留了学生档案，以遵循当时的 purge_test_classroom 语义；在需求
-- 明确扩大到学生档案后，仅按数据集的精确标识删除两个无账号、无监护人的虚构档案。
-- 固定开发账号对应的共享学生档案不属于本次清理对象。

do $$
declare
  qa_student_ids uuid[];
begin
  if exists (
    select 1
      from public.students student_row
     where student_row.source = 'QA 人工验收数据集'
       and student_row.name like 'QA-20260803-%'
       and (
         student_row.name not in (
           'QA-20260803-学员甲·无账号无监护人',
           'QA-20260803-学员乙·历史报名'
         )
         or student_row.remark is distinct from 'QA-20260803-school-manual 专用虚构档案，禁止填入真实未成年人信息。'
       )
  ) then
    raise exception 'QA_STUDENT_CLEANUP_TARGET_MISMATCH';
  end if;

  select coalesce(array_agg(student_row.id order by student_row.name), '{}'::uuid[])
    into qa_student_ids
    from public.students student_row
   where student_row.source = 'QA 人工验收数据集'
     and student_row.name in (
       'QA-20260803-学员甲·无账号无监护人',
       'QA-20260803-学员乙·历史报名'
     )
     and student_row.remark = 'QA-20260803-school-manual 专用虚构档案，禁止填入真实未成年人信息。';

  if coalesce(array_length(qa_student_ids, 1), 0) = 0 then
    return;
  end if;

  if coalesce(array_length(qa_student_ids, 1), 0) <> 2 then
    raise exception 'QA_STUDENT_CLEANUP_COUNT_MISMATCH';
  end if;

  if exists (
    select 1
      from public.students student_row
     where student_row.id = any(qa_student_ids)
       and student_row.user_id is not null
  ) or exists (
    select 1
      from public.student_guardians guardian_row
     where guardian_row.student_id = any(qa_student_ids)
  ) or exists (
    select 1
      from public.enrollments enrollment_row
     where enrollment_row.student_id = any(qa_student_ids)
  ) or exists (
    select 1
      from public.orders order_row
     where order_row.student_id = any(qa_student_ids)
  ) or exists (
    select 1
      from public.account_ledger ledger_row
     where ledger_row.student_id = any(qa_student_ids)
  ) or exists (
    select 1
      from public.lesson_ledger lesson_row
     where lesson_row.student_id = any(qa_student_ids)
  ) or exists (
    select 1
      from public.session_changes change_row
     where change_row.student_id = any(qa_student_ids)
  ) then
    raise exception 'QA_STUDENT_CLEANUP_PROTECTED_DATA';
  end if;

  delete from public.students
   where id = any(qa_student_ids);
end;
$$;

do $$
begin
  if exists (
    select 1
      from public.students student_row
     where student_row.source = 'QA 人工验收数据集'
       and student_row.name in (
         'QA-20260803-学员甲·无账号无监护人',
         'QA-20260803-学员乙·历史报名'
       )
  ) then
    raise exception 'QA_STUDENT_CLEANUP_NOT_COMPLETE';
  end if;
end;
$$;
