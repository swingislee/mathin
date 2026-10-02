-- 开放棋盘与等长火柴棒：只追加 v2 校验，保留 v1、冻结副本、权限和业务数据。
begin;

create function public.tool_plane_match_state_is_valid(s jsonb)
returns boolean language plpgsql immutable set search_path = pg_catalog,public as $$
declare
  p jsonb:=s->'params'; q jsonb:=s->'points'; f jsonb:=s->'flags';
  flags_ text[]:=array['grid','measures','snap','reference','labels'];
  parameter_keys text[]:=array['nextId','active','turn']; point_keys text[]:=array[]::text[];
  ids integer[]; live_ids integer[]:=array[]::integer[]; id integer; next_id integer; active_id integer; prefix text; point_key text;
begin
  if not public.tool_space_keys(s,array['sceneId','params','points','flags','marks','phase'],array['sceneId','params','points','flags','marks','phase'])
    or s->>'sceneId' is distinct from '51-create' or jsonb_typeof(p) is distinct from 'object' or jsonb_typeof(q) is distinct from 'object'
    or not public.tool_space_number(s->'phase',0,0) or jsonb_typeof(s->'marks') is distinct from 'array' or jsonb_array_length(s->'marks')<>0
    or not public.tool_space_keys(f,flags_,flags_) or exists(select 1 from jsonb_each(f) where jsonb_typeof(value)<>'boolean')
    or not public.tool_space_number(p->'nextId',0,99999,true) or not public.tool_space_number(p->'active',-1,99998,true)
    or not public.tool_space_number(p->'turn',-360,360) then return false; end if;
  next_id:=(p->>'nextId')::numeric::integer; active_id:=(p->>'active')::numeric::integer;
  foreach prefix in array array['angle','referenceAngle'] loop
    select coalesce(array_agg(split_part(key,'.',2)::integer),array[]::integer[]) into ids
      from jsonb_object_keys(p) as t(key) where key~('^'||prefix||'\.(0|[1-9][0-9]{0,4})$');
    if cardinality(ids)>96 then return false; end if;
    if prefix='angle' then live_ids:=ids; end if;
    foreach id in array ids loop
      point_key:=(case when prefix='angle' then 'stick.' else 'reference.' end)||id;
      if id>=next_id or id>99998 or not public.tool_space_number(p->(prefix||'.'||id),-36000,36000)
        or not public.tool_planar_point(q->point_key,40,920,40,680) then return false; end if;
      parameter_keys:=array_append(parameter_keys,prefix||'.'||id); point_keys:=array_append(point_keys,point_key);
    end loop;
  end loop;
  return (active_id=-1 or active_id=any(live_ids)) and public.tool_space_keys(p,parameter_keys,parameter_keys) and public.tool_space_keys(q,point_keys,point_keys);
exception when others then return false; end;
$$;

create function public.tool_plane_cover_state_is_valid(s jsonb)
returns boolean language plpgsql immutable set search_path = pg_catalog,public as $$
declare
  p jsonb:=s->'params'; q jsonb:=s->'points'; f jsonb:=s->'flags'; marks_ jsonb:=s->'marks';
  flags_ text[]:=array['grid','measures','coloring','editCells','labels'];
  parameter_keys text[]:=array['columns','rows','nextId','active']; point_keys text[]:=array[]::text[]; occupied text[]:=array[]::text[];
  ids integer[]; id integer; next_id integer; active_id integer; cols integer; rows_ integer; angle_ integer;
  x integer; y integer; bx integer; by_ integer; i integer; mark_ jsonb; mark_text text; key_ text; at_ jsonb;
