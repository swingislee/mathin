-- 面积课堂 v3：可变形教学材料组与原自由纸片同台；本迁移只追加 helper 和 ACL。
-- 中间剪线与运动帧、派生面积、未知键均不进入持久数学状态；总入口由本批统一接入。
begin;

create function public.tool_plane_area_lessons_point(x double precision,y double precision)
returns jsonb language sql immutable set search_path = pg_catalog,public as $$
  select jsonb_build_object('x',x,'y',y);
$$;
create function public.tool_plane_area_lessons_rectangle(x double precision,y double precision,w double precision,h double precision)
returns jsonb language sql immutable set search_path = pg_catalog,public as $$
  select jsonb_build_array(public.tool_plane_area_lessons_point(x,y),public.tool_plane_area_lessons_point(x+w,y),
    public.tool_plane_area_lessons_point(x+w,y+h),public.tool_plane_area_lessons_point(x,y+h));
$$;

create function public.tool_plane_area_lessons_clip_x(polygon jsonb,cut_x double precision,side integer)
returns jsonb language plpgsql immutable set search_path = pg_catalog,public as $$
declare
  output jsonb:='[]'; result jsonb:='[]'; filtered jsonb; a jsonb; b jsonb; c jsonb;
  i integer; n integer:=jsonb_array_length(polygon); da double precision; db double precision; ratio double precision;
  ax double precision; ay double precision; bx double precision; by_ double precision; cx double precision; cy double precision;
  changed boolean:=true;
begin
  for i in 0..n-1 loop
    a:=polygon->i; b:=polygon->((i+1)%n); da:=((a->>'x')::double precision-cut_x)*side; db:=((b->>'x')::double precision-cut_x)*side;
    if da>=0 then output:=output||jsonb_build_array(a); end if;
    if (da>0 and db<0) or (da<0 and db>0) then
      ratio:=da/(da-db);
      output:=output||jsonb_build_array(public.tool_plane_area_lessons_point(cut_x,(a->>'y')::double precision+((b->>'y')::double precision-(a->>'y')::double precision)*ratio));
    end if;
  end loop;
  n:=jsonb_array_length(output);
  for i in 0..n-1 loop
    a:=output->i; b:=output->((i+1)%n);
    ax:=(a->>'x')::double precision; ay:=(a->>'y')::double precision; bx:=(b->>'x')::double precision; by_:=(b->>'y')::double precision;
    if sqrt((ax-bx)^2+(ay-by_)^2)>1e-7 then result:=result||jsonb_build_array(a); end if;
  end loop;
  while changed and jsonb_array_length(result)>3 loop
    changed:=false; filtered:='[]'; n:=jsonb_array_length(result);
    for i in 0..n-1 loop
      a:=result->((i+n-1)%n); b:=result->i; c:=result->((i+1)%n);
      ax:=(a->>'x')::double precision; ay:=(a->>'y')::double precision; bx:=(b->>'x')::double precision; by_:=(b->>'y')::double precision; cx:=(c->>'x')::double precision; cy:=(c->>'y')::double precision;
      if abs((bx-ax)*(cy-by_)-(by_-ay)*(cx-bx))<=1e-7 and (bx-ax)*(cx-bx)+(by_-ay)*(cy-by_)>=0 then changed:=true;
      else filtered:=filtered||jsonb_build_array(b); end if;
    end loop;
    result:=filtered;
  end loop;
  return result;
end;
$$;

create function public.tool_plane_area_lessons_polygons(kind integer,b double precision,h double precision,top_ double precision,s double precision,fraction double precision,notch double precision,axis_ integer,fill_ integer,cuts integer)
returns jsonb language plpgsql immutable set search_path = pg_catalog,public as $$
declare
  source jsonb; pieces jsonb:='[]'; polygon jsonb; required integer; first_band integer; band integer; i integer;
  x double precision:=b*fraction; y double precision:=h*notch; ratio double precision; intersection double precision;
