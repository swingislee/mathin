-- 三角形、四边形与杆件 v2：保存真实约束和角片刚性位姿；旧 06/07/08 不变。
begin;
create function public.tool_plane_polygon_workbench_state_is_valid(s jsonb)
returns boolean language plpgsql immutable set search_path = pg_catalog,public as $$
declare
  p jsonb:=s->'params'; pts jsonb:=s->'points'; f jsonb:=s->'flags'; count_value integer; i integer; j integer; k integer; l integer; n integer; kind integer;
  dims text[]; name text; entry record; at jsonb; low_value numeric; high_value numeric;
  keys_p text[]:=array['count','active','vertex']; keys_pt text[]:=array[]::text[]; keys_f text[]:=array['grid','measures','names'];
  xs double precision[]; ys double precision[]; area double precision; turn_value double precision;
  ax double precision; ay double precision; bx double precision; by_value double precision; cx double precision; cy double precision; dx double precision; dy double precision;
  orientation double precision[]; epsilon constant double precision:=1e-8;
begin
  if public.tool_space_keys(s,array['sceneId','params','points','flags','marks','phase'],array['sceneId','params','points','flags','marks','phase']) is not true
    or s->>'sceneId' is distinct from '06-create' or not public.tool_space_number(s->'phase',0,0) or s->'marks' is distinct from '[]'::jsonb
    or jsonb_typeof(p) is distinct from 'object' or jsonb_typeof(pts) is distinct from 'object' or jsonb_typeof(f) is distinct from 'object'
    or not public.tool_space_number(p->'count',0,16,true) or not public.tool_space_number(p->'vertex',0,3,true)
    or exists(select 1 from jsonb_each(f) where jsonb_typeof(value)<>'boolean') then return false; end if;
  count_value:=(p->>'count')::numeric::integer;
  if not public.tool_space_number(p->'active',case when count_value=0 then -1 else 0 end,count_value-1,true) then return false; end if;
  for entry in select * from jsonb_each(pts) loop
    at:=entry.value; high_value:=case when entry.key like 'vertex.%' then 2400 else 4000 end;
    if public.tool_space_keys(at,array['x','y'],array['x','y']) is not true
      or not public.tool_space_number(at->'x',-high_value,high_value) or not public.tool_space_number(at->'y',-high_value,high_value) then return false; end if;
  end loop;
  if count_value>0 then for i in 0..count_value-1 loop
    if not public.tool_space_number(p->('kind.'||i),0,9,true) or not public.tool_space_number(p->('rotation.'||i),-180,180) then return false; end if;
    kind:=(p->>('kind.'||i))::numeric::integer;
    if not public.tool_space_number(p->('base.'||i),0,case when kind<2 then 0 when kind=3 then 2 else 3 end,true) then return false; end if;
    keys_p:=keys_p||array['kind.'||i,'rotation.'||i,'base.'||i]; keys_pt:=array_append(keys_pt,'origin.'||i); keys_f:=keys_f||array['height.'||i,'angles.'||i];
    if (kind<2 and f->('height.'||i) is distinct from 'false'::jsonb) or (kind<>3 and f->('angles.'||i) is distinct from 'false'::jsonb) then return false; end if;
    dims:=case kind when 0 then array['width'] when 1 then array['width','left','right','side'] when 2 then array['width','left','opening','side']
      when 3 then array[]::text[] when 4 then array[]::text[] when 5 then array['width','height'] when 6 then array['width']
      when 7 then array['width','height','shift'] when 8 then array['width','opening'] else array['width','top','height','shift'] end;
    foreach name in array dims loop
      keys_p:=array_append(keys_p,name||'.'||i);
      low_value:=case name when 'opening' then 5 when 'side' then -1 when 'shift' then -1600 else 4 end;
      high_value:=case name when 'opening' then 175 when 'side' then 1 else 1600 end;
      if not public.tool_space_number(p->(name||'.'||i),low_value,high_value) then return false; end if;
      if name='side' and abs((p->>(name||'.'||i))::double precision)<>1 then return false; end if;
    end loop;
    if kind in (3,4) then
      n:=case when kind=3 then 3 else 4 end; xs:=array[]::double precision[]; ys:=array[]::double precision[];
      for j in 0..n-1 loop
        name:='vertex.'||i||'.'||j; keys_pt:=array_append(keys_pt,name); at:=pts->name;
        if at is null then return false; end if;
        xs:=array_append(xs,(at->>'x')::double precision); ys:=array_append(ys,(at->>'y')::double precision);
      end loop;
      area:=0;
      for j in 1..n loop
        k:=j%n+1; l:=(j+1)%n+1;
        area:=area+xs[j]*ys[k]-ys[j]*xs[k];
        turn_value:=(xs[k]-xs[j])*(ys[l]-ys[j])-(ys[k]-ys[j])*(xs[l]-xs[j]);
        if sqrt(power(xs[k]-xs[j],2)+power(ys[k]-ys[j],2))<4-epsilon or abs(turn_value)<epsilon then return false; end if;
      end loop;
      if abs(area/2)<1-epsilon then return false; end if;
      if n=4 then for j in 1..2 loop
        ax:=xs[j]; ay:=ys[j]; bx:=xs[j+1]; by_value:=ys[j+1]; cx:=xs[j+2]; cy:=ys[j+2]; dx:=xs[(j+2)%4+1]; dy:=ys[(j+2)%4+1];
        orientation:=array[(bx-ax)*(cy-ay)-(by_value-ay)*(cx-ax),(bx-ax)*(dy-ay)-(by_value-ay)*(dx-ax),
          (dx-cx)*(ay-cy)-(dy-cy)*(ax-cx),(dx-cx)*(by_value-cy)-(dy-cy)*(bx-cx)];
        if orientation[1]*orientation[2]<0 and orientation[3]*orientation[4]<0 then return false; end if;
        if (abs(orientation[1])<=epsilon and cx>=least(ax,bx)-epsilon and cx<=greatest(ax,bx)+epsilon and cy>=least(ay,by_value)-epsilon and cy<=greatest(ay,by_value)+epsilon)
          or (abs(orientation[2])<=epsilon and dx>=least(ax,bx)-epsilon and dx<=greatest(ax,bx)+epsilon and dy>=least(ay,by_value)-epsilon and dy<=greatest(ay,by_value)+epsilon)
          or (abs(orientation[3])<=epsilon and ax>=least(cx,dx)-epsilon and ax<=greatest(cx,dx)+epsilon and ay>=least(cy,dy)-epsilon and ay<=greatest(cy,dy)+epsilon)
          or (abs(orientation[4])<=epsilon and bx>=least(cx,dx)-epsilon and bx<=greatest(cx,dx)+epsilon and by_value>=least(cy,dy)-epsilon and by_value<=greatest(cy,dy)+epsilon) then return false; end if;
      end loop; end if;
    end if;
    if f->('angles.'||i)='true'::jsonb then for j in 0..2 loop
      name:='turn.'||i||'.'||j; keys_p:=array_append(keys_p,name); keys_pt:=array_append(keys_pt,'corner.'||i||'.'||j);
      if not public.tool_space_number(p->name,-180,180) then return false; end if;
    end loop; end if;
  end loop; end if;
  return public.tool_space_keys(p,keys_p,keys_p) and public.tool_space_keys(pts,keys_pt,keys_pt) and public.tool_space_keys(f,keys_f,keys_f);
