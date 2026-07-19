-- P4H-0：课程、讲次、班级与上课课次禁止由 authenticated 直接物理删除。
-- 后续生命周期操作只可通过受控 RPC / 软状态转换完成。

revoke delete on table public.courses from authenticated;
revoke delete on table public.course_lectures from authenticated;
revoke delete on table public.classrooms from authenticated;
revoke delete on table public.class_sessions from authenticated;
