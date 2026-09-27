-- 单折可构造纸张合同。仅追加 helper；总入口、版本目录由本批集成迁移接入。
begin;

create function public.tool_paper_signed_area(poly jsonb)
returns double precision language plpgsql immutable set search_path = pg_catalog,public as $$
declare n integer:=jsonb_array_length(poly); i integer; a jsonb; b jsonb; result double precision:=0;
begin
  if n<3 then return 0; end if;
  for i in 0..n-1 loop
    a:=poly->i; b:=poly->((i+1)%n);
    result:=result+(a->>'x')::double precision*(b->>'y')::double precision-(b->>'x')::double precision*(a->>'y')::double precision;
  end loop;
  return result/2;
end; $$;

-- 复用可构造多边形的边长、面积、自交和退化合同；这里只平移到其局部坐标。
create function public.tool_paper_polygon_is_valid(poly jsonb)
returns boolean language plpgsql immutable set search_path = pg_catalog,public as $$
declare n integer; i integer; q jsonb:='{"pivot":{"x":0,"y":0},"axis":{"x":0,"y":0},"center.0":{"x":480,"y":360}}'; s jsonb; p jsonb;
begin
  if jsonb_typeof(poly) is distinct from 'array' then return false; end if;
  n:=jsonb_array_length(poly);
  if n<3 or n>32 then return false; end if;
  for i in 0..n-1 loop
    p:=poly->i;
    if not public.tool_planar_point(p,0,960,0,720) then return false; end if;
    q:=q||jsonb_build_object('vertex.0.'||i,jsonb_build_object('x',(p->>'x')::double precision-480,'y',(p->>'y')::double precision-360));
  end loop;
  s:=jsonb_build_object('sceneId','01-create','phase',0,'marks','[]'::jsonb,'points',q,
    'params',jsonb_build_object('nextId',1,'active',0,'dx',0,'dy',0,'turn',0,'axisAngle',90,
      'kind.0',0,'count.0',n,'angle.0',0,'rx.0',0,'ry.0',0,'life.0',0,'detail.0',0,'flip.0',1),
    'flags','{"grid":false,"measures":false,"edges":false,"vertices":false,"names":false,"counts":false,"ghost":false,"edit":false,"snap":false}'::jsonb);
  return public.tool_plane_construction_state_is_valid(s);
exception when others then return false; end; $$;

create function public.tool_paper_crease_distance(p jsonb,a jsonb,b jsonb)
returns double precision language sql immutable set search_path = pg_catalog,public as $$
  select (((p->>'x')::double precision-(a->>'x')::double precision)*((b->>'y')::double precision-(a->>'y')::double precision)
    -((p->>'y')::double precision-(a->>'y')::double precision)*((b->>'x')::double precision-(a->>'x')::double precision))
    / nullif(sqrt(power((b->>'x')::double precision-(a->>'x')::double precision,2)+power((b->>'y')::double precision-(a->>'y')::double precision,2)),0);
$$;

create function public.tool_paper_clip(poly jsonb,a jsonb,b jsonb,side_ integer)
returns jsonb language plpgsql immutable set search_path = pg_catalog,public as $$
declare n integer:=jsonb_array_length(poly); i integer; p jsonb; q jsonb; d0 double precision; d1 double precision; t double precision;
  raw jsonb:='[]'; result jsonb:='[]'; previous jsonb; eps constant double precision:=1e-7;
begin
  if n=0 then return result; end if;
  for i in 0..n-1 loop
    p:=poly->i; q:=poly->((i+1)%n);
    d0:=public.tool_paper_crease_distance(p,a,b)*side_; d1:=public.tool_paper_crease_distance(q,a,b)*side_;
    if d0>= -eps then raw:=raw||jsonb_build_array(p); end if;
    if (d0>eps and d1< -eps) or (d0< -eps and d1>eps) then
      t:=d0/(d0-d1);
      raw:=raw||jsonb_build_array(jsonb_build_object('x',(p->>'x')::double precision+((q->>'x')::double precision-(p->>'x')::double precision)*t,
        'y',(p->>'y')::double precision+((q->>'y')::double precision-(p->>'y')::double precision)*t));
    end if;
  end loop;
  for p in select value from jsonb_array_elements(raw) loop
    if previous is null or sqrt(power((p->>'x')::double precision-(previous->>'x')::double precision,2)+power((p->>'y')::double precision-(previous->>'y')::double precision,2))>eps then
      result:=result||jsonb_build_array(p);
    end if;
    previous:=p;
  end loop;
  return result;
