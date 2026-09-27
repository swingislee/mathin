-- 只在本机回滚事务验证；复用固定开发身份，不修改已保存教具。
begin;
do $test$
declare s jsonb:='{"toolId":"place-value","contentVersion":"place-value-lesson-v2","payload":{"title":"Radix blocks","initial":{"mode":"compare","left":{"radix":16,"places":[[],[],[],[],[],[[{"start":0,"count":1048576,"phase":0}]]],"nextId":1048576},"right":{"radix":16,"places":[[],[],[],[],[],[]],"nextId":0},"active":"left","selection":{"side":"left","unit":1048575},"highlight":5,"comparison":"hidden","autoCarry":false,"speed":"normal","showDigits":true,"showLabels":true,"grid":false,"axes":false,"view":"front","frame":{"center":{"x":0,"y":4,"z":0},"radius":1000000}}}}';
  doc jsonb:='{"docVersion":"courseware-composition-v1","canvas":{"width":960,"height":720,"backgroundColor":"#ffffff"},"source":null,"overlay":{"docVersion":"page-doc-v1","canvas":{"width":960,"height":720,"backgroundColor":"#ffffff","backgroundBindingKey":null},"nodes":[],"interactions":[]},"layout":{"version":"courseware-composition-grid-v1","columns":12,"rows":9,"blocks":[]}}';
  bad jsonb; sample jsonb; key text; radix int; owner_id uuid; other_id uuid; draft_id uuid:=gen_random_uuid(); saved public.tool_scene_drafts;
begin
  if public.tool_scene_is_valid(s) is not true or public.tool_scene_catalog_id(s)<>'place-value' then raise exception 'RADIX_VALID_SCENE'; end if;
  foreach radix in array array[2,3,4,5,7,8,9,10,16] loop
    sample:=jsonb_set(jsonb_set(s,'{payload,initial,left,radix}',to_jsonb(radix)),'{payload,initial,right,radix}',to_jsonb(radix));
    sample:=jsonb_set(sample,'{payload,initial,left,places,5,0,0,count}',to_jsonb(power(radix,5)::bigint));
    sample:=jsonb_set(sample,'{payload,initial,left,nextId}',to_jsonb(power(radix,5)::bigint));
    sample:=jsonb_set(sample,'{payload,initial,selection}','null');
    if public.tool_scene_is_valid(sample) is not true then raise exception 'RADIX_BASE_REJECTED: %',radix; end if;
  end loop;
  foreach bad in array array[
    s-'payload', s||'{"draftId":"private"}', jsonb_set(s,'{toolId}','"dice"'), jsonb_set(s,'{payload,title}','null'),
    jsonb_set(s,'{payload,initial,left,radix}','6'), jsonb_set(s,'{payload,initial,right,radix}','10'),
    jsonb_set(s,'{payload,initial,left,places,5,0,0,count}','1048575'), jsonb_set(s,'{payload,initial,left,places,5,0,0,phase}','16'),
    jsonb_set(s,'{payload,initial,left,places,5,0,0,start}','1'), jsonb_set(s,'{payload,initial,left,nextId}','0'),
    jsonb_set(s,'{payload,initial,left,places,0}','[[{"start":0,"count":1,"phase":0}]]'),
    jsonb_set(s,'{payload,initial,selection,unit}','1048576'), jsonb_set(s,'{payload,initial,highlight}','6'),
    jsonb_set(s,'{payload,initial,highlight}','"5"'), jsonb_set(s,'{payload,initial,showDigits}','null'),
    jsonb_set(s,'{payload,initial,motion}','{}'), jsonb_set(s,'{payload,initial,frame,radius}','10000001')
  ] loop
    if public.tool_scene_is_valid(bad) is not false then raise exception 'RADIX_INVALID_ACCEPTED'; end if;
  end loop;
  for key in select jsonb_object_keys(s#>'{payload,initial}') loop
    if public.tool_scene_is_valid(jsonb_set(s,'{payload,initial}',(s#>'{payload,initial}')-key)) then raise exception 'RADIX_MISSING_KEY: %',key; end if;
  end loop;
  doc:=jsonb_set(doc,'{layout,blocks}',jsonb_build_array(jsonb_build_object('id','radix-block','type','tool','tool',s,
    'placement',jsonb_build_object('column',0,'row',0,'columnSpan',12,'rowSpan',9))));
  if public.cw_courseware_composition_doc_is_valid(doc) is not true or public.cw_manual_composition_doc_is_valid(doc) is not true
    or public.cw_formal_cube_page_is_valid(doc) is not true then raise exception 'RADIX_COURSEWARE_REJECTED'; end if;
  select id into owner_id from public.profiles where display_name='测试-教师' and is_active limit 1;
  select id into other_id from public.profiles where display_name='测试-教研' and is_active limit 1;
  if owner_id is null or other_id is null then raise exception 'FIXED_DEVELOPMENT_ACCOUNTS_REQUIRED'; end if;
  perform set_config('request.jwt.claim.sub',owner_id::text,true); perform set_config('request.jwt.claim.role','authenticated',true);
  execute 'set local role authenticated';
  saved:=public.save_tool_scene_draft(draft_id,s,0);
  if saved.scene<>s or saved.catalog_id<>'place-value' or saved.revision<>1 then raise exception 'RADIX_DRAFT_ROUNDTRIP'; end if;
  if (select scene from public.tool_scene_drafts where id=draft_id) is distinct from s then raise exception 'RADIX_REREAD'; end if;
  saved:=public.save_tool_scene_draft(draft_id,jsonb_set(s,'{payload,title}','"Updated radix"'),1);
  if saved.revision<>2 or doc#>'{layout,blocks,0,tool}'<>s then raise exception 'RADIX_FROZEN_COPY_CHANGED'; end if;
  begin perform public.save_tool_scene_draft(draft_id,s,1); raise exception 'RADIX_STALE_WRITE';
  exception when sqlstate 'P0001' then if sqlerrm<>'TOOL_DRAFT_CONFLICT' then raise; end if; end;
  perform set_config('request.jwt.claim.sub',other_id::text,true);
  if (select count(*) from public.tool_scene_drafts where id=draft_id)<>0 then raise exception 'RADIX_OTHER_OWNER_READ'; end if;
  begin perform public.save_tool_scene_draft(draft_id,s,2); raise exception 'RADIX_OTHER_OWNER_WRITE';
  exception when sqlstate 'P0002' then null; end;
  execute 'reset role';
  foreach key in array array['tool_place_value_radix_board_is_valid','tool_place_value_radix_scene_is_valid'] loop
    if has_function_privilege('authenticated','public.'||key||'(jsonb)','execute') or has_function_privilege('anon','public.'||key||'(jsonb)','execute')
      or has_function_privilege('service_role','public.'||key||'(jsonb)','execute') then raise exception 'RADIX_VALIDATOR_EXPOSED'; end if;
  end loop;
end;
$test$;
rollback;
