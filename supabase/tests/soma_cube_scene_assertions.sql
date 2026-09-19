-- 固定开发身份；本文件的草稿及课件断言全部回滚。
begin;
do $soma$
declare owner_id uuid; other_id uuid; draft_id uuid; saved public.tool_scene_drafts; bits integer; n integer; turn integer;
  chosen jsonb; initial jsonb; s jsonb; bad jsonb; one jsonb;
  pieces jsonb := '[{"id":"bao-1","orientation":0,"position":{"x":-4,"y":0,"z":-2}},{"id":"bao-2","orientation":0,"position":{"x":-1,"y":0,"z":-2}},{"id":"bao-3","orientation":0,"position":{"x":2,"y":0,"z":-2}},{"id":"bao-4","orientation":0,"position":{"x":5,"y":0,"z":-2}},{"id":"bao-5","orientation":0,"position":{"x":-4,"y":0,"z":2}},{"id":"bao-6","orientation":0,"position":{"x":-1,"y":0,"z":2}},{"id":"bao-7","orientation":0,"position":{"x":2,"y":0,"z":2}}]';
  cube jsonb := '[{"id":"bao-1","orientation":1,"position":{"x":-1,"y":0,"z":-1}},{"id":"bao-2","orientation":4,"position":{"x":-1,"y":1,"z":-1}},{"id":"bao-3","orientation":2,"position":{"x":-1,"y":0,"z":1}},{"id":"bao-4","orientation":6,"position":{"x":-1,"y":0,"z":-1}},{"id":"bao-5","orientation":10,"position":{"x":0,"y":0,"z":-1}},{"id":"bao-6","orientation":4,"position":{"x":0,"y":1,"z":-1}},{"id":"bao-7","orientation":12,"position":{"x":0,"y":1,"z":0}}]';
  doc jsonb := '{"docVersion":"courseware-composition-v1","canvas":{"width":960,"height":720,"backgroundColor":"#ffffff"},"source":null,"overlay":{"docVersion":"page-doc-v1","canvas":{"width":960,"height":720,"backgroundColor":"#ffffff","backgroundBindingKey":null},"nodes":[],"interactions":[]},"layout":{"version":"courseware-composition-grid-v1","columns":12,"rows":9,"blocks":[]}}';
