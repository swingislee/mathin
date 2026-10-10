-- 组长观察台：只按班级成员中登记的授课老师归属；班级创建人（多为导入或管理账号）不作为授课老师。
do $wire$
declare v_def text; v_before text:='
        union select c.owner_id where not exists(select 1 from public.classroom_members m where m.classroom_id=c.id and m.role=''teacher'')) t';
begin
  v_def:=pg_get_functiondef('public.get_school_lead_board(uuid)'::regprocedure);
  if position(v_before in v_def)=0 then raise exception 'LEAD_TEACHER_FALLBACK_ANCHOR_MISSING'; end if;
  execute replace(v_def,v_before,') t');
end $wire$;
select pg_notify('pgrst','reload schema');
