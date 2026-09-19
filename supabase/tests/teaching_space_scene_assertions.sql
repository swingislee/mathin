-- 本机固定开发身份，全部造数位于回滚事务中，不接触既有课件/发布/课堂记录。
begin;
do $spaces$
declare owner_id uuid; other_id uuid; draft_id uuid; saved public.tool_scene_drafts; s jsonb; bad jsonb; expected_catalog text;
  solid jsonb := '{"toolId":"solid-geometry","contentVersion":"solid-geometry-lesson-v1","payload":{"title":"Solid","initial":{"entities":[{"id":"solid-1","kind":"cuboid","dimensions":{"width":2,"height":2,"depth":2,"radius":1},"position":{"x":0,"y":1,"z":0},"rotation":{"x":0,"y":0,"z":0},"color":"#8fbf88","opacity":1}],"selectedId":"solid-1","feature":null,"axes":true,"grid":false,"view":"angle","section":{"enabled":true,"axis":"y","offset":0,"tiltA":30,"tiltB":15,"removedSide":"positive","showPlane":true},"measurement":{"enabled":false,"dimensions":true,"faceArea":true,"totals":true,"unitGrid":false,"unitFill":false,"fillLayers":0,"unit":"unit"}}}}';
  paper jsonb := '{"toolId":"spatial-lab","contentVersion":"cube-net-lesson-v2","payload":{"title":"Paper","initial":{"mode":"free-paper","data":{"version":"paper-folding-v1","squares":[{"id":"s_0_0","x":0,"z":0,"color":"#8fbf88","label":"1"}],"angles":{},"anchor":null,"view":"angle","labelsVisible":true}}}}';
  capacity jsonb := '{"toolId":"solid-capacity","contentVersion":"solid-capacity-lesson-v1","payload":{"title":"Capacity","initial":{"cone":{"radius":1,"height":3,"fill":1},"cylinder":{"radius":1,"height":3,"fill":0},"coneOrientation":"tip-down","linkedDimensions":true,"showAmounts":false,"showDimensions":true,"axes":false,"grid":false,"view":"angle"}}}';
  prism jsonb := '{"toolId":"spatial-lab","contentVersion":"cube-net-lesson-v2","payload":{"title":"Prism","initial":{"mode":"solid-net","data":{"version":"solid-nets-v1","kind":"triangular-prism","dimensions":{"width":2,"height":2,"depth":3},"angles":{"base-left":0,"base-right":0,"base-front":0,"base-back":0},"surfaces":{"base":{"color":"#8fbf88","label":"A","opacity":0.9},"left":{"color":"#df8a84","label":"B","opacity":0.9},"right":{"color":"#edce79","label":"C","opacity":0.9},"front":{"color":"#7da9ce","label":"D","opacity":0.9},"back":{"color":"#b39dcc","label":"E","opacity":0.9}},"anchor":null,"view":"angle","labelsVisible":true}}}}';
  cube jsonb := '{"toolId":"spatial-lab","contentVersion":"cube-structures-lesson-v3","payload":{"title":"Rotation","toolbar":["move","reset"],"history":{"version":"cube-structures-draft-v4","initial":{"cubes":[{"id":"cube-1","position":{"x":0,"y":0,"z":0},"color":"#8fbf88","faces":{}}],"hiddenCubeIds":[],"groups":[],"origin":{"x":-0.5,"y":-0.5,"z":-0.5},"axesVisible":true,"view":"angle","frame":{"center":{"x":0,"y":0,"z":0},"radius":2.5},"nextCubeId":2,"nextNumber":1,"hiddenEdgesVisible":true},"operations":[{"kind":"rotate","ids":["cube-1"],"axis":"y","turn":1,"pivot":{"x":0,"y":0,"z":0},"displayPivot":{"x":0,"y":0,"z":0}}],"cursor":0}}}';
  doc jsonb := '{"docVersion":"courseware-composition-v1","canvas":{"width":960,"height":720,"backgroundColor":"#ffffff"},"source":null,"overlay":{"docVersion":"page-doc-v1","canvas":{"width":960,"height":720,"backgroundColor":"#ffffff","backgroundBindingKey":null},"nodes":[],"interactions":[]},"layout":{"version":"courseware-composition-grid-v1","columns":12,"rows":9,"blocks":[]}}';