begin
  if kind=14 then
    source:=jsonb_build_array(public.tool_plane_area_lessons_point(0,0),public.tool_plane_area_lessons_point(b,0),public.tool_plane_area_lessons_point(b+s,h),public.tool_plane_area_lessons_point(s,h));
    required:=ceil(abs(s)/b)::integer; first_band:=case when s<0 then -required else 0 end;
    for i in 0..cuts loop
      band:=first_band+i; polygon:=case when i=0 then source else public.tool_plane_area_lessons_clip_x(source,band*b,1) end;
      if i<cuts then polygon:=public.tool_plane_area_lessons_clip_x(polygon,(band+1)*b,-1); end if;
      pieces:=pieces||jsonb_build_array(polygon);
    end loop;
  elsif kind in (15,16) then
    source:=jsonb_build_array(public.tool_plane_area_lessons_point(0,0),public.tool_plane_area_lessons_point(b,0));
    if kind=16 then source:=source||jsonb_build_array(public.tool_plane_area_lessons_point(s+top_,h)); end if;
    source:=source||jsonb_build_array(public.tool_plane_area_lessons_point(s,h));
    for i in 0..cuts loop pieces:=pieces||jsonb_build_array(source); end loop;
  elsif kind=17 then
    if cuts=0 then
      pieces:=jsonb_build_array(jsonb_build_array(public.tool_plane_area_lessons_point(0,0),public.tool_plane_area_lessons_point(b,0),public.tool_plane_area_lessons_point(b,y),public.tool_plane_area_lessons_point(x,y),public.tool_plane_area_lessons_point(x,h),public.tool_plane_area_lessons_point(0,h)));
    elsif axis_=0 then pieces:=jsonb_build_array(public.tool_plane_area_lessons_rectangle(0,0,b,y),public.tool_plane_area_lessons_rectangle(0,y,x,h-y));
    else pieces:=jsonb_build_array(public.tool_plane_area_lessons_rectangle(0,0,x,h),public.tool_plane_area_lessons_rectangle(x,0,b-x,y)); end if;
    if fill_=1 then pieces:=pieces||jsonb_build_array(public.tool_plane_area_lessons_rectangle(x,y,b-x,h-y)); end if;
  elsif kind=46 then
    x:=b*(1-fraction); ratio:=(sqrt(5::double precision)-1)/2; y:=h*ratio; intersection:=x*(1-ratio);
    if cuts=0 then pieces:=jsonb_build_array(public.tool_plane_area_lessons_rectangle(0,0,b,h));
    else pieces:=jsonb_build_array(
      jsonb_build_array(public.tool_plane_area_lessons_point(0,0),public.tool_plane_area_lessons_point(x,0),public.tool_plane_area_lessons_point(0,h)),
      jsonb_build_array(public.tool_plane_area_lessons_point(x,0),public.tool_plane_area_lessons_point(b,0),public.tool_plane_area_lessons_point(b,y),public.tool_plane_area_lessons_point(intersection,y)),
      jsonb_build_array(public.tool_plane_area_lessons_point(intersection,y),public.tool_plane_area_lessons_point(b,y),public.tool_plane_area_lessons_point(b,h),public.tool_plane_area_lessons_point(0,h))); end if;
  else
    source:=jsonb_build_array(public.tool_plane_area_lessons_point(0,0),public.tool_plane_area_lessons_point(b,0),public.tool_plane_area_lessons_point(0,h));
    for i in 0..3 loop pieces:=pieces||jsonb_build_array(source); end loop;
  end if;
  return pieces;
end;
$$;

create function public.tool_plane_area_lessons_state_is_valid(s jsonb)
returns boolean language plpgsql immutable set search_path = pg_catalog,public as $$
declare
  p jsonb:=s->'params'; q jsonb:=s->'points'; f jsonb:=s->'flags'; free_p jsonb; free_q jsonb; free_f jsonb; free_s jsonb;
  ids integer[]; group_id integer; active_id integer; selected_piece integer; next_id integer; prefix text; key_ text;
  parameter_keys text[]; point_keys text[]; flag_keys text[];
  kind integer; cuts integer; fill_ integer; locked integer; axis_ integer; required integer; piece_count integer; i integer; j integer;
  object_count integer; vertex_count integer;
  b double precision; h double precision; top_ double precision; shear double precision; fraction double precision; notch double precision;
  angle_ double precision; flip_ double precision; gc double precision; gs double precision; pc double precision; ps double precision;
  ox double precision; oy double precision; tx double precision; ty double precision; x double precision; y double precision; xx double precision; yy double precision;
  min_x double precision; min_y double precision; max_x double precision; max_y double precision; center_x double precision; center_y double precision;
  polygons jsonb; polygon jsonb; point_ jsonb; world_points jsonb; object_p jsonb; object_q jsonb; virtual_state jsonb;
