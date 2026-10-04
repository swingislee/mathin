-- 圆片 v2 只保存真实扇形的顶点与刚性方向，排列和面积由这些状态派生。
begin;
create function public.tool_plane_circle_dissection_state_is_valid(s jsonb)
returns boolean language plpgsql immutable set search_path = pg_catalog,public as $$
declare p jsonb:=s->'params'; pts jsonb:=s->'points'; count_value integer; i integer; at jsonb;
  keys_p text[]:=array['count','radius','active']; keys_pt text[]:=array[]::text[];
begin
  if public.tool_space_keys(s,array['sceneId','params','points','flags','marks','phase'],array['sceneId','params','points','flags','marks','phase']) is not true
    or s->>'sceneId' is distinct from '27-sectors' or not public.tool_space_number(s->'phase',0,0) or s->'marks' is distinct from '[]'::jsonb
    or jsonb_typeof(p) is distinct from 'object' or jsonb_typeof(pts) is distinct from 'object'
    or not public.tool_space_number(p->'count',8,64,true) or not public.tool_space_number(p->'radius',.5,3)
    or public.tool_space_keys(s->'flags',array['grid','measures','original','snap','names'],array['grid','measures','original','snap','names']) is not true
    or exists(select 1 from jsonb_each(s->'flags') where jsonb_typeof(value)<>'boolean') then return false; end if;
  count_value:=(p->>'count')::numeric::integer;
  if not count_value=any(array[8,16,32,64]) or not public.tool_space_number(p->'active',-1,count_value-1,true) then return false; end if;
  for i in 0..count_value-1 loop
    keys_p:=array_append(keys_p,'turn.'||i); keys_pt:=array_append(keys_pt,'sector.'||i); at:=pts->('sector.'||i);
    if not public.tool_space_number(p->('turn.'||i),-36000,36000)
      or public.tool_space_keys(at,array['x','y'],array['x','y']) is not true
      or not public.tool_space_number(at->'x',-20,20) or not public.tool_space_number(at->'y',-12,12) then return false; end if;
  end loop;
  return public.tool_space_keys(p,keys_p,keys_p) and public.tool_space_keys(pts,keys_pt,keys_pt);
exception when others then return false; end;
$$;
create function public.tool_plane_circle_dissection_scene_is_valid(s jsonb)
returns boolean language plpgsql immutable set search_path = pg_catalog,public as $$
declare title text; title_units integer;
begin
  if not public.tool_space_keys(s,array['toolId','contentVersion','payload'],array['toolId','contentVersion','payload'])
    or not public.tool_space_keys(s->'payload',array['title','initial'],array['title','initial'])
    or jsonb_typeof(s#>'{payload,title}') is distinct from 'string' or octet_length(s::text)>150000 then return false; end if;
  title:=btrim(s#>>'{payload,title}',U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF');
  select char_length(title)+count(*) filter(where octet_length(codepoint)=4) into title_units from regexp_split_to_table(title,'') as chars(codepoint);
  return coalesce(title_units between 1 and 80 and s->>'toolId'='plane-circle-area' and s->>'contentVersion'='plane-circle-area-lesson-v2'
    and public.tool_plane_circle_dissection_state_is_valid(s#>'{payload,initial}'),false);
exception when others then return false; end;
$$;
revoke all on function public.tool_plane_circle_dissection_state_is_valid(jsonb) from public,anon,authenticated,service_role;
revoke all on function public.tool_plane_circle_dissection_scene_is_valid(jsonb) from public,anon,authenticated,service_role;
commit;