begin
  if not public.tool_space_keys(s,array['sceneId','params','points','flags','marks','phase'],array['sceneId','params','points','flags','marks','phase'])
    or s->>'sceneId' is distinct from '57-create' or jsonb_typeof(p) is distinct from 'object' or jsonb_typeof(q) is distinct from 'object'
    or not public.tool_space_number(s->'phase',0,0) or jsonb_typeof(marks_) is distinct from 'array'
    or not public.tool_space_keys(f,flags_,flags_) or exists(select 1 from jsonb_each(f) where jsonb_typeof(value)<>'boolean') or f->'grid' is distinct from 'false'::jsonb
    or not public.tool_space_number(p->'nextId',0,99999,true) or not public.tool_space_number(p->'active',-1,99998,true)
    or not public.tool_space_number(p->'columns',1,12,true) or not public.tool_space_number(p->'rows',1,12,true) then return false; end if;
  next_id:=(p->>'nextId')::numeric::integer; active_id:=(p->>'active')::numeric::integer;
  cols:=(p->>'columns')::numeric::integer; rows_:=(p->>'rows')::numeric::integer;
  if jsonb_array_length(marks_)>cols*rows_ or (select count(*)<>count(distinct value) from jsonb_array_elements(marks_)) then return false; end if;
  for mark_ in select value from jsonb_array_elements(marks_) loop
    mark_text:=mark_#>>'{}';
    if jsonb_typeof(mark_) is distinct from 'string' or mark_text!~'^missing\.(0|[1-9][0-9]?)_(0|[1-9][0-9]?)$' then return false; end if;
    x:=split_part(substring(mark_text from 9),'_',1)::integer; y:=split_part(substring(mark_text from 9),'_',2)::integer;
    if x>=cols or y>=rows_ then return false; end if;
  end loop;
  select coalesce(array_agg(substring(key from 7)::integer),array[]::integer[]) into ids
    from jsonb_object_keys(p) as t(key) where key~'^angle\.(0|[1-9][0-9]{0,4})$';
  if cardinality(ids)>72 or (active_id<>-1 and not active_id=any(ids)) then return false; end if;
  foreach id in array ids loop
    if id>=next_id or id>99998 or not public.tool_space_number(p->('angle.'||id),0,90,true) then return false; end if;
    angle_:=(p->>('angle.'||id))::numeric::integer; at_:=q->('piece.'||id);
    if angle_ not in (0,90) or not public.tool_planar_point(at_,0,16,0,11,true) or q->('home.'||id) is distinct from at_ then return false; end if;
    parameter_keys:=array_append(parameter_keys,'angle.'||id); point_keys:=point_keys||array['piece.'||id,'home.'||id];
    x:=(at_->>'x')::numeric::integer; y:=(at_->>'y')::numeric::integer;
    if x between cols+1 and cols+4 and y between 0 and greatest(3,rows_-2) then continue; end if;
    bx:=x+case when angle_=0 then 1 else 0 end; by_:=y+case when angle_=90 then 1 else 0 end;
    if x>=cols or bx>=cols or y>=rows_ or by_>=rows_ then return false; end if;
    for i in 0..1 loop
      key_:='missing.'||(case when i=0 then x else bx end)||'_'||(case when i=0 then y else by_ end);
      if marks_ ? key_ or key_=any(occupied) then return false; end if;
      occupied:=array_append(occupied,key_);
    end loop;
  end loop;
  return public.tool_space_keys(p,parameter_keys,parameter_keys) and public.tool_space_keys(q,point_keys,point_keys);
exception when others then return false; end;
$$;

create function public.tool_plane_cover_match_scene_is_valid(s jsonb)
returns boolean language plpgsql immutable set search_path = pg_catalog,public as $$
begin
  return coalesce(public.tool_space_keys(s,array['toolId','contentVersion','payload'],array['toolId','contentVersion','payload'])
    and public.tool_space_keys(s->'payload',array['title','initial'],array['title','initial'])
    and jsonb_typeof(s#>'{payload,title}')='string' and char_length(btrim(s#>>'{payload,title}')) between 1 and 80 and octet_length(s::text)<=150000
    and ((s->>'toolId'='plane-matchsticks' and s->>'contentVersion'='plane-matchsticks-lesson-v2' and public.tool_plane_match_state_is_valid(s#>'{payload,initial}'))
      or (s->>'toolId'='plane-covering' and s->>'contentVersion'='plane-covering-lesson-v2' and public.tool_plane_cover_state_is_valid(s#>'{payload,initial}'))),false);
exception when others then return false; end;
$$;

revoke all on function public.tool_plane_match_state_is_valid(jsonb) from public,anon,authenticated,service_role;
revoke all on function public.tool_plane_cover_state_is_valid(jsonb) from public,anon,authenticated,service_role;
revoke all on function public.tool_plane_cover_match_scene_is_valid(jsonb) from public,anon,authenticated,service_role;

-- 精确追加分发，保留其它工具（包括随后独立追加的版本）和既有 ACL。
do $$ declare source text; needle text; begin
  source:=pg_get_functiondef('public.tool_scene_is_valid(jsonb)'::regprocedure);
  needle:='or public.tool_plane_overlap_scene_is_valid(p_scene)';
  if strpos(source,needle)=0 or strpos(source,'public.tool_plane_cover_match_scene_is_valid(p_scene)')>0 then raise exception 'PLANE_COVER_MATCH_DISPATCH_PRECONDITION'; end if;
  execute replace(source,needle,needle||' or public.tool_plane_cover_match_scene_is_valid(p_scene)');
  source:=pg_get_functiondef('public.tool_scene_catalog_id(jsonb)'::regprocedure);
  needle:='when ''plane-overlap-lesson-v2'' then ''plane-overlap''';
  if strpos(source,needle)=0 or strpos(source,'''plane-covering-lesson-v2''')>0 then raise exception 'PLANE_COVER_MATCH_CATALOG_PRECONDITION'; end if;
  execute replace(source,needle,needle||' when ''plane-covering-lesson-v2'' then ''plane-covering'' when ''plane-matchsticks-lesson-v2'' then ''plane-matchsticks''');
end $$;
notify pgrst, 'reload schema';
commit;