exception when others then return false; end;
$$;
create function public.tool_plane_polygon_workbench_scene_is_valid(s jsonb)
returns boolean language plpgsql immutable set search_path = pg_catalog,public as $$
declare title text; title_units integer;
begin
  if not public.tool_space_keys(s,array['toolId','contentVersion','payload'],array['toolId','contentVersion','payload'])
    or not public.tool_space_keys(s->'payload',array['title','initial'],array['title','initial'])
    or jsonb_typeof(s#>'{payload,title}') is distinct from 'string' or octet_length(s::text)>150000 then return false; end if;
  -- 与 JavaScript trim / UTF-16 长度一致，不把纯空白或辅助平面字符算成另一种标题。
  title:=btrim(s#>>'{payload,title}',U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF');
  select char_length(title)+count(*) filter(where octet_length(codepoint)=4) into title_units from regexp_split_to_table(title,'') as chars(codepoint);
  return coalesce(title_units between 1 and 80 and s->>'toolId'='plane-polygons' and s->>'contentVersion'='plane-polygons-lesson-v2'
    and public.tool_plane_polygon_workbench_state_is_valid(s#>'{payload,initial}'),false);
exception when others then return false; end;
$$;
revoke all on function public.tool_plane_polygon_workbench_state_is_valid(jsonb) from public,anon,authenticated,service_role;
revoke all on function public.tool_plane_polygon_workbench_scene_is_valid(jsonb) from public,anon,authenticated,service_role;
commit;