end; $$;

create function public.tool_paper_triangles(poly jsonb)
returns jsonb language plpgsql immutable set search_path = pg_catalog,public as $$
declare points_ jsonb:='[]'; result jsonb:='[]'; n integer:=jsonb_array_length(poly); i integer; j integer; previous integer; following integer;
  orientation integer; a jsonb; b jsonb; c jsonb; p jsonb; clipped boolean; contains_ boolean; guard integer:=0; eps constant double precision:=1e-7;
begin
  if n<3 then return result; end if;
  for i in 0..n-1 loop
    if abs(public.tool_planar_cross(poly->((i+n-1)%n),poly->i,poly->((i+1)%n)))>eps then points_:=points_||jsonb_build_array(poly->i); end if;
  end loop;
  n:=jsonb_array_length(points_);
  if n<3 then return result; end if;
  orientation:=sign(public.tool_paper_signed_area(points_))::integer;
  while n>3 and guard<1024 loop
    clipped:=false; guard:=guard+1;
    for i in 0..n-1 loop
      previous:=(i+n-1)%n; following:=(i+1)%n; a:=points_->previous; b:=points_->i; c:=points_->following;
      if public.tool_planar_cross(a,b,c)*orientation<=eps then continue; end if;
      contains_:=false;
      for j in 0..n-1 loop
        if j=previous or j=i or j=following then continue; end if;
        p:=points_->j;
        if public.tool_planar_cross(a,b,p)*orientation>= -eps and public.tool_planar_cross(b,c,p)*orientation>= -eps
          and public.tool_planar_cross(c,a,p)*orientation>= -eps then contains_:=true; exit; end if;
      end loop;
      if contains_ then continue; end if;
      result:=result||jsonb_build_array(jsonb_build_array(a,b,c)); points_:=points_-i; n:=n-1; clipped:=true; exit;
    end loop;
    if not clipped then return '[]'::jsonb; end if;
  end loop;
  if n=3 then result:=result||jsonb_build_array(points_); end if;
  return result;
end; $$;

create function public.tool_paper_regions(poly jsonb,a jsonb,b jsonb,side_ integer,moving boolean,folded boolean)
returns jsonb language plpgsql immutable set search_path = pg_catalog,public as $$
declare result jsonb:='[]'; triangle jsonb; clipped jsonb; projected jsonb; p jsonb; d double precision;
  length_ double precision:=sqrt(power((b->>'x')::double precision-(a->>'x')::double precision,2)+power((b->>'y')::double precision-(a->>'y')::double precision,2));
  nx double precision:=((b->>'y')::double precision-(a->>'y')::double precision)/length_;
  ny double precision:=-((b->>'x')::double precision-(a->>'x')::double precision)/length_;
begin
  for triangle in select value from jsonb_array_elements(public.tool_paper_triangles(poly)) loop
    clipped:=public.tool_paper_clip(triangle,a,b,case when moving then side_ else -side_ end);
    if jsonb_array_length(clipped)<3 or abs(public.tool_paper_signed_area(clipped))<=1e-7 then continue; end if;
    if moving and folded then
      projected:='[]';
      for p in select value from jsonb_array_elements(clipped) loop
        d:=public.tool_paper_crease_distance(p,a,b);
        projected:=projected||jsonb_build_array(jsonb_build_object('x',(p->>'x')::double precision-2*d*nx,'y',(p->>'y')::double precision-2*d*ny));
      end loop;
      clipped:=projected;
    end if;
    result:=result||jsonb_build_array(clipped);
  end loop;
  return result;
end; $$;

create function public.tool_paper_cut_intersects(regions jsonb,kind integer,cut_points jsonb,radius double precision)
returns boolean language plpgsql immutable set search_path = pg_catalog,public as $$
declare region_ jsonb; triangle jsonb; intersection_ jsonb; triangles jsonb; p jsonb; a jsonb; b jsonb;
  n integer; i integer; orientation integer; inside_ boolean; dx double precision; dy double precision; l2 double precision; t double precision;
  eps constant double precision:=1e-7;
