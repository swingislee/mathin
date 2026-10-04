-- 双折来源层与稳定剪口合同；总分发、版本目录由集成迁移接入。
begin;

-- 剪口可以越过纸边或舞台边；平移到局部坐标后复用简单多边形合同。
create function public.tool_plane_paper_layers_polygon_is_valid(poly jsonb)
returns boolean language plpgsql immutable set search_path = pg_catalog,public as $$
declare n integer; i integer; p jsonb; cx double precision; cy double precision;
  min_x double precision; max_x double precision; min_y double precision; max_y double precision;
  q jsonb:='{"pivot":{"x":0,"y":0},"axis":{"x":0,"y":0},"center.0":{"x":480,"y":360}}'; s jsonb;
begin
  if jsonb_typeof(poly) is distinct from 'array' then return false; end if;
  n:=jsonb_array_length(poly); if n<3 or n>32 then return false; end if;
  for p in select value from jsonb_array_elements(poly) loop
    if not public.tool_planar_point(p,-5000,5000,-5000,5000) then return false; end if;
  end loop;
  select min((value->>'x')::double precision),max((value->>'x')::double precision),min((value->>'y')::double precision),max((value->>'y')::double precision)
    into min_x,max_x,min_y,max_y from jsonb_array_elements(poly);
  if max_x-min_x>1600 or max_y-min_y>1600 then return false; end if;
  cx:=(min_x+max_x)/2; cy:=(min_y+max_y)/2;
  for i in 0..n-1 loop
    p:=poly->i; q:=q||jsonb_build_object('vertex.0.'||i,jsonb_build_object('x',(p->>'x')::double precision-cx,'y',(p->>'y')::double precision-cy));
  end loop;
  s:=jsonb_build_object('sceneId','01-create','phase',0,'marks','[]'::jsonb,'points',q,
    'params',jsonb_build_object('nextId',1,'active',0,'dx',0,'dy',0,'turn',0,'axisAngle',90,
      'kind.0',0,'count.0',n,'angle.0',0,'rx.0',0,'ry.0',0,'life.0',0,'detail.0',0,'flip.0',1),
    'flags','{"grid":false,"measures":false,"edges":false,"vertices":false,"names":false,"counts":false,"ghost":false,"edit":false,"snap":false}'::jsonb);
  return public.tool_plane_construction_state_is_valid(s);
exception when others then return false; end;
$$;

-- 输入为上一折实际区域；每个凸区域裁分后反射，面积保留重叠层的重数。
create function public.tool_plane_paper_layers_fold(regions jsonb,a jsonb,b jsonb,side_ integer)
returns jsonb language plpgsql immutable set search_path = pg_catalog,public as $$
declare region_ jsonb; clipped jsonb; reflected jsonb; p jsonb; moving integer; d double precision; area_ double precision;
  fixed_area double precision:=0; moving_area double precision:=0; result jsonb:='[]';
  length_ double precision:=sqrt(power((b->>'x')::double precision-(a->>'x')::double precision,2)+power((b->>'y')::double precision-(a->>'y')::double precision,2));
  nx double precision:=((b->>'y')::double precision-(a->>'y')::double precision)/length_;
  ny double precision:=-((b->>'x')::double precision-(a->>'x')::double precision)/length_;
begin
  for region_ in select value from jsonb_array_elements(regions) loop
    for moving in 0..1 loop
      clipped:=public.tool_paper_clip(region_,a,b,side_*case when moving=1 then 1 else -1 end);
      area_:=abs(public.tool_paper_signed_area(clipped));
      if jsonb_array_length(clipped)<3 or area_<=1e-7 then continue; end if;
      if moving=1 then
        moving_area:=moving_area+area_; reflected:='[]';
        for p in select value from jsonb_array_elements(clipped) loop
          d:=public.tool_paper_crease_distance(p,a,b);
          reflected:=reflected||jsonb_build_array(jsonb_build_object('x',(p->>'x')::double precision-2*d*nx,'y',(p->>'y')::double precision-2*d*ny));
        end loop;
        clipped:=reflected;
      else fixed_area:=fixed_area+area_; end if;
      result:=result||jsonb_build_array(clipped);
    end loop;
  end loop;
  return jsonb_build_object('regions',result,'fixedArea',fixed_area,'movingArea',moving_area);
end;
$$;

