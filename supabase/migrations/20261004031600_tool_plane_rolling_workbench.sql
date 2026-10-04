begin;

-- 55-create/v2 独立圆对：轨道、自转与接触点由真实参数派生；旧 55/v1 保持原合同。
create function public.tool_plane_rolling_workbench_state_is_valid(s jsonb)
returns boolean language plpgsql immutable set search_path = pg_catalog,public as $$
declare
  p jsonb; q jsonb; f jsonb; center_point jsonb; entry_key text; id integer;
  ids integer[] := '{}'; param_keys text[] := array['nextId','active','rollBy','viewX','viewY','viewSpan'];
  point_keys text[] := '{}'; flag_keys text[] := array['grid','measures','names'];
begin
  if not public.tool_space_keys(s,array['sceneId','params','points','flags','marks','phase'],array['sceneId','params','points','flags','marks','phase'])
    or s->>'sceneId' is distinct from '55-create' or s->'phase' is distinct from '0'::jsonb
    or s->'marks' is distinct from '[]'::jsonb or jsonb_typeof(s->'params') is distinct from 'object'
    or jsonb_typeof(s->'points') is distinct from 'object' or jsonb_typeof(s->'flags') is distinct from 'object' then return false; end if;
  p:=s->'params'; q:=s->'points'; f:=s->'flags';
  if not public.tool_space_number(p->'nextId',0,99999,true) or not public.tool_space_number(p->'active',-1,99998,true)
    or not public.tool_space_number(p->'rollBy',-36000,36000) or not public.tool_space_number(p->'viewX',-1000,1000)
    or not public.tool_space_number(p->'viewY',-1000,1000) or not public.tool_space_number(p->'viewSpan',1,20000)
    or f->'grid' is distinct from 'false'::jsonb then return false; end if;
  for entry_key in select jsonb_object_keys(p) loop
    if entry_key !~ '^R\.(0|[1-9][0-9]{0,4})$' then continue; end if;
    id:=substring(entry_key from 3)::integer;
    if id>= (p->>'nextId')::numeric or id>99998 or cardinality(ids)>=4
      or not public.tool_space_number(p->entry_key,0.1,1000) or not public.tool_space_number(p->('r.'||id),0.1,1000)
      or not public.tool_space_number(p->('angle.'||id),-100000,100000) then return false; end if;
    if f->('inside.'||id)='true'::jsonb and (p->>('r.'||id))::numeric >= (p->>entry_key)::numeric then return false; end if;
    center_point:=q->('center.'||id);
    if not public.tool_space_keys(center_point,array['x','y'],array['x','y'])
      or not public.tool_space_number(center_point->'x',-1000,1000) or not public.tool_space_number(center_point->'y',-1000,1000) then return false; end if;
    ids:=array_append(ids,id); param_keys:=param_keys||array['R.'||id,'r.'||id,'angle.'||id];
    point_keys:=array_append(point_keys,'center.'||id); flag_keys:=flag_keys||array['inside.'||id,'orbit.'||id,'links.'||id,'trace.'||id];
  end loop;
  if cardinality(ids)=0 then
    if (p->>'active')::numeric<>-1 then return false; end if;
  elsif not (p->>'active')::numeric::integer=any(ids) then return false; end if;
  if not public.tool_space_keys(p,param_keys,param_keys) or not public.tool_space_keys(q,point_keys,point_keys)
    or not public.tool_space_keys(f,flag_keys,flag_keys) then return false; end if;
  return not exists(select 1 from jsonb_each(f) as flag where jsonb_typeof(flag.value) is distinct from 'boolean');
exception when others then return false; end;
$$;

create function public.tool_plane_rolling_workbench_scene_is_valid(s jsonb)
returns boolean language plpgsql immutable set search_path = pg_catalog,public as $$
declare title text; title_units integer;
begin
  if not public.tool_space_keys(s,array['toolId','contentVersion','payload'],array['toolId','contentVersion','payload'])
    or s->>'toolId' is distinct from 'plane-rolling' or s->>'contentVersion' is distinct from 'plane-rolling-lesson-v2'
    or not public.tool_space_keys(s->'payload',array['title','initial'],array['title','initial'])
    or jsonb_typeof(s#>'{payload,title}') is distinct from 'string' or octet_length(s::text)>150000 then return false; end if;
  -- 与 JavaScript trim 及 UTF-16 标题长度一致；保留中文空白和辅助平面字符的接受边界。
  title:=btrim(s#>>'{payload,title}',U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF');
  select char_length(title)+count(*) filter(where octet_length(codepoint)=4) into title_units from regexp_split_to_table(title,'') as chars(codepoint);
  return coalesce(title_units between 1 and 80 and public.tool_plane_rolling_workbench_state_is_valid(s#>'{payload,initial}'),false);
exception when others then return false; end;
$$;

revoke all on function public.tool_plane_rolling_workbench_state_is_valid(jsonb) from public,anon,authenticated,service_role;
revoke all on function public.tool_plane_rolling_workbench_scene_is_valid(jsonb) from public,anon,authenticated,service_role;

commit;
