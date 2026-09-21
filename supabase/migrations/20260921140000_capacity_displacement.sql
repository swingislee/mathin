-- 排水法作为容积比较 v2 的教学现场；仅新增私有校验，公共 Tools 注册由批次迁移统一接入。
begin;

create function public.tool_capacity_displacement_initial_is_valid(s jsonb)
returns boolean language plpgsql immutable set search_path = pg_catalog,public as $$
declare t jsonb := s->'tank'; b jsonb := s->'body'; key text;
  tw double precision; td double precision; th double precision; level double precision;
  bw double precision; bd double precision; bh double precision; bottom_value double precision; submerged double precision;
begin
  if not coalesce(public.tool_space_keys(s,array['tank','body','showAmounts','showDimensions','showInitialLevel','axes','grid','view'],array['tank','body','showAmounts','showDimensions','showInitialLevel','axes','grid','view'])
    and public.tool_space_keys(t,array['width','depth','height','waterHeight'],array['width','depth','height','waterHeight'])
    and public.tool_space_keys(b,array['kind','width','height','depth','bottom'],array['kind','width','height','depth','bottom'])
    and s->>'view' in ('angle','front','left','right','top','bottom') and b->>'kind' in ('cuboid','stepped'),false) then return false; end if;
  foreach key in array array['showAmounts','showDimensions','showInitialLevel','axes','grid'] loop
    if jsonb_typeof(s->key)<>'boolean' then return false; end if;
  end loop;
  foreach key in array array['width','height','depth'] loop
    if not public.tool_space_number(t->key,2,12) or not public.tool_space_number(b->key,0.25,5) then return false; end if;
  end loop;
  if not public.tool_space_number(t->'waterHeight',0.1,12) or not public.tool_space_number(b->'bottom',0,13) then return false; end if;
  tw := (t->>'width')::double precision; td := (t->>'depth')::double precision; th := (t->>'height')::double precision; level := (t->>'waterHeight')::double precision;
  bw := (b->>'width')::double precision; bd := (b->>'depth')::double precision; bh := (b->>'height')::double precision; bottom_value := (b->>'bottom')::double precision;
  if level>th or bw>tw-0.2 or bd>td-0.2 or bh>th or bottom_value>th+1 then return false; end if;
  -- 箱口处仍能容纳守恒水量，等价于水面解析解不高于箱口。台阶体两块互不重叠。
  submerged := case when b->>'kind'='cuboid' then bw*bd*greatest(0,least(bh,th-bottom_value))
    else bw*bd*greatest(0,least(bh/2,th-bottom_value)) + bw*bd/2*greatest(0,least(bh/2,th-bottom_value-bh/2)) end;
  return tw*td*th-submerged >= tw*td*level-tw*td*1e-8;
exception when others then return false; end;
$$;

create function public.tool_solid_capacity_teaching_scene_is_valid(s jsonb)
returns boolean language plpgsql immutable set search_path = pg_catalog,public as $$
declare i jsonb := s#>'{payload,initial}'; legacy jsonb;
begin
  if not coalesce(public.tool_space_keys(s,array['toolId','contentVersion','payload'],array['toolId','contentVersion','payload'])
    and s->>'toolId'='solid-capacity' and s->>'contentVersion'='solid-capacity-lesson-v2'
    and public.tool_space_keys(s->'payload',array['title','initial'],array['title','initial'])
    and public.tool_space_keys(i,array['mode','pour','displacement'],array['mode','pour','displacement'])
    and i->>'mode' in ('pour','displacement'),false) then return false; end if;
  legacy := jsonb_build_object('toolId','solid-capacity','contentVersion','solid-capacity-lesson-v1','payload',jsonb_build_object('title',s#>'{payload,title}','initial',i->'pour'));
  return public.tool_solid_capacity_scene_is_valid(legacy) is true and public.tool_capacity_displacement_initial_is_valid(i->'displacement') is true;
exception when others then return false; end;
$$;

revoke all on function public.tool_capacity_displacement_initial_is_valid(jsonb),public.tool_solid_capacity_teaching_scene_is_valid(jsonb) from public,anon,authenticated,service_role;
commit;
