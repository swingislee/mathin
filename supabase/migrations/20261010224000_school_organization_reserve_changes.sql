-- 组织画板的一次保存同时处理备用账号：移入时其组织成员关系已在同一次保存中移除，移回后可直接入组。
do $wire$
declare v_def text; v_before text; v_after text;
begin
  v_def:=pg_get_functiondef('public.save_school_organization(jsonb)'::regprocedure);
  for v_before,v_after in select * from (values
    ('p_changes-array[''units'',''members'',''roles'',''archive'']<>''{}''::jsonb','p_changes-array[''units'',''members'',''roles'',''archive'',''reserve'']<>''{}''::jsonb'),
    ('unnest(array[''units'',''members'',''roles'',''archive'']) k','unnest(array[''units'',''members'',''roles'',''archive'',''reserve'']) k'),
    ('  -- 组织移动会改变下级成员适用的诊断统一规则。',
     '  -- 备用账号：在成员变动之后处理，移入前须已离开全部组织。
  for item in select * from jsonb_array_elements(coalesce(p_changes->''reserve'',''[]''::jsonb)) loop
    if jsonb_typeof(item)<>''object'' or jsonb_typeof(item->''userId'')<>''string'' or jsonb_typeof(item->''reason'') not in (''string'',''null'') then raise exception ''VALIDATION''; end if;
    perform public.set_school_staff_reserve((item->>''userId'')::uuid,item->>''reason'');
  end loop;

  -- 组织移动会改变下级成员适用的诊断统一规则。')
  ) changes(b,a) loop
    if position(v_before in v_def)=0 then raise exception 'RESERVE_SAVE_ANCHOR_MISSING: %',left(v_before,50); end if;
    v_def:=replace(v_def,v_before,v_after);
  end loop;
  execute v_def;
end $wire$;
select pg_notify('pgrst','reload schema');
