-- 七个教具现场共用 Tools 存储和课堂入口；旧内容版本的函数保持原语义。
begin;

create function public.tool_space_keys(v jsonb, allowed text[], required text[])
returns boolean language sql immutable set search_path = pg_catalog as $$
  select coalesce(jsonb_typeof(v)='object' and v-allowed='{}'::jsonb and v ?& required,false);
$$;
create function public.tool_space_number(v jsonb, lo numeric, hi numeric, integral boolean default false)
returns boolean language plpgsql immutable set search_path = pg_catalog as $$
begin
  return coalesce(jsonb_typeof(v)='number' and (v::text)::numeric between lo and hi
    and (not integral or trunc((v::text)::numeric)=(v::text)::numeric),false);
exception when others then return false; end;
$$;
create function public.tool_space_vector(v jsonb, limit_value numeric)
returns boolean language sql immutable set search_path = pg_catalog,public as $$
  select public.tool_space_keys(v,array['x','y','z'],array['x','y','z'])
    and public.tool_space_number(v->'x',-limit_value,limit_value)
    and public.tool_space_number(v->'y',-limit_value,limit_value)
    and public.tool_space_number(v->'z',-limit_value,limit_value);
$$;
create function public.tool_space_anchor(v jsonb, limit_value numeric)
returns boolean language plpgsql immutable set search_path = pg_catalog,public as $$
begin
  if v='null'::jsonb then return true; end if;
  if not public.tool_space_keys(v,array['faceId','vertices'],array['faceId','vertices'])
    or jsonb_typeof(v->'faceId')<>'string' or char_length(v->>'faceId') not between 1 and 80
    or jsonb_typeof(v->'vertices')<>'array' or jsonb_array_length(v->'vertices')<>3 then return false; end if;
  return not exists(select 1 from jsonb_array_elements(v->'vertices') p where not public.tool_space_vector(p,limit_value));
exception when others then return false; end;
$$;

create function public.tool_cube_rotation_scene_is_valid(s jsonb)
returns boolean language plpgsql immutable set search_path = pg_catalog,public as $$
declare h jsonb := s#>'{payload,history}'; op jsonb; old_operations jsonb := '[]';
begin
  if not coalesce(s->>'contentVersion'='cube-structures-lesson-v3' and h->>'version' in ('cube-structures-draft-v3','cube-structures-draft-v4')
    and jsonb_typeof(h->'operations')='array' and jsonb_array_length(h->'operations')<=256,false) then return false; end if;
  for op in select value from jsonb_array_elements(h->'operations') loop
    if op->>'kind'='rotate' then
      if h->>'version'<>'cube-structures-draft-v4'
        or not public.tool_space_keys(op,array['kind','ids','axis','turn','pivot','displayPivot'],array['kind','ids','axis','turn','pivot','displayPivot'])
        or op->>'axis' not in ('x','y','z') or op->'turn' not in ('-1'::jsonb,'1'::jsonb)
        or jsonb_typeof(op->'ids')<>'array' or jsonb_array_length(op->'ids') not between 1 and 512
        or exists(select 1 from jsonb_array_elements(op->'ids') id where jsonb_typeof(id)<>'string')
        or not public.tool_space_vector(op->'pivot',1000) or not public.tool_space_vector(op->'displayPivot',2000)
      then return false; end if;
    else old_operations := old_operations || jsonb_build_array(op); end if;
  end loop;
  -- 共用旧结构硬门；旋转动作在上方独立校验，不扩大旧 v1/v2 的操作集合。
  return public.cw_cube_structures_tool_is_valid(jsonb_set(jsonb_set(jsonb_set(s,'{contentVersion}','"cube-structures-lesson-v2"'),
    '{payload,history,version}','"cube-structures-draft-v3"'),'{payload,history,operations}',old_operations));
exception when others then return false; end;
$$;

create function public.tool_net_teaching_scene_is_valid(s jsonb)
returns boolean language plpgsql immutable set search_path = pg_catalog,public as $$
declare i jsonb := s#>'{payload,initial}'; d jsonb := i->'data'; square jsonb; part jsonb; angles jsonb := d->'angles';
  colors text[] := array['#8fbf88','#df8a84','#edce79','#7da9ce','#b39dcc','#e7e0d0'];
