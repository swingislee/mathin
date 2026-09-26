-- 复用固定开发身份；新增测试草稿全部在本机回滚事务内，既有场景不被修改。
begin;
do $test$
declare
  s jsonb := '{"toolId":"place-value","contentVersion":"place-value-lesson-v1","payload":{"title":"Place-value blocks","initial":{"mode":"single","left":{"ones":[0,2,4,6,8,11,13,15,17],"tens":[],"hundreds":[],"nextId":9},"right":{"ones":[],"tens":[[0,2,4,6,8,11,13,15,17,19],[20,22,24,26,28,31,33,35,37,39]],"hundreds":[],"nextId":20},"active":"left","selection":null,"highlight":"all","comparison":"hidden","autoCarry":false,"speed":"normal","showDigits":true,"showLabels":true,"grid":true,"axes":false,"view":"front","frame":{"center":{"x":0,"y":4,"z":-3},"radius":8.5}}}}';
  doc jsonb := '{"docVersion":"courseware-composition-v1","canvas":{"width":960,"height":720,"backgroundColor":"#ffffff"},"source":null,"overlay":{"docVersion":"page-doc-v1","canvas":{"width":960,"height":720,"backgroundColor":"#ffffff","backgroundBindingKey":null},"nodes":[],"interactions":[]},"layout":{"version":"courseware-composition-grid-v1","columns":12,"rows":9,"blocks":[]}}';
  bad jsonb; units jsonb; rods jsonb; hundred jsonb; sample jsonb; key text;
  owner_id uuid; other_id uuid; draft_id uuid := gen_random_uuid(); saved public.tool_scene_drafts;