create function public.tool_plane_paper_layers_state_is_valid(s jsonb)
returns boolean language plpgsql immutable set search_path = pg_catalog,public as $$
declare p jsonb:=s->'params'; q jsonb:=s->'points'; f jsonb:=s->'flags'; paper jsonb:='[]'; a jsonb; b jsonb; stage_ jsonb;
  pkeys text[]:=array['paperCount','foldCount','activeFold','nextCutId','activeCut','activeVertex']; qkeys text[]:=array[]::text[];
  fkeys text[]:=array['grid','measures','crease','edit','editCut'];
  paper_count integer; fold_count integer; active_fold integer; next_id integer; active_cut integer; active_vertex integer;
  ids integer[]; cut_id integer; depth_ integer; i integer; j integer; kind integer; n integer; total_points integer:=0;
  radius double precision; poly jsonb; regions jsonb; depth_regions jsonb; cuts jsonb:='[]'; cut jsonb;
begin
  if not public.tool_space_keys(s,array['sceneId','params','points','flags','marks','phase'],array['sceneId','params','points','flags','marks','phase'])
    or s->>'sceneId' is distinct from '32-layers' or not public.tool_space_number(s->'phase',0,0)
    or jsonb_typeof(p) is distinct from 'object' or jsonb_typeof(q) is distinct from 'object'
    or not public.tool_space_number(p->'paperCount',3,32,true) or not public.tool_space_number(p->'foldCount',0,2,true)
    or not public.tool_space_number(p->'nextCutId',1,99999,true) or not public.tool_space_number(p->'activeCut',-1,99998,true)
    or not public.tool_space_number(p->'activeVertex',0,31,true) or s->'marks' is distinct from '[]'::jsonb
    or not public.tool_space_keys(f,fkeys,fkeys) or exists(select 1 from jsonb_each(f) where jsonb_typeof(value)<>'boolean') then return false; end if;
  if (select count(*) from jsonb_object_keys(p))>256 or (select count(*) from jsonb_object_keys(q))>256 then return false; end if;
  paper_count:=(p->>'paperCount')::numeric::integer; fold_count:=(p->>'foldCount')::numeric::integer;
  next_id:=(p->>'nextCutId')::numeric::integer; active_cut:=(p->>'activeCut')::numeric::integer; active_vertex:=(p->>'activeVertex')::numeric::integer;
  if not public.tool_space_number(p->'activeFold',case when fold_count=0 then -1 else 0 end,fold_count-1,true) or (active_cut=-1 and active_vertex<>0) then return false; end if;
  active_fold:=(p->>'activeFold')::numeric::integer;
  for i in 0..paper_count-1 loop qkeys:=array_append(qkeys,'paper.'||i); paper:=paper||jsonb_build_array(q->('paper.'||i)); end loop;
  if not public.tool_paper_polygon_is_valid(paper) then return false; end if;
  regions:=public.tool_paper_triangles(paper); depth_regions:=jsonb_build_array(regions);
  if fold_count>0 then for i in 0..fold_count-1 loop
    pkeys:=pkeys||array['foldAngle.'||i,'foldSide.'||i]; qkeys:=qkeys||array['foldA.'||i,'foldB.'||i];
    if not public.tool_space_number(p->('foldAngle.'||i),0,180) or not public.tool_space_number(p->('foldSide.'||i),-1,1,true)
      or (p->>('foldSide.'||i))::numeric not in (-1,1) then return false; end if;
    if i>0 and (p->>('foldAngle.'||i))::numeric>0 and (p->>('foldAngle.'||(i-1)))::numeric<>180 then return false; end if;
    a:=q->('foldA.'||i); b:=q->('foldB.'||i);
    if not public.tool_planar_point(a,-5000,5000,-5000,5000) or not public.tool_planar_point(b,-5000,5000,-5000,5000)
      or sqrt(power((b->>'x')::double precision-(a->>'x')::double precision,2)+power((b->>'y')::double precision-(a->>'y')::double precision,2))<12 then return false; end if;
    stage_:=public.tool_plane_paper_layers_fold(regions,a,b,(p->>('foldSide.'||i))::numeric::integer);
    if (stage_->>'fixedArea')::double precision<=1 or (stage_->>'movingArea')::double precision<=1 then return false; end if;
    regions:=stage_->'regions'; depth_regions:=depth_regions||jsonb_build_array(regions);
  end loop; end if;
  select coalesce(array_agg(substring(key from 9)::integer order by substring(key from 9)::integer),array[]::integer[]) into ids
    from jsonb_object_keys(p) as entries(key) where key~'^cutKind\.(0|[1-9][0-9]{0,4})$';
  if cardinality(ids)>12 or (active_cut<>-1 and not active_cut=any(ids)) then return false; end if;
  foreach cut_id in array ids loop
    if cut_id>=next_id then return false; end if;
    pkeys:=pkeys||array['cutKind.'||cut_id,'cutVertices.'||cut_id,'cutRadius.'||cut_id,'cutDepth.'||cut_id];
    if not public.tool_space_number(p->('cutKind.'||cut_id),0,1,true) or not public.tool_space_number(p->('cutVertices.'||cut_id),1,32,true)
      or not public.tool_space_number(p->('cutRadius.'||cut_id),0,350) or not public.tool_space_number(p->('cutDepth.'||cut_id),1,fold_count,true) then return false; end if;
    kind:=(p->>('cutKind.'||cut_id))::numeric::integer; n:=(p->>('cutVertices.'||cut_id))::numeric::integer;
    radius:=(p->>('cutRadius.'||cut_id))::double precision; depth_:=(p->>('cutDepth.'||cut_id))::numeric::integer;
    if (kind=0 and (n<>1 or radius<3)) or (kind=1 and (n<3 or radius<>0)) or (cut_id=active_cut and active_vertex>=n) then return false; end if;
    total_points:=total_points+n; if total_points>192 then return false; end if;
    poly:='[]';
    for j in 0..n-1 loop
      qkeys:=array_append(qkeys,'cut.'||cut_id||'.'||j);
      if not public.tool_planar_point(q->('cut.'||cut_id||'.'||j),-5000,5000,-5000,5000) then return false; end if;
      poly:=poly||jsonb_build_array(q->('cut.'||cut_id||'.'||j));
    end loop;
    if (kind=1 and not public.tool_plane_paper_layers_polygon_is_valid(poly)) or not public.tool_paper_cut_intersects(depth_regions->depth_,kind,poly,radius) then return false; end if;
    cut:=jsonb_build_object('kind',kind,'radius',radius,'depth',depth_,'points',poly);
    if exists(select 1 from jsonb_array_elements(cuts) where value=cut) then return false; end if;
    cuts:=cuts||jsonb_build_array(cut);
  end loop;
  return public.tool_space_keys(p,pkeys,pkeys) and public.tool_space_keys(q,qkeys,qkeys);
