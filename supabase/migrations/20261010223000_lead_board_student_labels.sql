-- 组长观察台：授课学生带上班级名册的 A／B／C／D 标签，沟通频率可按标签分别设定。
do $wire$
declare v_def text; v_sig text:='public.get_school_lead_board(uuid)'; v_before text; v_after text;
begin
  v_def:=pg_get_functiondef(v_sig::regprocedure);
  for v_before,v_after in select * from (values
    ('select c.id as classroom_id,c.name as class_name,c.owner_id,e.student_id,e.joined_at,st.name from classes c',
     'select c.id as classroom_id,c.name as class_name,c.owner_id,e.student_id,e.joined_at,st.name,(select x.label from public.class_student_labels x where x.enrollment_id=e.id) as label from classes c'),
    ('''contactedEver'',exists(','''label'',r.label,''contactedEver'',exists(')
  ) changes(b,a) loop
    if position(v_before in v_def)=0 then raise exception 'LEAD_LABEL_ANCHOR_MISSING: %',left(v_before,50); end if;
    v_def:=replace(v_def,v_before,v_after);
  end loop;
  execute v_def;
end $wire$;
select pg_notify('pgrst','reload schema');
