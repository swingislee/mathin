-- 共用 Tools 保存/课件/RLS 路径的本批集成门；固定开发身份，全部写入回滚。
begin;
do $batch$
declare owner_id uuid; other_id uuid; draft_id uuid; saved public.tool_scene_drafts; s jsonb; bad jsonb; fn text;
  curved jsonb := '{"toolId":"solid-nets","contentVersion":"solid-nets-lesson-v3","payload":{"title":"Curved net","initial":{"mode":"curved","data":{"version":"curved-net-v1","kind":"cylinder","radius":1,"height":2.5,"progress":{"side":0.5,"lower":1,"upper":1},"surfaces":{"side":{"color":"#e7e0d0","opacity":0.9},"lower":{"color":"#df8a84","opacity":0.9},"upper":{"color":"#edce79","opacity":0.9}},"labelsVisible":true,"view":"angle","motion":null}}}}'::jsonb;
  capacity jsonb := '{"toolId":"solid-capacity","contentVersion":"solid-capacity-lesson-v2","payload":{"title":"Displacement","initial":{"mode":"displacement","pour":{"cone":{"radius":1,"height":3,"fill":1},"cylinder":{"radius":1,"height":3,"fill":0},"coneOrientation":"tip-down","linkedDimensions":true,"showAmounts":false,"showDimensions":true,"axes":false,"grid":false,"view":"angle"},"displacement":{"tank":{"width":6,"depth":4,"height":5,"waterHeight":2},"body":{"kind":"stepped","width":2,"height":2,"depth":2,"bottom":1.1},"showAmounts":false,"showDimensions":true,"showInitialLevel":true,"axes":false,"grid":false,"view":"angle"}}}}'::jsonb;
  geometry jsonb := '{"toolId":"solid-geometry","contentVersion":"solid-geometry-lesson-v2","payload":{"title":"Units and solid observation","initial":{"entities":[{"id":"solid-1","kind":"cuboid","dimensions":{"width":3,"height":2,"depth":2,"radius":1},"position":{"x":0,"y":1,"z":0},"rotation":{"x":0,"y":0,"z":0},"color":"#8fbf88","opacity":1}],"selectedId":"solid-1","feature":null,"axes":true,"grid":false,"view":"angle","section":{"enabled":false,"axis":"y","offset":0,"tiltA":0,"tiltB":0,"removedSide":"none","showPlane":true},"measurement":{"enabled":true,"dimensions":true,"faceArea":true,"totals":true,"unitGrid":false,"unitFill":false,"fillLayers":0,"unit":"cm","version":"solid-measurement-v2","displayUnit":"mm","accumulation":"length","accumulationCount":2},"cuts":[]}}}'::jsonb;
  revolution jsonb := '{"toolId":"solid-revolution","contentVersion":"solid-revolution-lesson-v1","payload":{"title":"Solid of revolution","initial":{"shape":"right-triangle","axis":"height","width":2,"height":3,"angle":180,"speed":30,"showSweep":true,"showStart":true,"showMeasures":true,"axes":false,"grid":true,"view":"angle"}}}'::jsonb;
  doc jsonb := '{"docVersion":"courseware-composition-v1","canvas":{"width":960,"height":720,"backgroundColor":"#ffffff"},"source":null,"overlay":{"docVersion":"page-doc-v1","canvas":{"width":960,"height":720,"backgroundColor":"#ffffff","backgroundBindingKey":null},"nodes":[],"interactions":[]},"layout":{"version":"courseware-composition-grid-v1","columns":12,"rows":9,"blocks":[]}}'::jsonb;
begin
  select id into owner_id from public.profiles where display_name='测试-教师' and is_active limit 1;
  select id into other_id from public.profiles where display_name='测试-教研' and is_active limit 1;
  if owner_id is null or other_id is null then raise exception 'FIXED_DEVELOPMENT_ACCOUNTS_REQUIRED'; end if;
  foreach s in array array[curved,capacity,geometry,revolution] loop
    if public.tool_scene_is_valid(s) is not true or public.tool_scene_catalog_id(s) is distinct from s->>'toolId' then raise exception 'BATCH_VALID_SCENE_REJECTED: %',s->>'contentVersion'; end if;
    foreach bad in array array[s-'payload',s||'{"draftId":"private"}',jsonb_set(s,'{toolId}','"incorrect"'),jsonb_set(s,'{payload,title}','null'),jsonb_set(s,'{contentVersion}','"unknown"')] loop
      if public.tool_scene_is_valid(bad) then raise exception 'BATCH_INVALID_ENVELOPE_ACCEPTED'; end if;
    end loop;
    doc := jsonb_set(doc,'{layout,blocks}',jsonb_build_array(jsonb_build_object('id','teaching-space','type','tool','tool',s,
      'placement',jsonb_build_object('column',0,'row',0,'columnSpan',12,'rowSpan',9))));
    if public.cw_courseware_composition_doc_is_valid(doc) is not true or public.cw_manual_composition_doc_is_valid(doc) is not true
      or public.cw_formal_cube_page_is_valid(doc) is not true then raise exception 'BATCH_COURSEWARE_REJECTED'; end if;
    draft_id := gen_random_uuid();
    perform set_config('request.jwt.claim.sub',owner_id::text,true); perform set_config('request.jwt.claim.role','authenticated',true);
    execute 'set local role authenticated';
    saved := public.save_tool_scene_draft(draft_id,s,0);
    if saved.catalog_id<>s->>'toolId' or saved.scene<>s or saved.revision<>1 then raise exception 'BATCH_DRAFT_ROUNDTRIP_FAILED'; end if;
    if (select scene from public.tool_scene_drafts where id=draft_id) is distinct from s then raise exception 'BATCH_DRAFT_REREAD_FAILED'; end if;
    saved := public.save_tool_scene_draft(draft_id,jsonb_set(s,'{payload,title}','"Revised scene"'),1);
    if saved.revision<>2 or doc#>'{layout,blocks,0,tool}'<>s then raise exception 'BATCH_FIXED_COPY_CHANGED'; end if;
    begin perform public.save_tool_scene_draft(draft_id,s,1); raise exception 'BATCH_STALE_WRITE_ACCEPTED';
    exception when sqlstate 'P0001' then if sqlerrm<>'TOOL_DRAFT_CONFLICT' then raise; end if; end;
    perform set_config('request.jwt.claim.sub',other_id::text,true);
    if (select count(*) from public.tool_scene_drafts where id=draft_id)<>0 then raise exception 'BATCH_OTHER_OWNER_READ'; end if;
    begin perform public.save_tool_scene_draft(draft_id,s,2); raise exception 'BATCH_OTHER_OWNER_WRITE';
    exception when sqlstate 'P0002' then null; end;
    execute 'reset role';
  end loop;
  foreach fn in array array['tool_solid_nets_complete_scene_is_valid','tool_capacity_displacement_initial_is_valid','tool_solid_capacity_teaching_scene_is_valid','tool_solid_geometry_exploration_scene_is_valid','tool_solid_revolution_scene_is_valid'] loop
    if has_function_privilege('authenticated','public.'||fn||'(jsonb)','execute') or has_function_privilege('anon','public.'||fn||'(jsonb)','execute') then raise exception 'BATCH_PRIVATE_VALIDATOR_EXPOSED: %',fn; end if;
  end loop;
end;
$batch$;
rollback;