begin
  if kind=0 then
    p:=cut_points->0;
    for region_ in select value from jsonb_array_elements(regions) loop
      n:=jsonb_array_length(region_); orientation:=sign(public.tool_paper_signed_area(region_))::integer; inside_:=true;
      for i in 0..n-1 loop
        a:=region_->i; b:=region_->((i+1)%n);
        if public.tool_planar_cross(a,b,p)*orientation< -eps then inside_:=false; end if;
        dx:=(b->>'x')::double precision-(a->>'x')::double precision; dy:=(b->>'y')::double precision-(a->>'y')::double precision; l2:=dx*dx+dy*dy;
        t:=case when l2=0 then 0 else greatest(0,least(1,(((p->>'x')::double precision-(a->>'x')::double precision)*dx+((p->>'y')::double precision-(a->>'y')::double precision)*dy)/l2)) end;
        if sqrt(power((p->>'x')::double precision-(a->>'x')::double precision-dx*t,2)+power((p->>'y')::double precision-(a->>'y')::double precision-dy*t,2))<radius-eps then return true; end if;
      end loop;
      if inside_ then return true; end if;
    end loop;
  else
    triangles:=public.tool_paper_triangles(cut_points);
    for region_ in select value from jsonb_array_elements(regions) loop
      for triangle in select value from jsonb_array_elements(triangles) loop
        intersection_:=region_; orientation:=-sign(public.tool_paper_signed_area(triangle))::integer;
        for i in 0..2 loop intersection_:=public.tool_paper_clip(intersection_,triangle->i,triangle->((i+1)%3),orientation); end loop;
        if abs(public.tool_paper_signed_area(intersection_))>eps then return true; end if;
      end loop;
    end loop;
  end if;
  return false;
end; $$;

create function public.tool_plane_paper_folding_state_is_valid(s jsonb)
returns boolean language plpgsql immutable set search_path = pg_catalog,public as $$
declare p jsonb:=s->'params'; q jsonb:=s->'points'; f jsonb:=s->'flags'; paper jsonb:='[]'; a jsonb; b jsonb;
  pkeys text[]:=array['paperCount','creaseSet','side','cutCount']; qkeys text[]:=array['creaseA','creaseB'];
  fkeys text[]:=array['grid','measures','crease','edit'];
  paper_count integer; cut_count integer; crease_set integer; side_ integer; i integer; j integer; kind integer; n integer; total_points integer:=0;
  radius double precision; poly jsonb; regions jsonb; fragment jsonb; fixed_area double precision:=0; moving_area double precision:=0;
  cuts jsonb:='[]'; cut jsonb;