begin
  initial := jsonb_build_object('pieces',pieces,'selectedId','bao-1','mode','assemble','view','angle','grid',true,'axes',false,'labels',true,
    'frame',jsonb_build_object('center',jsonb_build_object('x',1,'y',0.5,'z',1),'radius',7),'cameraRevision',1);
  s := jsonb_build_object('toolId','soma-cube','contentVersion','soma-cube-lesson-v1','payload',jsonb_build_object('title','Soma','initial',initial));
  if public.tool_scene_is_valid(s) is not true or public.tool_scene_catalog_id(s)<>'soma-cube' then raise exception 'SOMA_REGISTRATION_FAILED'; end if;
  for bits in 1..127 loop
    chosen := '[]';
    for n in 0..6 loop if (bits & (1 << n))<>0 then chosen := chosen||jsonb_build_array(pieces->n); end if; end loop;
    one := jsonb_set(jsonb_set(s,'{payload,initial,pieces}',chosen),'{payload,initial,selectedId}',chosen#>'{0,id}');
    if public.tool_scene_is_valid(one) is not true then raise exception 'SOMA_SUBSET_REJECTED: %',bits; end if;
  end loop;
  for n in 0..6 loop for turn in 0..23 loop
    chosen := jsonb_build_array(jsonb_set(jsonb_set(pieces->n,'{orientation}',to_jsonb(turn)),'{position}','{"x":0,"y":0,"z":0}'));
    one := jsonb_set(jsonb_set(s,'{payload,initial,pieces}',chosen),'{payload,initial,selectedId}',chosen#>'{0,id}');
    if public.tool_scene_is_valid(one) is not true then raise exception 'SOMA_ORIENTATION_REJECTED: % %',n,turn; end if;
    if (select count(*) from public.tool_soma_cells('bao-'||(n+1),turn))<>(case when n=0 then 3 else 4 end) then raise exception 'SOMA_PIECE_VOLUME_CHANGED'; end if;
  end loop; end loop;
  if public.tool_scene_is_valid(jsonb_set(s,'{payload,initial,pieces}',cube)) is not true then raise exception 'SOMA_CUBE_EXAMPLE_INVALID'; end if;
  if (select count(distinct (c.x+(p#>>'{position,x}')::integer,c.y+(p#>>'{position,y}')::integer,c.z+(p#>>'{position,z}')::integer))
    from jsonb_array_elements(cube) p cross join lateral public.tool_soma_cells(p->>'id',(p->>'orientation')::integer) c)<>27 then raise exception 'SOMA_EXAMPLE_VOLUME_INVALID'; end if;
  foreach bad in array array[
    s-'contentVersion', s||'{"sourceDraft":"private"}', jsonb_set(s,'{toolId}','null'),jsonb_set(s,'{contentVersion}','null'),
    jsonb_set(s,'{payload,initial,mode}','null'),jsonb_set(s,'{payload,initial,grid}','null'),jsonb_set(s,'{payload,initial,selectedId}','"bao-8"'),
    jsonb_set(s,'{payload,initial,pieces}','[]'),jsonb_set(s,'{payload,initial,pieces}',pieces||jsonb_build_array(pieces->0)),
    jsonb_set(s,'{payload,initial,pieces,1,id}','"bao-1"'),jsonb_set(s,'{payload,initial,pieces,0,orientation}','24'),
    jsonb_set(s,'{payload,initial,pieces,0,position,x}','0.5'),jsonb_set(s,'{payload,initial,pieces,0,position,y}','-1'),
    jsonb_set(s,'{payload,initial,pieces,0,position,y}','12'),jsonb_set(s,'{payload,initial,pieces,1,position}',pieces#>'{0,position}'),
    jsonb_set(s,'{payload,initial,frame,radius}','0'),jsonb_set(s,'{payload,initial,cameraRevision}','-1')
  ] loop if public.tool_scene_is_valid(bad) then raise exception 'SOMA_INVALID_PARAMETERS_ACCEPTED: %',bad; end if; end loop;
  doc := jsonb_set(doc,'{layout,blocks}',jsonb_build_array(jsonb_build_object('id','soma-1','type','tool','tool',s,
    'placement',jsonb_build_object('column',0,'row',0,'columnSpan',12,'rowSpan',9))));
  if public.cw_courseware_composition_doc_is_valid(doc) is not true or public.cw_manual_composition_doc_is_valid(doc) is not true
    or public.cw_formal_cube_page_is_valid(doc) is not true then raise exception 'SOMA_COURSEWARE_REJECTED'; end if;
  select id into owner_id from public.profiles where display_name='测试-教师' and is_active limit 1;
  select id into other_id from public.profiles where display_name='测试-教研' and is_active limit 1;
  if owner_id is null or other_id is null then raise exception 'FIXED_DEVELOPMENT_ACCOUNTS_REQUIRED'; end if;
  draft_id := gen_random_uuid();
  perform set_config('request.jwt.claim.sub',owner_id::text,true); perform set_config('request.jwt.claim.role','authenticated',true);
  execute 'set local role authenticated';
  saved := public.save_tool_scene_draft(draft_id,s,0);
  if saved.scene<>s or saved.catalog_id<>'soma-cube' or saved.revision<>1 then raise exception 'SOMA_DRAFT_SAVE_FAILED'; end if;
  if (select scene from public.tool_scene_drafts where id=draft_id)<>s then raise exception 'SOMA_DRAFT_READ_FAILED'; end if;
  saved := public.save_tool_scene_draft(draft_id,jsonb_set(s,'{payload,title}','"Changed"'),1);
  if saved.revision<>2 or doc#>'{layout,blocks,0,tool}'<>s then raise exception 'SOMA_FIXED_COPY_CHANGED'; end if;
  begin perform public.save_tool_scene_draft(draft_id,s,1); raise exception 'SOMA_STALE_WRITE_ACCEPTED';
  exception when sqlstate 'P0001' then if sqlerrm<>'TOOL_DRAFT_CONFLICT' then raise; end if; end;
  perform set_config('request.jwt.claim.sub',other_id::text,true);
  if (select count(*) from public.tool_scene_drafts where id=draft_id)<>0 then raise exception 'SOMA_OTHER_OWNER_READ'; end if;
  begin perform public.save_tool_scene_draft(draft_id,s,2); raise exception 'SOMA_OTHER_OWNER_WRITE';
  exception when sqlstate 'P0002' then null; end;
  execute 'reset role';
  if has_function_privilege('authenticated','public.tool_soma_scene_is_valid(jsonb)','execute')
    or has_function_privilege('anon','public.tool_soma_cells(text,integer)','execute') then raise exception 'SOMA_VALIDATOR_EXPOSED'; end if;
end;
$soma$;
rollback;