begin
  if not public.tool_space_keys(s,array['toolId','contentVersion','payload'],array['toolId','contentVersion','payload'])
    or s->>'toolId'<>'spatial-lab' or s->>'contentVersion'<>'cube-net-lesson-v2'
    or not public.tool_space_keys(s->'payload',array['title','initial'],array['title','initial'])
    or jsonb_typeof(s#>'{payload,title}')<>'string' or char_length(btrim(s#>>'{payload,title}')) not between 1 and 80
    or not public.tool_space_keys(i,array['mode','data'],array['mode','data']) then return false; end if;
  if i->>'mode'='standard' then
    return public.cw_spatial_teaching_tool_is_valid(jsonb_build_object('toolId','spatial-lab','contentVersion','cube-net-lesson-v1',
      'payload',jsonb_build_object('title',s#>'{payload,title}','initial',d)));
  end if;
  if jsonb_typeof(angles)<>'object' or (select count(*) from jsonb_object_keys(angles))>11
    or d->>'view' not in ('angle','front','left','right','top') or jsonb_typeof(d->'labelsVisible')<>'boolean' then return false; end if;
  if i->>'mode'='free-paper' then
    if not public.tool_space_keys(d,array['version','squares','angles','anchor','view','labelsVisible'],array['version','squares','angles','anchor','view','labelsVisible'])
      or d->>'version'<>'paper-folding-v1' or jsonb_typeof(d->'squares')<>'array'
      or jsonb_array_length(d->'squares') not between 1 and 12 or not public.tool_space_anchor(d->'anchor',32) then return false; end if;
    for square in select value from jsonb_array_elements(d->'squares') loop
      if not public.tool_space_keys(square,array['id','x','z','color','label'],array['id','x','z','color','label'])
        or not public.tool_space_number(square->'x',-8,8,true) or not public.tool_space_number(square->'z',-8,8,true)
        or square->>'id'<>concat('s_',square->>'x','_',square->>'z') or not (square->>'color'=any(colors))
        or jsonb_typeof(square->'label')<>'string' or char_length(square->>'label')>8 then return false; end if;
    end loop;
    return not exists(select 1 from jsonb_each(angles) a where not public.tool_space_number(a.value,-90,90,true));
  elsif i->>'mode'='solid-net' then
    if not public.tool_space_keys(d,array['version','kind','dimensions','angles','surfaces','anchor','view','labelsVisible'],array['version','kind','dimensions','angles','surfaces','anchor','view','labelsVisible'])
      or d->>'version'<>'solid-nets-v1' or d->>'kind' not in ('cuboid','triangular-prism')
      or not public.tool_space_keys(d->'dimensions',array['width','height','depth'],array['width','height','depth'])
      or exists(select 1 from jsonb_each(d->'dimensions') e where not public.tool_space_number(e.value,0.25,8))
      or jsonb_typeof(d->'surfaces')<>'object' or (select count(*) from jsonb_object_keys(d->'surfaces')) not between 5 and 6
      or not public.tool_space_anchor(d->'anchor',100) then return false; end if;
    for part in select value from jsonb_each(d->'surfaces') loop
      if not public.tool_space_keys(part,array['color','label','opacity'],array['color','label','opacity'])
        or not (part->>'color'=any(colors)) or jsonb_typeof(part->'label')<>'string' or char_length(part->>'label')>8
        or not public.tool_space_number(part->'opacity',0,1) then return false; end if;
    end loop;
    return not exists(select 1 from jsonb_each(angles) a where not public.tool_space_number(a.value,-180,180));
  end if;
  return false;
exception when others then return false; end;
$$;

create function public.tool_solid_geometry_scene_is_valid(s jsonb)
returns boolean language plpgsql immutable set search_path = pg_catalog,public as $$
declare i jsonb := s#>'{payload,initial}'; e jsonb; d jsonb; setting jsonb; key text;
begin
  if not public.tool_space_keys(s,array['toolId','contentVersion','payload'],array['toolId','contentVersion','payload'])
    or s->>'toolId'<>'solid-geometry' or s->>'contentVersion'<>'solid-geometry-lesson-v1'
    or not public.tool_space_keys(s->'payload',array['title','initial'],array['title','initial'])
    or jsonb_typeof(s#>'{payload,title}')<>'string' or char_length(btrim(s#>>'{payload,title}')) not between 1 and 80
    or not public.tool_space_keys(i,array['entities','selectedId','feature','axes','grid','view','section','measurement'],array['entities','selectedId','feature','axes','grid','view'])
    or jsonb_typeof(i->'entities')<>'array' or jsonb_array_length(i->'entities')>16
    or jsonb_typeof(i->'axes')<>'boolean' or jsonb_typeof(i->'grid')<>'boolean'
    or i->>'view' not in ('angle','front','left','right','top','bottom') then return false; end if;
  for e in select value from jsonb_array_elements(i->'entities') loop
    d := e->'dimensions';
    if not public.tool_space_keys(e,array['id','kind','dimensions','position','rotation','color','opacity'],array['id','kind','dimensions','position','rotation','color','opacity'])
      or jsonb_typeof(e->'id')<>'string' or char_length(e->>'id') not between 1 and 80
      or e->>'kind' not in ('cube','cuboid','triangular-prism','square-pyramid','cylinder','cone','sphere')
      or not public.tool_space_keys(d,array['width','height','depth','radius'],array['width','height','depth','radius'])
      or exists(select 1 from jsonb_each(d) n where not public.tool_space_number(n.value,0.2,12))
      or not public.tool_space_vector(e->'position',30) or not public.tool_space_vector(e->'rotation',6.283186)
      or not public.tool_space_number(e->'opacity',0,1)
      or e->>'color' not in ('#8fbf88','#df8a84','#edce79','#7da9ce','#b39dcc','#e7e0d0')
      or (e->>'kind'='cube' and (d->'width'<>d->'height' or d->'width'<>d->'depth'))
      or (e->>'kind'='square-pyramid' and d->'width'<>d->'depth') then return false; end if;
  end loop;
  if (select count(*)<>count(distinct item.value->>'id') from jsonb_array_elements(i->'entities') item)
    or (i->'selectedId'<>'null'::jsonb and not exists(select 1 from jsonb_array_elements(i->'entities') item where item.value->'id'=i->'selectedId')) then return false; end if;
  if i->'feature'<>'null'::jsonb and (not public.tool_space_keys(i->'feature',array['entityId','kind','id'],array['entityId','kind','id'])
    or i#>'{feature,entityId}'<>i->'selectedId' or i#>>'{feature,kind}' not in ('face','edge','vertex')
    or jsonb_typeof(i#>'{feature,id}')<>'string') then return false; end if;
  -- 领域设置保留严格对象和有界数字；具体交线/量纲关系由共享服务端 schema 验证。
  if i ? 'section' then
    setting := i->'section';
    if not public.tool_space_keys(setting,array['enabled','axis','offset','tiltA','tiltB','removedSide','showPlane'],array['enabled','axis','offset','tiltA','tiltB','removedSide','showPlane'])
      or jsonb_typeof(setting->'enabled')<>'boolean' or jsonb_typeof(setting->'showPlane')<>'boolean'
      or setting->>'axis' not in ('x','y','z') or setting->>'removedSide' not in ('none','positive','negative')
      or not public.tool_space_number(setting->'offset',-1.2,1.2)
      or not public.tool_space_number(setting->'tiltA',-90,90) or not public.tool_space_number(setting->'tiltB',-90,90) then return false; end if;
  end if;
  if i ? 'measurement' then
    setting := i->'measurement';
    if not public.tool_space_keys(setting,array['enabled','dimensions','faceArea','totals','unitGrid','unitFill','fillLayers','unit'],array['enabled','dimensions','faceArea','totals','unitGrid','unitFill','fillLayers','unit'])
      or setting->>'unit'<>'unit' or not public.tool_space_number(setting->'fillLayers',0,6,true) then return false; end if;
    foreach key in array array['enabled','dimensions','faceArea','totals','unitGrid','unitFill'] loop
      if jsonb_typeof(setting->key)<>'boolean' then return false; end if;
    end loop;
  end if;
  return true;
exception when others then return false; end;
$$;

create function public.tool_solid_capacity_scene_is_valid(s jsonb)
returns boolean language plpgsql immutable set search_path = pg_catalog,public as $$
declare i jsonb := s#>'{payload,initial}'; vessel jsonb; key text;
begin
  if not public.tool_space_keys(s,array['toolId','contentVersion','payload'],array['toolId','contentVersion','payload'])
    or s->>'toolId'<>'solid-capacity' or s->>'contentVersion'<>'solid-capacity-lesson-v1'
    or not public.tool_space_keys(s->'payload',array['title','initial'],array['title','initial'])
    or jsonb_typeof(s#>'{payload,title}')<>'string' or char_length(btrim(s#>>'{payload,title}')) not between 1 and 80
    or not public.tool_space_keys(i,array['cone','cylinder','coneOrientation','linkedDimensions','showAmounts','showDimensions','axes','grid','view'],array['cone','cylinder','coneOrientation','linkedDimensions','showAmounts','showDimensions','axes','grid','view'])
    or i->>'coneOrientation' not in ('tip-down','tip-up') or i->>'view' not in ('angle','front','left','right','top','bottom') then return false; end if;
  foreach key in array array['linkedDimensions','showAmounts','showDimensions','axes','grid'] loop
    if jsonb_typeof(i->key)<>'boolean' then return false; end if;
  end loop;
  foreach vessel in array array[i->'cone',i->'cylinder'] loop
    if not public.tool_space_keys(vessel,array['radius','height','fill'],array['radius','height','fill'])
      or not public.tool_space_number(vessel->'radius',0.25,6) or not public.tool_space_number(vessel->'height',0.25,6)
      or not public.tool_space_number(vessel->'fill',0,1) then return false; end if;
  end loop;
  return not (i->'linkedDimensions'='true'::jsonb and (i#>'{cone,radius}'<>i#>'{cylinder,radius}' or i#>'{cone,height}'<>i#>'{cylinder,height}'));
exception when others then return false; end;
$$;

create or replace function public.tool_scene_is_valid(p_scene jsonb)
returns boolean language sql immutable set search_path = pg_catalog, public as $$
  select coalesce(
    (p_scene->>'contentVersion'='cube-structures-lesson-v2' and public.cw_cube_structures_tool_is_valid(p_scene))
    or public.cw_spatial_teaching_tool_is_valid(p_scene) or public.tool_numeric_scene_is_valid(p_scene)
    or public.tool_projection_scene_is_valid(p_scene) or public.tool_cube_rotation_scene_is_valid(p_scene)
    or public.tool_net_teaching_scene_is_valid(p_scene) or public.tool_solid_geometry_scene_is_valid(p_scene)
    or public.tool_solid_capacity_scene_is_valid(p_scene),false)
    and octet_length(p_scene::text)<=750000;
$$;
create or replace function public.tool_scene_catalog_id(p_scene jsonb)
returns text language sql immutable set search_path = pg_catalog, public as $$
  select case p_scene->>'contentVersion'
    when 'cube-structures-lesson-v2' then 'cube-structures' when 'cube-structures-lesson-v3' then 'cube-structures'
    when 'cube-net-lesson-v1' then 'cube-net' when 'cube-net-lesson-v2' then 'cube-net' when 'dice-lesson-v1' then 'dice'
    when 'fraction-line-lesson-v1' then 'fraction-line' when 'motion-lab-lesson-v1' then 'motion-lab'
    when 'projection-lesson-v1' then 'projection' when 'solid-geometry-lesson-v1' then 'solid-geometry'
    when 'solid-capacity-lesson-v1' then 'solid-capacity' else null end;
$$;
alter table public.tool_scene_drafts drop constraint tool_scene_drafts_catalog_id_check;
alter table public.tool_scene_drafts add constraint tool_scene_drafts_catalog_id_check
  check (catalog_id in ('cube-structures','cube-net','dice','fraction-line','motion-lab','projection','solid-geometry','solid-capacity'));
revoke all on function public.tool_space_keys(jsonb,text[],text[]),public.tool_space_number(jsonb,numeric,numeric,boolean),
  public.tool_space_vector(jsonb,numeric),public.tool_space_anchor(jsonb,numeric),public.tool_cube_rotation_scene_is_valid(jsonb),
  public.tool_net_teaching_scene_is_valid(jsonb),public.tool_solid_geometry_scene_is_valid(jsonb),public.tool_solid_capacity_scene_is_valid(jsonb) from public,anon,authenticated,service_role;
notify pgrst, 'reload schema';
commit;
