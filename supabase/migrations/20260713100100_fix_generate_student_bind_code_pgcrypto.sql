-- 修复 generate_student_bind_code 两处问题：
-- 1) 依赖 pgcrypto 的 gen_random_bytes：本库未装/未启用 pgcrypto（search_path 已锁
--    public，20260708000200 早有约定不依赖它），导致新建学生（create_student）、
--    学生认领码相关流程全部失败，报 "function gen_random_bytes(integer) does not exist"。
--    改用内置 gen_random_uuid() + md5 截断到 12 位十六进制，与旧实现（20260709000400，
--    8 位）同一思路、只是位数不同，不引入新扩展依赖。
-- 2) 局部变量 code 与 guardian_bind_invitations.code 列同名歧义（"column reference
--    \"code\" is ambiguous"，即使左侧用表名限定，右侧裸 code 仍会歧义）：改名为
--    v_code 避免与列名冲突，同一手法参考同日修复的 list_student_guardians。

create or replace function public.generate_student_bind_code()
returns text language plpgsql security definer set search_path=public,pg_temp as $$
declare v_code text;
begin
  loop
    v_code := substr(md5(gen_random_uuid()::text || clock_timestamp()::text), 1, 12);
    exit when not exists(select 1 from public.students where bind_code=v_code)
      and not exists(select 1 from public.guardian_bind_invitations where guardian_bind_invitations.code=v_code);
  end loop;
  return v_code;
end $$;