exception when others then return false; end;
$$;

create function public.tool_plane_paper_layers_scene_is_valid(s jsonb)
returns boolean language plpgsql immutable set search_path = pg_catalog,public as $$
declare title text; title_units integer;
begin
  if not public.tool_space_keys(s,array['toolId','contentVersion','payload'],array['toolId','contentVersion','payload'])
    or not public.tool_space_keys(s->'payload',array['title','initial'],array['title','initial'])
    or jsonb_typeof(s#>'{payload,title}') is distinct from 'string' or octet_length(s::text)>150000 then return false; end if;
  -- 与 Zod 的 JavaScript trim / UTF-16 长度保持一致。
  title:=btrim(s#>>'{payload,title}',U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF');
  select char_length(title)+count(*) filter(where octet_length(codepoint)=4) into title_units from regexp_split_to_table(title,'') as chars(codepoint);
  return coalesce(title_units between 1 and 80 and s->>'toolId'='plane-folding' and s->>'contentVersion'='plane-folding-lesson-v3'
    and public.tool_plane_paper_layers_state_is_valid(s#>'{payload,initial}'),false);
exception when others then return false; end;
$$;

revoke all on function public.tool_plane_paper_layers_polygon_is_valid(jsonb) from public,anon,authenticated,service_role;
revoke all on function public.tool_plane_paper_layers_fold(jsonb,jsonb,jsonb,integer) from public,anon,authenticated,service_role;
revoke all on function public.tool_plane_paper_layers_state_is_valid(jsonb) from public,anon,authenticated,service_role;
revoke all on function public.tool_plane_paper_layers_scene_is_valid(jsonb) from public,anon,authenticated,service_role;
commit;
