-- 固定开发身份，全部场景与草稿写入在事务中回滚。
begin;
do $pyramid$
declare owner_id uuid; other_id uuid; draft_id uuid; saved public.tool_scene_drafts; s jsonb; bad jsonb; flat jsonb; closed jsonb; partial jsonb;
  edge text; face text; shape text; v jsonb; width_value double precision; height_value double precision; angle double precision;
  pyramid jsonb := '{"toolId":"solid-nets","contentVersion":"solid-nets-lesson-v2","payload":{"title":"Pyramid","initial":{"version":"solid-nets-v3","kind":"square-pyramid","dimensions":{"width":3,"height":2,"depth":3},"angles":{"base-left":0,"base-right":0,"base-front":0,"base-back":0},"surfaces":{"base":{"color":"#8fbf88","label":"A","opacity":0.9},"left":{"color":"#df8a84","label":"B","opacity":0.9},"right":{"color":"#edce79","label":"C","opacity":0.9},"front":{"color":"#7da9ce","label":"D","opacity":0.9},"back":{"color":"#b39dcc","label":"E","opacity":0.9}},"anchor":null,"view":"angle","labelsVisible":true}}}';
  doc jsonb := '{"docVersion":"courseware-composition-v1","canvas":{"width":960,"height":720,"backgroundColor":"#ffffff"},"source":null,"overlay":{"docVersion":"page-doc-v1","canvas":{"width":960,"height":720,"backgroundColor":"#ffffff","backgroundBindingKey":null},"nodes":[],"interactions":[]},"layout":{"version":"courseware-composition-grid-v1","columns":12,"rows":9,"blocks":[]}}';