begin
  if not public.tool_space_keys(s,array['sceneId','params','points','flags','marks','phase'],array['sceneId','params','points','flags','marks','phase'])
    or s->>'sceneId' is distinct from '32-create' or not public.tool_space_number(s->'phase',0,1)
    or not public.tool_space_number(p->'paperCount',3,32,true) or not public.tool_space_number(p->'creaseSet',0,1,true)
    or not public.tool_space_number(p->'side',-1,1,true) or (p->>'side')::numeric not in (-1,1)
    or not public.tool_space_number(p->'cutCount',0,12,true) or s->'marks' is distinct from '[]'::jsonb
    or not public.tool_space_keys(f,fkeys,fkeys) or exists(select 1 from jsonb_each(f) where jsonb_typeof(value)<>'boolean') then return false; end if;
  paper_count:=(p->>'paperCount')::numeric::integer; cut_count:=(p->>'cutCount')::numeric::integer; crease_set:=(p->>'creaseSet')::numeric::integer; side_:=(p->>'side')::numeric::integer;
  if crease_set=0 and ((s->>'phase')::numeric<>0 or cut_count<>0) then return false; end if;
  a:=q->'creaseA'; b:=q->'creaseB';
  if not public.tool_planar_point(a,-960,1920,-720,1440) or not public.tool_planar_point(b,-960,1920,-720,1440)
    or sqrt(power((b->>'x')::double precision-(a->>'x')::double precision,2)+power((b->>'y')::double precision-(a->>'y')::double precision,2))<12 then return false; end if;
  for i in 0..paper_count-1 loop
    qkeys:=array_append(qkeys,'paper.'||i); paper:=paper||jsonb_build_array(q->('paper.'||i));
  end loop;
  if not public.tool_paper_polygon_is_valid(paper) then return false; end if;
  if crease_set=1 then
    for fragment in select value from jsonb_array_elements(public.tool_paper_regions(paper,a,b,side_,false,false)) loop fixed_area:=fixed_area+abs(public.tool_paper_signed_area(fragment)); end loop;
    for fragment in select value from jsonb_array_elements(public.tool_paper_regions(paper,a,b,side_,true,false)) loop moving_area:=moving_area+abs(public.tool_paper_signed_area(fragment)); end loop;
    if fixed_area<=1 or moving_area<=1 then return false; end if;
    regions:=public.tool_paper_regions(paper,a,b,side_,false,true)||public.tool_paper_regions(paper,a,b,side_,true,true);
  end if;
  if cut_count>0 then for i in 0..cut_count-1 loop
    pkeys:=pkeys||array['cutKind.'||i,'cutVertices.'||i,'cutRadius.'||i];
    if not public.tool_space_number(p->('cutKind.'||i),0,1,true) or not public.tool_space_number(p->('cutVertices.'||i),1,32,true)
      or not public.tool_space_number(p->('cutRadius.'||i),0,350) then return false; end if;
    kind:=(p->>('cutKind.'||i))::numeric::integer; n:=(p->>('cutVertices.'||i))::numeric::integer; radius:=(p->>('cutRadius.'||i))::double precision;
    if (kind=0 and (n<>1 or radius<3)) or (kind=1 and (n<3 or radius<>0)) then return false; end if;
    total_points:=total_points+n; if total_points>192 then return false; end if;
    poly:='[]';
    for j in 0..n-1 loop
      qkeys:=array_append(qkeys,'cut.'||i||'.'||j);
      if not public.tool_planar_point(q->('cut.'||i||'.'||j),0,960,0,720) then return false; end if;
      poly:=poly||jsonb_build_array(q->('cut.'||i||'.'||j));
    end loop;
    if (kind=1 and not public.tool_paper_polygon_is_valid(poly)) or not public.tool_paper_cut_intersects(regions,kind,poly,radius) then return false; end if;
    cut:=jsonb_build_object('kind',kind,'radius',radius,'points',poly);
    if exists(select 1 from jsonb_array_elements(cuts) where value=cut) then return false; end if;
    cuts:=cuts||jsonb_build_array(cut);
  end loop; end if;
  return public.tool_space_keys(p,pkeys,pkeys) and public.tool_space_keys(q,qkeys,qkeys);
exception when others then return false; end; $$;

create function public.tool_plane_paper_folding_scene_is_valid(s jsonb)
returns boolean language plpgsql immutable set search_path = pg_catalog,public as $$
begin
  return coalesce(s->>'toolId'='plane-folding' and s->>'contentVersion'='plane-folding-lesson-v2'
    and public.tool_space_keys(s,array['toolId','contentVersion','payload'],array['toolId','contentVersion','payload'])
    and public.tool_space_keys(s->'payload',array['title','initial'],array['title','initial'])
    and jsonb_typeof(s#>'{payload,title}')='string' and char_length(btrim(s#>>'{payload,title}')) between 1 and 80
    and octet_length(s::text)<=150000 and public.tool_plane_paper_folding_state_is_valid(s#>'{payload,initial}'),false);
exception when others then return false; end; $$;

revoke all on function public.tool_paper_signed_area(jsonb) from public,anon,authenticated,service_role;
revoke all on function public.tool_paper_polygon_is_valid(jsonb) from public,anon,authenticated,service_role;
revoke all on function public.tool_paper_crease_distance(jsonb,jsonb,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.tool_paper_clip(jsonb,jsonb,jsonb,integer) from public,anon,authenticated,service_role;
revoke all on function public.tool_paper_triangles(jsonb) from public,anon,authenticated,service_role;
revoke all on function public.tool_paper_regions(jsonb,jsonb,jsonb,integer,boolean,boolean) from public,anon,authenticated,service_role;
revoke all on function public.tool_paper_cut_intersects(jsonb,integer,jsonb,double precision) from public,anon,authenticated,service_role;
revoke all on function public.tool_plane_paper_folding_state_is_valid(jsonb) from public,anon,authenticated,service_role;
revoke all on function public.tool_plane_paper_folding_scene_is_valid(jsonb) from public,anon,authenticated,service_role;
commit;