begin
  if not public.tool_space_keys(s,array['sceneId','params','points','flags','marks','phase'],array['sceneId','params','points','flags','marks','phase'])
    or s->>'sceneId' is distinct from '14-lessons' or not public.tool_space_number(s->'phase',0,0)
    or jsonb_typeof(p) is distinct from 'object' or jsonb_typeof(q) is distinct from 'object' or jsonb_typeof(f) is distinct from 'object'
    then return false; end if;
  select coalesce(jsonb_object_agg(key,value),'{}') into free_p from jsonb_each(p) where left(key,6)<>'lesson';
  select coalesce(jsonb_object_agg(key,value),'{}') into free_q from jsonb_each(q) where left(key,6)<>'lesson';
  select coalesce(jsonb_object_agg(key,value),'{}') into free_f from jsonb_each(f) where left(key,6)<>'lesson';
  free_s:=s||jsonb_build_object('sceneId','14-create','params',free_p,'points',free_q,'flags',free_f);
  if public.tool_plane_paper_state_is_valid(free_s) is not true
    or (select count(*) from jsonb_object_keys(p))>256 or (select count(*) from jsonb_object_keys(q))>256
    or not public.tool_space_number(p->'lessonNextId',1,99999,true) or not public.tool_space_number(p->'lessonActive',-1,99998,true)
    or not public.tool_space_number(p->'lessonPiece',-1,15,true) then return false; end if;
  next_id:=(p->>'lessonNextId')::numeric::integer; active_id:=(p->>'lessonActive')::numeric::integer; selected_piece:=(p->>'lessonPiece')::numeric::integer;
  select coalesce(array_agg(substring(key from 12)::integer order by substring(key from 12)::integer),array[]::integer[]) into ids
    from jsonb_object_keys(p) as group_keys(key) where key ~ '^lessonKind\.(0|[1-9][0-9]{0,4})$';
  if cardinality(ids)>4 or exists(select 1 from unnest(ids) as group_ids(id) where id>=next_id or id>99998)
    or (active_id<>-1 and not active_id=any(ids)) or (active_id=-1 and selected_piece<>-1)
    or (active_id<>-1 and (free_p->>'active')::numeric<>-1) then return false; end if;
  select coalesce(array_agg(key),array[]::text[])||array['lessonNextId','lessonActive','lessonPiece'] into parameter_keys from jsonb_object_keys(free_p) as free_keys(key);
  select coalesce(array_agg(key),array[]::text[]) into point_keys from jsonb_object_keys(free_q) as free_keys(key);
  select coalesce(array_agg(key),array[]::text[])||array['lessonGuides','lessonValues'] into flag_keys from jsonb_object_keys(free_f) as free_keys(key);
  if not public.tool_space_keys(f,flag_keys,flag_keys) or exists(select 1 from jsonb_each(f) where jsonb_typeof(value)<>'boolean') then return false; end if;
  select count(*) into object_count from jsonb_object_keys(free_p) as object_keys(key) where key like 'kind.%';
  select coalesce(sum((value#>>'{}')::numeric),0)::integer into vertex_count from jsonb_each(free_p) where key like 'count.%';
  foreach group_id in array ids loop
    if not public.tool_space_number(p->('lessonKind.'||group_id),14,58,true) then return false; end if;
    kind:=(p->>('lessonKind.'||group_id))::numeric::integer;
    if kind not in (14,15,16,17,46,58)
      or not public.tool_space_number(p->('lessonBase.'||group_id),12,700)
      or not public.tool_space_number(p->('lessonHeight.'||group_id),12,600)
      or not public.tool_space_number(p->('lessonTop.'||group_id),case when kind=16 then 12 else 0 end,case when kind=16 then 700 else 0 end)
      or not public.tool_space_number(p->('lessonShear.'||group_id),case when kind in (14,15,16) then -700 else 0 end,case when kind in (14,15,16) then 700 else 0 end)
      or not public.tool_space_number(p->('lessonFraction.'||group_id),case when kind in (17,46) then 0.01 else 0 end,case when kind in (17,46) then 0.99 else 0 end)
      or not public.tool_space_number(p->('lessonNotch.'||group_id),case when kind=17 then 0.01 else 0 end,case when kind=17 then 0.99 else 0 end)
      or not public.tool_space_number(p->('lessonAxis.'||group_id),0,case when kind=17 then 1 else 0 end,true)
      or not public.tool_space_number(p->('lessonLocked.'||group_id),0,case when kind=46 then 1 else 0 end,true)
      or not public.tool_space_number(p->('lessonFill.'||group_id),0,case when kind=17 then 1 else 0 end,true)
      or not public.tool_space_number(p->('lessonCuts.'||group_id),case when kind=58 then 1 else 0 end,case when kind=14 then 15 else 1 end,true)
      or not public.tool_space_number(p->('lessonAngle.'||group_id),-36000,36000)
      or not public.tool_space_number(p->('lessonFlip.'||group_id),-1,1,true)
      or (p->>('lessonFlip.'||group_id))::numeric not in (-1,1)
      or not public.tool_planar_point(q->('lessonOrigin.'||group_id),-1000,2000,-1000,1720)
      then return false; end if;
    b:=(p->>('lessonBase.'||group_id))::double precision; h:=(p->>('lessonHeight.'||group_id))::double precision; top_:=(p->>('lessonTop.'||group_id))::double precision;
    shear:=(p->>('lessonShear.'||group_id))::double precision; fraction:=(p->>('lessonFraction.'||group_id))::double precision; notch:=(p->>('lessonNotch.'||group_id))::double precision;
    cuts:=(p->>('lessonCuts.'||group_id))::numeric::integer; fill_:=(p->>('lessonFill.'||group_id))::numeric::integer; locked:=(p->>('lessonLocked.'||group_id))::numeric::integer; axis_:=(p->>('lessonAxis.'||group_id))::numeric::integer;
    if kind=46 and locked=1 and fraction<>1::double precision/3 then return false; end if;
    required:=case when kind=14 then ceil(abs(shear)/b)::integer else 1 end;
    if kind=14 and (required>15 or cuts>required) then return false; end if;
    foreach prefix in array array['Kind','Base','Height','Top','Shear','Fraction','Notch','Axis','Locked','Fill','Cuts','Angle','Flip'] loop parameter_keys:=array_append(parameter_keys,'lesson'||prefix||'.'||group_id); end loop;
    point_keys:=array_append(point_keys,'lessonOrigin.'||group_id);
    angle_:=(p->>('lessonAngle.'||group_id))::double precision*pi()/180; flip_:=(p->>('lessonFlip.'||group_id))::double precision;
    gc:=cos(angle_); gs:=sin(angle_); ox:=(q#>>array['lessonOrigin.'||group_id,'x'])::double precision; oy:=(q#>>array['lessonOrigin.'||group_id,'y'])::double precision;
    polygons:=public.tool_plane_area_lessons_polygons(kind,b,h,top_,shear,fraction,notch,axis_,fill_,cuts); piece_count:=jsonb_array_length(polygons);
    if piece_count<1 or piece_count>16 or (active_id=group_id and (selected_piece<0 or selected_piece>=piece_count)) then return false; end if;
    object_count:=object_count+piece_count; if object_count>16 then return false; end if;
    for i in 0..piece_count-1 loop
      key_:='lessonTurn.'||group_id||'.'||i; parameter_keys:=array_append(parameter_keys,key_);
      if not public.tool_space_number(p->key_,-36000,36000) then return false; end if;
      angle_:=(p->>key_)::double precision*pi()/180; pc:=cos(angle_); ps:=sin(angle_);
      key_:='lessonOffset.'||group_id||'.'||i; point_keys:=array_append(point_keys,key_);
      if not public.tool_planar_point(q->key_,-1600,1600,-1600,1600) then return false; end if;
      tx:=(q#>>array[key_,'x'])::double precision; ty:=(q#>>array[key_,'y'])::double precision;
      polygon:=polygons->i; vertex_count:=vertex_count+jsonb_array_length(polygon); if vertex_count>192 then return false; end if;
      world_points:='[]'; min_x:=null; min_y:=null; max_x:=null; max_y:=null;
      for point_ in select value from jsonb_array_elements(polygon) loop
        x:=(point_->>'x')::double precision; y:=(point_->>'y')::double precision;
        xx:=pc*x-ps*y+tx; yy:=(ps*x+pc*y+ty)*flip_;
        x:=ox+gc*xx-gs*yy; y:=oy+gs*xx+gc*yy;
        world_points:=world_points||jsonb_build_array(public.tool_plane_area_lessons_point(x,y));
        min_x:=least(min_x,x); max_x:=greatest(max_x,x); min_y:=least(min_y,y); max_y:=greatest(max_y,y);
      end loop;
      center_x:=(min_x+max_x)/2; center_y:=(min_y+max_y)/2;
      object_p:=jsonb_build_object('nextId',1,'active',0,'dx',0,'dy',0,'turn',0,'axisAngle',0,'kind.0',0,'count.0',jsonb_array_length(polygon),'angle.0',0,'rx.0',0,'ry.0',0,'life.0',0,'detail.0',0,'flip.0',1);
      object_q:=jsonb_build_object('pivot',public.tool_plane_area_lessons_point(0,0),'axis',public.tool_plane_area_lessons_point(0,0),'center.0',public.tool_plane_area_lessons_point(center_x,center_y));
      for j in 0..jsonb_array_length(world_points)-1 loop
        point_:=world_points->j;
        object_q:=object_q||jsonb_build_object('vertex.0.'||j,public.tool_plane_area_lessons_point((point_->>'x')::double precision-center_x,(point_->>'y')::double precision-center_y));
      end loop;
      virtual_state:=jsonb_build_object('sceneId','01-create','params',object_p,'points',object_q,'flags',free_f,'marks','[]'::jsonb,'phase',0);
      if public.tool_plane_construction_state_is_valid(virtual_state) is not true then return false; end if;
    end loop;
  end loop;
  return public.tool_space_keys(p,parameter_keys,parameter_keys) and public.tool_space_keys(q,point_keys,point_keys);
exception when others then return false; end;
$$;

create function public.tool_plane_area_lessons_scene_is_valid(s jsonb)
returns boolean language plpgsql immutable set search_path = pg_catalog,public as $$
begin
  return coalesce(s->>'toolId'='plane-area' and s->>'contentVersion'='plane-area-lesson-v3'
    and public.tool_space_keys(s,array['toolId','contentVersion','payload'],array['toolId','contentVersion','payload'])
    and public.tool_space_keys(s->'payload',array['title','initial'],array['title','initial'])
    and jsonb_typeof(s#>'{payload,title}')='string' and char_length(btrim(s#>>'{payload,title}')) between 1 and 80
    and octet_length(s::text)<=150000 and public.tool_plane_area_lessons_state_is_valid(s#>'{payload,initial}'),false);
exception when others then return false; end;
$$;
revoke all on function public.tool_plane_area_lessons_point(double precision,double precision) from public,anon,authenticated,service_role;
revoke all on function public.tool_plane_area_lessons_rectangle(double precision,double precision,double precision,double precision) from public,anon,authenticated,service_role;
revoke all on function public.tool_plane_area_lessons_clip_x(jsonb,double precision,integer) from public,anon,authenticated,service_role;
revoke all on function public.tool_plane_area_lessons_polygons(integer,double precision,double precision,double precision,double precision,double precision,double precision,integer,integer,integer) from public,anon,authenticated,service_role;
revoke all on function public.tool_plane_area_lessons_state_is_valid(jsonb) from public,anon,authenticated,service_role;
revoke all on function public.tool_plane_area_lessons_scene_is_valid(jsonb) from public,anon,authenticated,service_role;
commit;