begin
  select id into owner_id from public.profiles where display_name='测试-教师' and is_active limit 1;
  select id into other_id from public.profiles where display_name='测试-教研' and is_active limit 1;
  if owner_id is null or other_id is null then raise exception 'FIXED_DEVELOPMENT_ACCOUNTS_REQUIRED'; end if;
  flat := pyramid; closed := pyramid; angle := 90+degrees(atan2(1.5,2));
  foreach edge in array array['base-left','base-right','base-front','base-back'] loop
    closed := jsonb_set(closed,array['payload','initial','angles',edge],to_jsonb(angle));
  end loop;
  partial := jsonb_set(jsonb_set(pyramid,'{payload,initial,angles,base-left}','52'),'{payload,initial,anchor}',
    '{"faceId":"left","vertices":[{"x":-1.5,"y":0,"z":-1.5},{"x":-4,"y":0,"z":0},{"x":-1.5,"y":0,"z":1.5}]}');
  foreach s in array array[flat,closed,partial] loop
    if public.tool_scene_is_valid(s) is not true or public.tool_scene_catalog_id(s) is distinct from 'solid-nets' then raise exception 'PYRAMID_VALID_STATE_REJECTED'; end if;
    doc := jsonb_set(doc,'{layout,blocks}',jsonb_build_array(jsonb_build_object('id','pyramid','type','tool','tool',s,
      'placement',jsonb_build_object('column',0,'row',0,'columnSpan',12,'rowSpan',9))));
    if public.cw_courseware_composition_doc_is_valid(doc) is not true or public.cw_manual_composition_doc_is_valid(doc) is not true
      or public.cw_formal_cube_page_is_valid(doc) is not true then raise exception 'PYRAMID_COURSEWARE_REJECTED'; end if;
    draft_id := gen_random_uuid();
    perform set_config('request.jwt.claim.sub',owner_id::text,true); perform set_config('request.jwt.claim.role','authenticated',true);
    execute 'set local role authenticated';
    saved := public.save_tool_scene_draft(draft_id,s,0);
    if saved.scene<>s or saved.catalog_id<>'solid-nets' or saved.revision<>1 then raise exception 'PYRAMID_SAVE_FAILED'; end if;
    if (select scene from public.tool_scene_drafts where id=draft_id) is distinct from s then raise exception 'PYRAMID_REREAD_FAILED'; end if;
    saved := public.save_tool_scene_draft(draft_id,flat,1);
    if saved.scene<>flat or saved.revision<>2 or doc#>'{layout,blocks,0,tool}'<>s then raise exception 'PYRAMID_RESTORE_OR_FIXED_COPY_FAILED'; end if;
    begin perform public.save_tool_scene_draft(draft_id,s,1); raise exception 'PYRAMID_STALE_WRITE_ACCEPTED';
    exception when sqlstate 'P0001' then if sqlerrm<>'TOOL_DRAFT_CONFLICT' then raise; end if; end;
    perform set_config('request.jwt.claim.sub',other_id::text,true);
    if (select count(*) from public.tool_scene_drafts where id=draft_id)<>0 then raise exception 'PYRAMID_OTHER_OWNER_READ'; end if;
    begin perform public.save_tool_scene_draft(draft_id,s,2); raise exception 'PYRAMID_OTHER_OWNER_WRITE';
    exception when sqlstate 'P0002' then null; end;
    execute 'reset role';
  end loop;
  foreach width_value in array array[0.25,3,8]::double precision[] loop
    foreach height_value in array array[0.25,2,8]::double precision[] loop
      s := jsonb_set(pyramid,'{payload,initial,dimensions}',jsonb_build_object('width',width_value,'height',height_value,'depth',width_value));
      angle := 90+degrees(atan2(width_value/2,height_value));
      foreach edge in array array['base-left','base-right','base-front','base-back'] loop
        s := jsonb_set(s,array['payload','initial','angles',edge],to_jsonb(angle));
      end loop;
      if public.tool_scene_is_valid(s) is not true then raise exception 'PYRAMID_DIMENSION_CLOSURE_REJECTED'; end if;
      if public.tool_scene_is_valid(jsonb_set(s,'{payload,initial,angles,base-left}',to_jsonb(angle+0.001))) then raise exception 'PYRAMID_EXCESS_ANGLE_ACCEPTED'; end if;
    end loop;
  end loop;
  -- 四个侧面同形，支持平面与折起后的刚体锚点。
  foreach face in array array['left','right','front','back'] loop
    foreach v in array array['[{"x":-1.5,"y":0,"z":-1.5},{"x":-4,"y":0,"z":0},{"x":-1.5,"y":0,"z":1.5}]'::jsonb,
      '[{"x":-1.5,"y":0,"z":-1.5},{"x":0,"y":2,"z":0},{"x":-1.5,"y":0,"z":1.5}]'::jsonb] loop
      s := jsonb_set(pyramid,'{payload,initial,anchor}',jsonb_build_object('faceId',face,'vertices',v));
      if public.tool_scene_is_valid(s) is not true then raise exception 'PYRAMID_RIGID_ANCHOR_REJECTED'; end if;
    end loop;
  end loop;
  -- 新版保留原三类形体，旧版本仍拒绝锥体。
  foreach shape in array array['cube','cuboid','triangular-prism'] loop
    s := jsonb_set(pyramid,'{payload,initial,kind}',to_jsonb(shape));
    if shape<>'triangular-prism' then
      s := jsonb_set(jsonb_set(s,'{payload,initial,surfaces,top}',s#>'{payload,initial,surfaces,base}'),'{payload,initial,angles,front-top}','0');
    end if;
    if shape='cube' then s := jsonb_set(s,'{payload,initial,dimensions,height}','3'); end if;
    if public.tool_scene_is_valid(s) is not true then raise exception 'PYRAMID_VERSION_OLD_SHAPE_REJECTED'; end if;
  end loop;
  foreach bad in array array[
    jsonb_set(pyramid,'{contentVersion}','"solid-nets-lesson-v1"'),jsonb_set(pyramid,'{payload,initial,version}','"solid-nets-v2"'),
    jsonb_set(pyramid,'{toolId}','"spatial-lab"'),pyramid||'{"draftId":"private"}',jsonb_set(pyramid,'{payload,title}','null'),
    jsonb_set(pyramid,'{payload,initial,dimensions,depth}','4'),jsonb_set(pyramid,'{payload,initial,dimensions,height}','0'),
    jsonb_set(pyramid,'{payload,initial,angles,front-top}','0'),pyramid #- '{payload,initial,surfaces,back}',
    jsonb_set(pyramid,'{payload,initial,surfaces,front,opacity}','2'),jsonb_set(pyramid,'{payload,initial,kind}','"cone"'),
    jsonb_set(partial,'{payload,initial,anchor,vertices,1,y}','1'),jsonb_set(partial,'{payload,initial,anchor,faceId}','"top"'),
    jsonb_set(jsonb_set(pyramid,'{contentVersion}','"solid-nets-lesson-v1"'),'{payload,initial,version}','"solid-nets-v2"')
  ] loop if public.tool_scene_is_valid(bad) then raise exception 'PYRAMID_INVALID_STATE_ACCEPTED'; end if; end loop;
  if has_function_privilege('authenticated','public.tool_solid_nets_polyhedra_scene_is_valid(jsonb)','execute')
    or has_function_privilege('anon','public.tool_solid_nets_polyhedra_scene_is_valid(jsonb)','execute') then raise exception 'PYRAMID_VALIDATOR_EXPOSED'; end if;
end;
$pyramid$;
rollback;
