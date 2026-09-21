-- 立体观察 v2：参数化切块与模型单位。旧 v1 验证器和冻结场景保持不变。
create function public.tool_solid_geometry_exploration_scene_is_valid(s jsonb)
returns boolean language plpgsql immutable set search_path = pg_catalog,public as $$
declare
  i jsonb := s#>'{payload,initial}'; m jsonb := i->'measurement'; legacy jsonb;
  cut jsonb; piece jsonb; entity jsonb; normal jsonb; d jsonb; vertex jsonb; vertices jsonb;
  ids text[] := '{}'; all_ids text[] := '{}'; cut_ids text[] := '{}'; sources text[] := '{}'; object_id text; key text;
  nx double precision; ny double precision; nz double precision; distance double precision;
  w double precision; h double precision; depth double precision; projected double precision; lo double precision; hi double precision;
  sx integer; sy integer; sz integer;
begin
  if not public.tool_space_keys(s,array['toolId','contentVersion','payload'],array['toolId','contentVersion','payload'])
    or s->>'toolId' is distinct from 'solid-geometry' or s->>'contentVersion' is distinct from 'solid-geometry-lesson-v2'
    or not public.tool_space_keys(s->'payload',array['title','initial'],array['title','initial'])
    or not public.tool_space_keys(i,array['entities','selectedId','feature','axes','grid','view','section','measurement','cuts'],array['entities','selectedId','feature','axes','grid','view','section','measurement','cuts'])
    or not public.tool_space_keys(m,array['enabled','dimensions','faceArea','totals','unitGrid','unitFill','fillLayers','unit','version','displayUnit','accumulation','accumulationCount'],array['enabled','dimensions','faceArea','totals','unitGrid','unitFill','fillLayers','unit','version','displayUnit','accumulation','accumulationCount'])
    or m->>'version' is distinct from 'solid-measurement-v2'
    or not coalesce(m->>'unit' in ('unit','mm','cm','dm','m'),false) or not coalesce(m->>'displayUnit' in ('unit','mm','cm','dm','m'),false)
    or ((m->>'unit'='unit')<>(m->>'displayUnit'='unit'))
    or not coalesce(m->>'accumulation' in ('none','length','area','volume'),false)
    or not coalesce(i->>'view' in ('angle','front','left','right','top','bottom'),false)
    or not coalesce(i#>>'{section,axis}' in ('x','y','z'),false)
    or not coalesce(i#>>'{section,removedSide}' in ('none','positive','negative'),false)
    or not public.tool_space_number(m->'accumulationCount',0,1728,true)
    or jsonb_typeof(i->'cuts')<>'array' or jsonb_array_length(i->'cuts')>16 then return false; end if;
  -- 共用原实体、显示设置、尺寸与素材颜色的旧严格边界；新字段单独校验。
  legacy := jsonb_set(s,'{contentVersion}','"solid-geometry-lesson-v1"'::jsonb);
  legacy := jsonb_set(legacy,'{payload,initial}',(i-'cuts') || jsonb_build_object('selectedId',null,'feature',null,'measurement',
    (m-'version'-'displayUnit'-'accumulation'-'accumulationCount') || jsonb_build_object('unit','unit')));
  if not public.tool_solid_geometry_scene_is_valid(legacy) then return false; end if;
  for entity in select value from jsonb_array_elements(i->'entities') loop
    if not coalesce(entity->>'kind' in ('cube','cuboid','triangular-prism','square-pyramid','cylinder','cone','sphere'),false)
      or not coalesce(entity->>'color' in ('#8fbf88','#df8a84','#edce79','#7da9ce','#b39dcc','#e7e0d0'),false) then return false; end if;
    ids := array_append(ids,entity->>'id');
  end loop;
  all_ids := ids;
  for cut in select value from jsonb_array_elements(i->'cuts') loop
    if not public.tool_space_keys(cut,array['id','entityId','normal','distance','pieces','cutColor'],array['id','entityId','normal','distance','pieces','cutColor'])
      or jsonb_typeof(cut->'id')<>'string' or char_length(cut->>'id') not between 1 and 40
      or jsonb_typeof(cut->'entityId')<>'string' or cut->>'entityId'=any(sources) or cut->>'id'=any(cut_ids)
      or not public.tool_space_vector(cut->'normal',1.000001) or not public.tool_space_number(cut->'distance',-24,24)
      or not coalesce(cut->>'cutColor' in ('#8fbf88','#df8a84','#edce79','#7da9ce','#b39dcc','#e7e0d0'),false)
      or jsonb_typeof(cut->'pieces')<>'array' or jsonb_array_length(cut->'pieces')<>2 then return false; end if;
    select value into entity from jsonb_array_elements(i->'entities') where value->>'id'=cut->>'entityId';
    if entity is null or entity->>'kind' not in ('cube','cuboid','triangular-prism','square-pyramid') then return false; end if;
    normal := cut->'normal'; nx := (normal->>'x')::double precision; ny := (normal->>'y')::double precision; nz := (normal->>'z')::double precision;
    if abs(sqrt(nx*nx+ny*ny+nz*nz)-1)>=0.000001 then return false; end if;
    distance := (cut->>'distance')::double precision; d := entity->'dimensions'; w := (d->>'width')::double precision; h := (d->>'height')::double precision; depth := (d->>'depth')::double precision;
    vertices := '[]'::jsonb;
    if entity->>'kind' in ('cube','cuboid') then
      foreach sx in array array[-1,1] loop foreach sy in array array[-1,1] loop foreach sz in array array[-1,1] loop
        vertices := vertices || jsonb_build_array(jsonb_build_array(sx*w/2,sy*h/2,sz*depth/2));
      end loop; end loop; end loop;
    elsif entity->>'kind'='triangular-prism' then
      foreach sz in array array[-1,1] loop vertices := vertices || jsonb_build_array(jsonb_build_array(-w/2,-h/2,sz*depth/2),jsonb_build_array(w/2,-h/2,sz*depth/2),jsonb_build_array(0,h/2,sz*depth/2)); end loop;
    else
      vertices := jsonb_build_array(jsonb_build_array(-w/2,-h/2,-w/2),jsonb_build_array(w/2,-h/2,-w/2),jsonb_build_array(w/2,-h/2,w/2),jsonb_build_array(-w/2,-h/2,w/2),jsonb_build_array(0,h/2,0));
    end if;
    lo := 1000; hi := -1000;
    for vertex in select value from jsonb_array_elements(vertices) loop
      projected := (vertex->>0)::double precision*nx+(vertex->>1)::double precision*ny+(vertex->>2)::double precision*nz-distance;
      lo := least(lo,projected); hi := greatest(hi,projected);
    end loop;
    if lo>=-0.00000001 or hi<=0.00000001 then return false; end if;
    ids := array_remove(ids,cut->>'entityId');
    foreach key in array array['positive','negative'] loop
      object_id := (cut->>'id') || ':' || key;
      if object_id=any(all_ids) then return false; end if;
      ids := array_append(ids,object_id); all_ids := array_append(all_ids,object_id);
    end loop;
    sources := array_append(sources,cut->>'entityId'); cut_ids := array_append(cut_ids,cut->>'id');
    for piece in select value from jsonb_array_elements(cut->'pieces') loop
      if not public.tool_space_keys(piece,array['position','rotation','color','opacity'],array['position','rotation','color','opacity'])
        or not public.tool_space_vector(piece->'position',30) or not public.tool_space_vector(piece->'rotation',6.283185307179586)
        or not public.tool_space_number(piece->'opacity',0,1)
        or not coalesce(piece->>'color' in ('#8fbf88','#df8a84','#edce79','#7da9ce','#b39dcc','#e7e0d0'),false) then return false; end if;
    end loop;
  end loop;
  if i->'selectedId'<>'null'::jsonb and (jsonb_typeof(i->'selectedId')<>'string' or not ((i->>'selectedId')=any(ids))) then return false; end if;
  if i->'feature'<>'null'::jsonb and (not public.tool_space_keys(i->'feature',array['entityId','kind','id'],array['entityId','kind','id'])
    or jsonb_typeof(i#>'{feature,entityId}')<>'string' or i#>'{feature,entityId}'<>i->'selectedId' or not coalesce(i#>>'{feature,kind}' in ('face','edge','vertex'),false)
    or jsonb_typeof(i#>'{feature,id}')<>'string' or char_length(i#>>'{feature,id}') not between 1 and 40) then return false; end if;
  return true;
exception when others then return false; end;
$$;
revoke all on function public.tool_solid_geometry_exploration_scene_is_valid(jsonb) from public,anon,authenticated,service_role;
