-- 固定开发身份；独立场景保存、旧版读取及冻结副本验证均回滚。
begin;
do $nets$
declare owner_id uuid; other_id uuid; draft_id uuid; saved public.tool_scene_drafts; s jsonb; bad jsonb; legacy jsonb; expected_catalog text;
  paper jsonb := '{"toolId":"spatial-lab","contentVersion":"cube-net-lesson-v3","payload":{"title":"Cube exploration","initial":{"mode":"free-paper","data":{"version":"paper-folding-v1","squares":[{"id":"s_0_0","x":0,"z":0,"color":"#8fbf88","label":"1"}],"angles":{},"anchor":null,"view":"angle","labelsVisible":true}}}}';
  solid jsonb := '{"toolId":"solid-nets","contentVersion":"solid-nets-lesson-v1","payload":{"title":"Cube net","initial":{"version":"solid-nets-v2","kind":"cube","dimensions":{"width":2,"height":2,"depth":2},"angles":{"base-left":0,"base-right":0,"base-front":0,"base-back":0,"front-top":0},"surfaces":{"base":{"color":"#8fbf88","label":"A","opacity":0.9},"left":{"color":"#df8a84","label":"B","opacity":0.9},"right":{"color":"#edce79","label":"C","opacity":0.9},"front":{"color":"#7da9ce","label":"D","opacity":0.9},"back":{"color":"#b39dcc","label":"E","opacity":0.9},"top":{"color":"#e7e0d0","label":"F","opacity":0.9}},"anchor":null,"view":"angle","labelsVisible":true}}}';
  cuboid jsonb; prism jsonb;
  doc jsonb := '{"docVersion":"courseware-composition-v1","canvas":{"width":960,"height":720,"backgroundColor":"#ffffff"},"source":null,"overlay":{"docVersion":"page-doc-v1","canvas":{"width":960,"height":720,"backgroundColor":"#ffffff","backgroundBindingKey":null},"nodes":[],"interactions":[]},"layout":{"version":"courseware-composition-grid-v1","columns":12,"rows":9,"blocks":[]}}';
begin
  select id into owner_id from public.profiles where display_name='测试-教师' and is_active limit 1;
  select id into other_id from public.profiles where display_name='测试-教研' and is_active limit 1;
  if owner_id is null or other_id is null then raise exception 'FIXED_DEVELOPMENT_ACCOUNTS_REQUIRED'; end if;
  cuboid := jsonb_set(jsonb_set(solid,'{payload,initial,kind}','"cuboid"'),'{payload,initial,dimensions,width}','3');
  prism := jsonb_set(cuboid,'{payload,initial,kind}','"triangular-prism"') #- '{payload,initial,surfaces,top}' #- '{payload,initial,angles,front-top}';
  legacy := jsonb_build_object('toolId','spatial-lab','contentVersion','cube-net-lesson-v2','payload',jsonb_build_object('title','Legacy prism',
    'initial',jsonb_build_object('mode','solid-net','data',jsonb_set(prism#>'{payload,initial}','{version}','"solid-nets-v1"'))));
  foreach s in array array[paper,solid,cuboid,prism,legacy,jsonb_set(paper,'{contentVersion}','"cube-net-lesson-v2"')] loop
    expected_catalog := case when s->>'toolId'='solid-nets' then 'solid-nets' else 'cube-net' end;
    if public.tool_scene_is_valid(s) is not true or public.tool_scene_catalog_id(s) is distinct from expected_catalog then raise exception 'NET_TOOL_IDENTITY_FAILED'; end if;
    foreach bad in array array[s-'payload',s||'{"draftId":"private"}',jsonb_set(s,'{toolId}','"incorrect"'),jsonb_set(s,'{payload,title}','null'),jsonb_set(s,'{contentVersion}','"unknown"')] loop
      if public.tool_scene_is_valid(bad) then raise exception 'NET_TOOL_INVALID_ENVELOPE_ACCEPTED'; end if;
    end loop;
    doc := jsonb_set(doc,'{layout,blocks}',jsonb_build_array(jsonb_build_object('id','net-1','type','tool','tool',s,
      'placement',jsonb_build_object('column',0,'row',0,'columnSpan',12,'rowSpan',9))));
    if public.cw_courseware_composition_doc_is_valid(doc) is not true or public.cw_manual_composition_doc_is_valid(doc) is not true
      or public.cw_formal_cube_page_is_valid(doc) is not true then raise exception 'NET_TOOL_COURSEWARE_REJECTED'; end if;
    draft_id := gen_random_uuid();
    perform set_config('request.jwt.claim.sub',owner_id::text,true); perform set_config('request.jwt.claim.role','authenticated',true);
    execute 'set local role authenticated';
    saved := public.save_tool_scene_draft(draft_id,s,0);
    if saved.catalog_id<>expected_catalog or saved.scene<>s or saved.revision<>1 then raise exception 'NET_TOOL_DRAFT_ROUNDTRIP_FAILED'; end if;
    saved := public.save_tool_scene_draft(draft_id,jsonb_set(s,'{payload,title}','"Changed"'),1);
    if saved.revision<>2 or doc#>'{layout,blocks,0,tool}'<>s then raise exception 'NET_TOOL_FIXED_COPY_CHANGED'; end if;
    begin perform public.save_tool_scene_draft(draft_id,s,1); raise exception 'NET_TOOL_STALE_WRITE_ACCEPTED';
    exception when sqlstate 'P0001' then if sqlerrm<>'TOOL_DRAFT_CONFLICT' then raise; end if; end;
    perform set_config('request.jwt.claim.sub',other_id::text,true);
    if (select count(*) from public.tool_scene_drafts where id=draft_id)<>0 then raise exception 'NET_TOOL_OTHER_OWNER_READ'; end if;
    begin perform public.save_tool_scene_draft(draft_id,s,2); raise exception 'NET_TOOL_OTHER_OWNER_WRITE';
    exception when sqlstate 'P0002' then null; end;
    execute 'reset role';
  end loop;
  foreach bad in array array[
    jsonb_set(legacy,'{contentVersion}','"cube-net-lesson-v3"'),
    jsonb_set(solid,'{payload,initial,dimensions,height}','3'),
    jsonb_set(solid,'{payload,initial,version}','"solid-nets-v1"'),
    jsonb_set(solid,'{payload,initial,kind}','"cone"'),
    jsonb_set(solid,'{payload,initial,angles,base-left}','91'),
    jsonb_set(solid,'{payload,initial,angles,phantom}','0'),
    solid #- '{payload,initial,surfaces,top}',
    jsonb_set(prism,'{payload,initial,dimensions,width}','0')
  ] loop if public.tool_scene_is_valid(bad) then raise exception 'NET_TOOL_INVALID_PARAMETERS_ACCEPTED'; end if; end loop;
  if has_function_privilege('authenticated','public.tool_cube_net_exploration_scene_is_valid(jsonb)','execute')
    or has_function_privilege('anon','public.tool_solid_nets_scene_is_valid(jsonb)','execute') then raise exception 'NET_TOOL_VALIDATOR_EXPOSED'; end if;
end;
$nets$;
rollback;