begin
  select id into owner_id from public.profiles where display_name='测试-教师' and is_active limit 1;
  select id into other_id from public.profiles where display_name='测试-教研' and is_active limit 1;
  if owner_id is null or other_id is null then raise exception 'FIXED_DEVELOPMENT_ACCOUNTS_REQUIRED'; end if;
  foreach s in array array[solid,paper,prism,cube,capacity] loop
    expected_catalog := public.tool_scene_catalog_id(s);
    if public.tool_scene_is_valid(s) is not true or expected_catalog is null then raise exception 'SPACE_VALID_SCENE_REJECTED: %',s->>'contentVersion'; end if;
    foreach bad in array array[s-'contentVersion',s-'payload',s||'{"draftId":"private"}',jsonb_set(s,'{toolId}','"incorrect"'),jsonb_set(s,'{payload,title}','null')] loop
      if public.tool_scene_is_valid(bad) then raise exception 'SPACE_INVALID_ENVELOPE_ACCEPTED'; end if;
    end loop;
    doc := jsonb_set(doc,'{layout,blocks}',jsonb_build_array(jsonb_build_object('id','space-1','type','tool','tool',s,
      'placement',jsonb_build_object('column',0,'row',0,'columnSpan',12,'rowSpan',9))));
    if public.cw_courseware_composition_doc_is_valid(doc) is not true or public.cw_manual_composition_doc_is_valid(doc) is not true
      or public.cw_formal_cube_page_is_valid(doc) is not true then raise exception 'SPACE_COURSEWARE_REJECTED'; end if;
    draft_id := gen_random_uuid();
    perform set_config('request.jwt.claim.sub',owner_id::text,true); perform set_config('request.jwt.claim.role','authenticated',true);
    execute 'set local role authenticated';
    saved := public.save_tool_scene_draft(draft_id,s,0);
    if saved.catalog_id<>expected_catalog or saved.scene<>s or saved.revision<>1 then raise exception 'SPACE_DRAFT_ROUNDTRIP_FAILED'; end if;
    saved := public.save_tool_scene_draft(draft_id,jsonb_set(s,'{payload,title}','"Changed"'),1);
    if saved.revision<>2 or doc#>'{layout,blocks,0,tool}'<>s then raise exception 'SPACE_FIXED_COPY_CHANGED'; end if;
    begin perform public.save_tool_scene_draft(draft_id,s,1); raise exception 'SPACE_STALE_WRITE_ACCEPTED';
    exception when sqlstate 'P0001' then if sqlerrm<>'TOOL_DRAFT_CONFLICT' then raise; end if; end;
    perform set_config('request.jwt.claim.sub',other_id::text,true);
    if (select count(*) from public.tool_scene_drafts where id=draft_id)<>0 then raise exception 'SPACE_OTHER_OWNER_READ'; end if;
    begin perform public.save_tool_scene_draft(draft_id,s,2); raise exception 'SPACE_OTHER_OWNER_WRITE';
    exception when sqlstate 'P0002' then null; end;
    execute 'reset role';
  end loop;
  foreach bad in array array[
    jsonb_set(cube,'{contentVersion}','"cube-structures-lesson-v2"'),
    jsonb_set(cube,'{payload,history,version}','"cube-structures-draft-v3"'),
    jsonb_set(cube,'{payload,history,operations,0,turn}','2'),
    jsonb_set(paper,'{payload,initial,mode}','"solid-net"'),jsonb_set(paper,'{payload,initial,data,squares,0,x}','99'),
    jsonb_set(prism,'{payload,initial,data,dimensions,width}','0'),jsonb_set(prism,'{payload,initial,data,surfaces,base,opacity}','2'),
    jsonb_set(solid,'{payload,initial,selectedId}','"missing"'),jsonb_set(solid,'{payload,initial,entities,0,opacity}','2'),
    jsonb_set(solid,'{payload,initial,section,tiltA}','100'),jsonb_set(solid,'{payload,initial,measurement,fillLayers}','20'),
    jsonb_set(capacity,'{payload,initial,cone,fill}','2'),jsonb_set(capacity,'{payload,initial,cylinder,radius}','2'),
    jsonb_set(capacity,'{payload,initial,coneOrientation}','"sideways"')
  ] loop if public.tool_scene_is_valid(bad) then raise exception 'SPACE_INVALID_PARAMETERS_ACCEPTED'; end if; end loop;
  if has_function_privilege('authenticated','public.tool_net_teaching_scene_is_valid(jsonb)','execute')
    or has_function_privilege('anon','public.tool_solid_geometry_scene_is_valid(jsonb)','execute') then raise exception 'SPACE_VALIDATOR_EXPOSED'; end if;
end;
$spaces$;
rollback;