begin
  if public.tool_scene_is_valid(s) is not true or public.tool_scene_catalog_id(s)<>'place-value' then raise exception 'PLACE_VALUE_VALID_SCENE'; end if;
  select jsonb_agg(n*2+case when n%10>=5 then 1 else 0 end order by n) into units from generate_series(0,998) n;
  sample := jsonb_set(s,'{payload,initial,left}',jsonb_build_object('ones',units,'tens','[]'::jsonb,'hundreds','[]'::jsonb,'nextId',999));
  if public.tool_scene_is_valid(sample) is not true then raise exception 'PLACE_VALUE_999_ONES'; end if;
  select jsonb_agg(rod order by tens) into rods from (
    select tens,jsonb_agg((tens*10+n)*2+case when n>=5 then 1 else 0 end order by n) rod
    from generate_series(0,9) tens cross join generate_series(0,9) n group by tens
  ) grouped;
  hundred := jsonb_build_object('ones','[]'::jsonb,'tens','[]'::jsonb,'hundreds',jsonb_build_array(rods),'nextId',100);
  sample := jsonb_set(s,'{payload,initial,left}',hundred);
  sample := jsonb_set(sample,'{payload,initial,selection}','{"side":"left","unit":199}');
  if public.tool_scene_is_valid(sample) is not true then raise exception 'PLACE_VALUE_HUNDRED_MEMBERSHIP'; end if;
  foreach bad in array array[
    s-'payload',s||'{"draftId":"private"}',jsonb_set(s,'{toolId}','"dice"'),jsonb_set(s,'{contentVersion}','"future-v1"'),
    jsonb_set(s,'{payload,title}','null'),jsonb_set(s,'{payload,initial,left,ones}','[0,1]'),
    jsonb_set(s,'{payload,initial,left,nextId}','0'),jsonb_set(s,'{payload,initial,left,tens}','[[0]]'),
    jsonb_set(s,'{payload,initial,left,ones}','[0.5]'),jsonb_set(s,'{payload,initial,left,ones}','["0"]'),
    jsonb_set(s,'{payload,initial,left,ones}','[-1]'),jsonb_set(s,'{payload,initial,left,nextId}','1000001'),
    jsonb_set(s,'{payload,initial,autoCarry}','"true"'),jsonb_set(s,'{payload,initial,view}','null'),
    jsonb_set(s,'{payload,initial,mode}','"quiz"'),jsonb_set(s,'{payload,initial,frame,radius}','0'),
    jsonb_set(s,'{payload,initial,frame,center,x}','2001'),
    jsonb_set(s,'{payload,initial,selection}','{"side":"left","unit":199}'),
    jsonb_set(s,'{payload,initial,motion}','{}'),jsonb_set(s,'{payload,initial,past}','[]'),
    jsonb_set(sample,'{payload,initial,left,hundreds,0,0,0}','199')
  ] loop
    if public.tool_scene_is_valid(bad) is not false then raise exception 'PLACE_VALUE_INVALID_ACCEPTED'; end if;
  end loop;
  for key in select jsonb_object_keys(s#>'{payload,initial}') loop
    if public.tool_scene_is_valid(jsonb_set(s,'{payload,initial}',(s#>'{payload,initial}')-key)) then raise exception 'PLACE_VALUE_MISSING_KEY: %',key; end if;
  end loop;
  doc := jsonb_set(doc,'{layout,blocks}',jsonb_build_array(jsonb_build_object('id','place-value-1','type','tool','tool',sample,
    'placement',jsonb_build_object('column',0,'row',0,'columnSpan',12,'rowSpan',9))));
  if public.cw_courseware_composition_doc_is_valid(doc) is not true or public.cw_manual_composition_doc_is_valid(doc) is not true
    or public.cw_formal_cube_page_is_valid(doc) is not true then raise exception 'PLACE_VALUE_COURSEWARE_REJECTED'; end if;
  select id into owner_id from public.profiles where display_name='测试-教师' and is_active limit 1;
  select id into other_id from public.profiles where display_name='测试-教研' and is_active limit 1;
  if owner_id is null or other_id is null then raise exception 'FIXED_DEVELOPMENT_ACCOUNTS_REQUIRED'; end if;
  perform set_config('request.jwt.claim.sub',owner_id::text,true); perform set_config('request.jwt.claim.role','authenticated',true);
  execute 'set local role authenticated';
  saved := public.save_tool_scene_draft(draft_id,sample,0);
  if saved.catalog_id<>'place-value' or saved.scene<>sample or saved.revision<>1 then raise exception 'PLACE_VALUE_DRAFT_ROUNDTRIP'; end if;
  if (select scene from public.tool_scene_drafts where id=draft_id) is distinct from sample then raise exception 'PLACE_VALUE_DRAFT_REREAD'; end if;
  saved := public.save_tool_scene_draft(draft_id,jsonb_set(sample,'{payload,title}','"Updated number"'),1);
  if saved.revision<>2 or doc#>'{layout,blocks,0,tool}'<>sample then raise exception 'PLACE_VALUE_FIXED_COPY_CHANGED'; end if;
  begin perform public.save_tool_scene_draft(draft_id,sample,1); raise exception 'PLACE_VALUE_STALE_WRITE_ACCEPTED';
  exception when sqlstate 'P0001' then if sqlerrm<>'TOOL_DRAFT_CONFLICT' then raise; end if; end;
  perform set_config('request.jwt.claim.sub',other_id::text,true);
  if (select count(*) from public.tool_scene_drafts where id=draft_id)<>0 then raise exception 'PLACE_VALUE_OTHER_OWNER_READ'; end if;
  begin perform public.save_tool_scene_draft(draft_id,sample,2); raise exception 'PLACE_VALUE_OTHER_OWNER_WRITE';
  exception when sqlstate 'P0002' then null; end;
  execute 'reset role';
  foreach key in array array['tool_place_value_board_is_valid','tool_place_value_scene_is_valid'] loop
    if has_function_privilege('authenticated','public.'||key||'(jsonb)','execute') or has_function_privilege('anon','public.'||key||'(jsonb)','execute')
      or has_function_privilege('service_role','public.'||key||'(jsonb)','execute') then raise exception 'PLACE_VALUE_VALIDATOR_EXPOSED'; end if;
  end loop;
end;
$test$;
rollback;
