-- 重叠 v4：保存真实线段/圆弧闭环、圆支撑与刚性位姿，历史合同保持。
begin;

create function public.tool_plane_overlap_curves_region_is_valid(s jsonb)
returns boolean language plpgsql immutable set search_path = pg_catalog,public as $$
declare
  epsilon constant double precision:=7.105427357601002e-15; tau constant double precision:=2*pi();
  n integer; m integer; circle_count integer; i integer; j integer; k integer; q integer; h integer; first_index integer; last_index integer;
  li integer; ci integer; owner_a integer; owner_b integer; code integer; ordinal integer; shift_value integer; depth integer; mask_value integer;
  xs double precision[]:=array[]::double precision[]; ys double precision[]:=array[]::double precision[];
  csx double precision[]; csy double precision[]; radii double precision[]; dirs integer[]; ends integer[]; owners integer[]; starts integer[]; finishes integer[]; sweeps double precision[];
  areas double precision[]; relation integer[]; all_stops jsonb:='{}'::jsonb; stop_key text;
  values_x double precision[]; values_y double precision[]; parameters double precision[]; stops double precision[]; arc_stops double precision[];
  entry jsonb; support jsonb; at jsonb; count_value integer; arc_code integer;
  ax double precision; ay double precision; bx double precision; by_value double precision; vx double precision; vy double precision; wx double precision; wy double precision;
  px double precision; py double precision; tx double precision; ty double precision; ux double precision; uy double precision; mx double precision; my_value double precision;
  length_value double precision; determinant double precision; error_value double precision; angle_value double precision; parameter_value double precision; second_parameter double precision;
  projection double precision; perpendicular double precision; gap double precision; half_value double precision; along_value double precision; d double precision; sum_value double precision; difference_value double precision;
  area_value double precision; term double precision; compensation double precision; adjusted double precision; temporary double precision; squared double precision;
  start_a double precision; start_b double precision; length_a double precision; length_b double precision; from_value double precision; to_value double precision;
  t0 double precision; t1 double precision; tmid double precision; y0 double precision; y1 double precision; cross_x double precision; root_value double precision;
  same_support boolean; accepted boolean; boundary boolean; upward boolean; downward boolean; winding integer;
begin
  if public.tool_space_keys(s,array['vertices','circles','counts','arcs'],array['vertices','circles','counts','arcs']) is not true
    or jsonb_typeof(s->'vertices') is distinct from 'array' or jsonb_typeof(s->'circles') is distinct from 'array'
    or jsonb_typeof(s->'counts') is distinct from 'array' or jsonb_typeof(s->'arcs') is distinct from 'array' then return false; end if;
  n:=jsonb_array_length(s->'vertices'); m:=jsonb_array_length(s->'counts'); circle_count:=jsonb_array_length(s->'circles');
  if n<2 or n>192 or m<1 or m>32 or circle_count>32 or jsonb_array_length(s->'arcs')<>n then return false; end if;
  for entry in select value from jsonb_array_elements(s->'circles') loop
    if public.tool_space_keys(entry,array['x','y','r'],array['x','y','r']) is not true
      or public.tool_space_number(entry->'x',-4000,4000) is not true or public.tool_space_number(entry->'y',-4000,4000) is not true
      or public.tool_space_number(entry->'r',4,1600) is not true then return false; end if;
  end loop;
  csx:=array_fill(0::double precision,array[n]); csy:=csx; radii:=csx; sweeps:=csx;
  dirs:=array_fill(0,array[n]); ends:=dirs; owners:=dirs; starts:=array_fill(0,array[m]); finishes:=starts;
  areas:=array_fill(0::double precision,array[m]); relation:=array_fill(0,array[m*m]);
  for i in 1..n loop
    at:=s->'vertices'->(i-1);
    if public.tool_space_keys(at,array['x','y'],array['x','y']) is not true or public.tool_space_number(at->'x',-4000,4000) is not true
      or public.tool_space_number(at->'y',-4000,4000) is not true or public.tool_space_number(s->'arcs'->(i-1),-circle_count,circle_count,true) is not true then return false; end if;
    xs:=array_append(xs,(at->>'x')::double precision); ys:=array_append(ys,(at->>'y')::double precision);
    code:=(s->'arcs'->>(i-1))::numeric::integer;
    if code<>0 then
      support:=s->'circles'->(abs(code)-1); csx[i]:=(support->>'x')::double precision; csy[i]:=(support->>'y')::double precision;
      radii[i]:=(support->>'r')::double precision; dirs[i]:=case when code>0 then 1 else -1 end;
    end if;
  end loop;
  first_index:=1;
  for q in 1..m loop
    if public.tool_space_number(s->'counts'->(q-1),2,192,true) is not true then return false; end if;
    count_value:=(s->'counts'->>(q-1))::numeric::integer; last_index:=first_index+count_value-1;
    if last_index>n then return false; end if;
    starts[q]:=first_index; finishes[q]:=last_index; area_value:=0; compensation:=0;
    for i in first_index..last_index loop
      j:=case when i=last_index then first_index else i+1 end; ends[i]:=j; owners[i]:=q;
      error_value:=epsilon*greatest(1,abs(xs[i]),abs(ys[i]),abs(xs[j]),abs(ys[j]));
      if sqrt(power(xs[j]-xs[i],2)+power(ys[j]-ys[i],2))<=error_value then return false; end if;
      term:=((xs[i]-xs[first_index])*(ys[j]-ys[first_index])-(ys[i]-ys[first_index])*(xs[j]-xs[first_index]))/2;
      if radii[i]>0 then
        error_value:=epsilon*greatest(1,abs(xs[i]),abs(ys[i]),abs(xs[j]),abs(ys[j]),abs(csx[i]),abs(csy[i]))+epsilon*greatest(1,radii[i]);
        if abs(sqrt(power(xs[i]-csx[i],2)+power(ys[i]-csy[i],2))-radii[i])>error_value
          or abs(sqrt(power(xs[j]-csx[i],2)+power(ys[j]-csy[i],2))-radii[i])>error_value then return false; end if;
        vx:=xs[i]-csx[i]; vy:=ys[i]-csy[i]; wx:=xs[j]-csx[i]; wy:=ys[j]-csy[i];
        angle_value:=atan2(vx*wy-vy*wx,vx*wx+vy*wy);
        if dirs[i]=1 and angle_value<=0 then angle_value:=angle_value+tau; elsif dirs[i]=-1 and angle_value>=0 then angle_value:=angle_value-tau; end if;
        sweeps[i]:=angle_value; squared:=angle_value*angle_value;
        term:=term+radii[i]*radii[i]/2*case when abs(angle_value)<.01 then angle_value*squared/6*(1-squared/20*(1-squared/42*(1-squared/72))) else angle_value-sin(angle_value) end;
      end if;
      adjusted:=term-compensation; temporary:=area_value+adjusted; compensation:=(temporary-area_value)-adjusted; area_value:=temporary;
    end loop;
    if area_value=0 then return false; end if;
    areas[q]:=area_value; first_index:=last_index+1;
  end loop;
  if first_index<>n+1 then return false; end if;

  -- 边边解析相交；重合开边非法，孤立相切可留在不同环之间。
  for i in 1..n-1 loop for j in i+1..n loop
    values_x:=array[]::double precision[]; values_y:=array[]::double precision[];
    ax:=xs[i]; ay:=ys[i]; bx:=xs[ends[i]]; by_value:=ys[ends[i]];
    vx:=bx-ax; vy:=by_value-ay; wx:=xs[ends[j]]-xs[j]; wy:=ys[ends[j]]-ys[j];
    error_value:=epsilon*greatest(1,abs(ax),abs(ay),abs(bx),abs(by_value),abs(xs[j]),abs(ys[j]),abs(xs[ends[j]]),abs(ys[ends[j]]));
    if radii[i]=0 and radii[j]=0 then
      determinant:=vx*wy-vy*wx;
      if abs(determinant)>epsilon*greatest(1,abs(vx*wy),abs(vy*wx)) then
        parameter_value:=((xs[j]-ax)*wy-(ys[j]-ay)*wx)/determinant;
        second_parameter:=((xs[j]-ax)*vy-(ys[j]-ay)*vx)/determinant;
        if parameter_value>=-epsilon*greatest(1,abs(parameter_value)) and parameter_value<=1+epsilon*greatest(1,abs(parameter_value))
          and second_parameter>=-epsilon*greatest(1,abs(second_parameter)) and second_parameter<=1+epsilon*greatest(1,abs(second_parameter)) then
          parameter_value:=greatest(0,least(1,parameter_value)); values_x:=array[ax+vx*parameter_value]; values_y:=array[ay+vy*parameter_value];
        end if;
      elsif abs(vx*(ys[j]-ay)-vy*(xs[j]-ax))<=error_value*sqrt(vx*vx+vy*vy) then
        from_value:=((xs[j]-ax)*vx+(ys[j]-ay)*vy)/(vx*vx+vy*vy); to_value:=((xs[ends[j]]-ax)*vx+(ys[ends[j]]-ay)*vy)/(vx*vx+vy*vy);
        if abs(vx*(ys[ends[j]]-ay)-vy*(xs[ends[j]]-ax))<=error_value*sqrt(vx*vx+vy*vy)
          and least(1,greatest(from_value,to_value))-greatest(0,least(from_value,to_value))>error_value/sqrt(vx*vx+vy*vy) then return false; end if;
        values_x:=array[ax,bx,xs[j],xs[ends[j]]]; values_y:=array[ay,by_value,ys[j],ys[ends[j]]];
      end if;
    elsif radii[i]=0 or radii[j]=0 then
      li:=case when radii[i]=0 then i else j end; ci:=case when radii[i]>0 then i else j end;
      length_value:=sqrt(power(xs[ends[li]]-xs[li],2)+power(ys[ends[li]]-ys[li],2)); ux:=(xs[ends[li]]-xs[li])/length_value; uy:=(ys[ends[li]]-ys[li])/length_value;
      tx:=csx[ci]-xs[li]; ty:=csy[ci]-ys[li]; projection:=tx*ux+ty*uy; perpendicular:=tx*uy-ty*ux; gap:=radii[ci]-abs(perpendicular);
      if gap>=-epsilon*greatest(1,radii[ci],abs(perpendicular),abs(tx),abs(ty)) then
        half_value:=sqrt(greatest(0,gap*(radii[ci]+abs(perpendicular))));
        foreach along_value in array case when half_value=0 then array[projection] else array[projection-half_value,projection+half_value] end loop
          parameter_value:=along_value/length_value;
          if parameter_value>=-epsilon*greatest(1,abs(parameter_value)) and parameter_value<=1+epsilon*greatest(1,abs(parameter_value)) then
            along_value:=greatest(0,least(length_value,along_value)); values_x:=array_append(values_x,xs[li]+ux*along_value); values_y:=array_append(values_y,ys[li]+uy*along_value);
          end if;
        end loop;
      end if;
    else
      d:=sqrt(power(csx[j]-csx[i],2)+power(csy[j]-csy[i],2));
      same_support:=d<=epsilon*greatest(1,abs(csx[i]),abs(csy[i]),abs(csx[j]),abs(csy[j])) and abs(radii[i]-radii[j])<=epsilon*greatest(1,radii[i],radii[j]);
      if same_support then
        start_a:=atan2(ys[i]-csy[i],xs[i]-csx[i])+case when dirs[i]=-1 then sweeps[i] else 0 end;
        start_b:=atan2(ys[j]-csy[j],xs[j]-csx[j])+case when dirs[j]=-1 then sweeps[j] else 0 end;
        start_a:=start_a-floor(start_a/tau)*tau; start_b:=start_b-floor(start_b/tau)*tau; length_a:=abs(sweeps[i]); length_b:=abs(sweeps[j]);
        for shift_value in -1..1 loop
          if least(start_a+length_a,start_b+shift_value*tau+length_b)-greatest(start_a,start_b+shift_value*tau)>epsilon*tau then return false; end if;
        end loop;
        values_x:=array[ax,bx,xs[j],xs[ends[j]]]; values_y:=array[ay,by_value,ys[j],ys[ends[j]]];
      else
        sum_value:=radii[i]+radii[j]; difference_value:=abs(radii[i]-radii[j]); error_value:=epsilon*greatest(1,radii[i],radii[j],d,abs(csx[i]),abs(csy[i]),abs(csx[j]),abs(csy[j]));
        if d>0 and d<=sum_value+error_value and d>=difference_value-error_value then
          along_value:=(d+(radii[i]-radii[j])*(radii[i]+radii[j])/d)/2;
          half_value:=sqrt(greatest(0,sum_value-d)*(sum_value+d)*greatest(0,d-difference_value)*(d+difference_value))/(2*d);
          ux:=(csx[j]-csx[i])/d; uy:=(csy[j]-csy[i])/d; px:=csx[i]+ux*along_value; py:=csy[i]+uy*along_value;
          values_x:=case when half_value=0 then array[px] else array[px-uy*half_value,px+uy*half_value] end;
          values_y:=case when half_value=0 then array[py] else array[py+ux*half_value,py-ux*half_value] end;
        end if;
      end if;
    end if;
    if coalesce(array_length(values_x,1),0)>0 then for ordinal in 1..array_length(values_x,1) loop
      px:=values_x[ordinal]; py:=values_y[ordinal]; accepted:=true; parameters:=array[]::double precision[];
      foreach k in array array[i,j] loop
        error_value:=epsilon*greatest(1,abs(px),abs(py),abs(xs[k]),abs(ys[k]),abs(xs[ends[k]]),abs(ys[ends[k]]),abs(csx[k]),abs(csy[k]));
        if sqrt(power(px-xs[k],2)+power(py-ys[k],2))<=epsilon*greatest(1,abs(px),abs(py),abs(xs[k]),abs(ys[k])) then parameter_value:=0;
        elsif sqrt(power(px-xs[ends[k]],2)+power(py-ys[ends[k]],2))<=epsilon*greatest(1,abs(px),abs(py),abs(xs[ends[k]]),abs(ys[ends[k]])) then parameter_value:=1;
        elsif radii[k]>0 then
          if abs(sqrt(power(px-csx[k],2)+power(py-csy[k],2))-radii[k])>error_value+epsilon*greatest(1,radii[k]) then accepted:=false; exit; end if;
          vx:=xs[k]-csx[k]; vy:=ys[k]-csy[k]; wx:=px-csx[k]; wy:=py-csy[k]; angle_value:=atan2(vx*wy-vy*wx,vx*wx+vy*wy);
          angle_value:=angle_value*dirs[k]+tau; angle_value:=angle_value-floor(angle_value/tau)*tau; parameter_value:=angle_value*dirs[k]/sweeps[k];
        else
          vx:=xs[ends[k]]-xs[k]; vy:=ys[ends[k]]-ys[k]; length_value:=sqrt(vx*vx+vy*vy);
          if abs(vx*(py-ys[k])-vy*(px-xs[k]))>error_value*length_value then accepted:=false; exit; end if;
          parameter_value:=((px-xs[k])*vx+(py-ys[k])*vy)/(vx*vx+vy*vy);
        end if;
        if parameter_value< -epsilon*greatest(1,abs(parameter_value)) or parameter_value>1+epsilon*greatest(1,abs(parameter_value)) then accepted:=false; exit; end if;
        parameters:=array_append(parameters,greatest(0,least(1,parameter_value)));
      end loop;
      if accepted then
        if owners[i]=owners[j] then
          if not ((j=i+1 and sqrt(power(px-xs[ends[i]],2)+power(py-ys[ends[i]],2))<=epsilon*greatest(1,abs(px),abs(py),abs(xs[ends[i]]),abs(ys[ends[i]])))
            or (i=starts[owners[i]] and j=finishes[owners[i]] and sqrt(power(px-xs[i],2)+power(py-ys[i],2))<=epsilon*greatest(1,abs(px),abs(py),abs(xs[i]),abs(ys[i])))) then return false; end if;
        else
          stop_key:=i||'.'||owners[j]; all_stops:=jsonb_set(all_stops,array[stop_key],coalesce(all_stops->stop_key,'[]'::jsonb)||to_jsonb(parameters[1]));
          stop_key:=j||'.'||owners[i]; all_stops:=jsonb_set(all_stops,array[stop_key],coalesce(all_stops->stop_key,'[]'::jsonb)||to_jsonb(parameters[2]));
        end if;
      end if;
    end loop; end if;
  end loop; end loop;

  -- 每个解析开子边对其它环的位置恒定；按真实圆弧水平射线算绕数与嵌套。
  for i in 1..n loop for owner_b in 1..m loop
    owner_a:=owners[i]; if owner_a=owner_b then continue; end if;
    stop_key:=i||'.'||owner_b;
    select array_agg(value order by value) into stops from (select distinct (value#>>'{}')::double precision as value
      from jsonb_array_elements(coalesce(all_stops->stop_key,'[]'::jsonb)||'[0,1]'::jsonb)) as stop_values;
    for q in 2..array_length(stops,1) loop
      if stops[q]=stops[q-1] then continue; end if; parameter_value:=(stops[q]+stops[q-1])/2;
      if radii[i]=0 then px:=xs[i]+(xs[ends[i]]-xs[i])*parameter_value; py:=ys[i]+(ys[ends[i]]-ys[i])*parameter_value;
      else
        angle_value:=sweeps[i]*parameter_value; vx:=xs[i]-csx[i]; vy:=ys[i]-csy[i];
        px:=csx[i]+vx*cos(angle_value)-vy*sin(angle_value); py:=csy[i]+vx*sin(angle_value)+vy*cos(angle_value);
      end if;
      winding:=0; boundary:=false;
      for k in starts[owner_b]..finishes[owner_b] loop
        vx:=xs[ends[k]]-xs[k]; vy:=ys[ends[k]]-ys[k];
        error_value:=epsilon*greatest(1,abs(px),abs(py),abs(xs[k]),abs(ys[k]),abs(xs[ends[k]]),abs(ys[ends[k]]),abs(csx[k]),abs(csy[k]));
        accepted:=false;
        if radii[k]=0 then
          length_value:=sqrt(vx*vx+vy*vy); parameter_value:=((px-xs[k])*vx+(py-ys[k])*vy)/(vx*vx+vy*vy);
          accepted:=abs(vx*(py-ys[k])-vy*(px-xs[k]))<=error_value*length_value;
        else
          accepted:=abs(sqrt(power(px-csx[k],2)+power(py-csy[k],2))-radii[k])<=error_value+epsilon*greatest(1,radii[k]);
          vx:=xs[k]-csx[k]; vy:=ys[k]-csy[k]; wx:=px-csx[k]; wy:=py-csy[k];
          if sqrt(power(px-xs[k],2)+power(py-ys[k],2))<=epsilon*greatest(1,abs(px),abs(py),abs(xs[k]),abs(ys[k])) then parameter_value:=0;
          elsif sqrt(power(px-xs[ends[k]],2)+power(py-ys[ends[k]],2))<=epsilon*greatest(1,abs(px),abs(py),abs(xs[ends[k]]),abs(ys[ends[k]])) then parameter_value:=1;
          else angle_value:=atan2(vx*wy-vy*wx,vx*wx+vy*wy)*dirs[k]+tau; angle_value:=angle_value-floor(angle_value/tau)*tau; parameter_value:=angle_value*dirs[k]/sweeps[k]; end if;
        end if;
        if accepted and parameter_value>=-epsilon*greatest(1,abs(parameter_value)) and parameter_value<=1+epsilon*greatest(1,abs(parameter_value)) then boundary:=true; exit; end if;
        if radii[k]=0 then
          upward:=ys[k]<=py and ys[ends[k]]>py; downward:=ys[ends[k]]<=py and ys[k]>py;
          if upward or downward then
            cross_x:=xs[k]+(py-ys[k])*(xs[ends[k]]-xs[k])/(ys[ends[k]]-ys[k]);
            if cross_x>px then winding:=winding+case when upward then 1 else -1 end; end if;
          end if;
        else
          arc_stops:=array[0::double precision,1::double precision]; vx:=xs[k]-csx[k]; vy:=ys[k]-csy[k];
          for h in -1..1 by 2 loop
            angle_value:=atan2(vx*h*radii[k],vy*h*radii[k])*dirs[k]+tau; angle_value:=angle_value-floor(angle_value/tau)*tau; parameter_value:=angle_value*dirs[k]/sweeps[k];
            if parameter_value>0 and parameter_value<1 then arc_stops:=array_append(arc_stops,parameter_value); end if;
          end loop;
          select array_agg(value order by value) into arc_stops from (select distinct unnest(arc_stops) as value) as arc_stop_values;
          for h in 2..array_length(arc_stops,1) loop
            t0:=arc_stops[h-1]; t1:=arc_stops[h]; tmid:=(t0+t1)/2;
            y0:=case when t0=0 then ys[k] when t0=1 then ys[ends[k]] else csy[k]+vx*sin(sweeps[k]*t0)+vy*cos(sweeps[k]*t0) end;
            y1:=case when t1=0 then ys[k] when t1=1 then ys[ends[k]] else csy[k]+vx*sin(sweeps[k]*t1)+vy*cos(sweeps[k]*t1) end;
            upward:=y0<=py and y1>py; downward:=y1<=py and y0>py;
            if upward or downward then
              root_value:=sqrt(greatest(0,(radii[k]-abs(py-csy[k]))*(radii[k]+abs(py-csy[k]))));
              mx:=csx[k]+vx*cos(sweeps[k]*tmid)-vy*sin(sweeps[k]*tmid);
              cross_x:=csx[k]+case when mx>=csx[k] then root_value else -root_value end;
              if cross_x>px then winding:=winding+case when upward then 1 else -1 end; end if;
            end if;
          end loop;
        end if;
      end loop;
      if not boundary then
        ordinal:=(owner_a-1)*m+owner_b; relation[ordinal]:=relation[ordinal] | case when winding=0 then 2 else 1 end;
      end if;
    end loop;
  end loop; end loop;
  area_value:=0;
  for i in 1..m loop
    depth:=0;
    for j in 1..m loop if i<>j then
      mask_value:=relation[(i-1)*m+j]; if mask_value=0 or mask_value=3 then return false; end if; if mask_value=1 then depth:=depth+1; end if;
    end if; end loop;
    if (areas[i]>0) is distinct from (depth%2=0) then return false; end if;
    area_value:=area_value+areas[i];
  end loop;
  return area_value>0;
exception when others then return false; end;
$$;

create function public.tool_plane_overlap_curves_state_is_valid(s jsonb)
returns boolean language plpgsql immutable set search_path = pg_catalog,public as $$
declare
  p jsonb:=s->'params'; pts jsonb:=s->'points'; f jsonb:=s->'flags'; entry record; at jsonb;
  ids integer[]; id integer; kind integer; loops integer; circles integer; i integer; j integer; count_value integer; size_value integer; arc_value integer;
  total_points integer:=0; total_circles integer:=0; total_loops integer:=0; used integer[];
  keys_p text[]:=array['nextId','active','pairA','pairB','region','vertex']; keys_pt text[]:=array[]::text[]; keys_f text[]:=array['grid','measures','guides','ghost','edit'];
  vertices jsonb; supports jsonb; counts jsonb; arcs jsonb; radius_value double precision; area_value double precision; term double precision; compensation double precision; adjusted double precision; temporary double precision;
  ax double precision; ay double precision; bx double precision; by_value double precision; ox double precision; oy double precision;
begin
  if public.tool_space_keys(s,array['sceneId','params','points','flags','marks','phase'],array['sceneId','params','points','flags','marks','phase']) is not true
    or s->>'sceneId' is distinct from '33-curves' or public.tool_space_number(s->'phase',0,0) is not true or s->'marks' is distinct from '[]'::jsonb
    or jsonb_typeof(p) is distinct from 'object' or jsonb_typeof(pts) is distinct from 'object' or jsonb_typeof(f) is distinct from 'object'
    or (select count(*) from jsonb_object_keys(p))>256 or (select count(*) from jsonb_object_keys(pts))>256
    or public.tool_space_number(p->'nextId',1,99999,true) is not true or public.tool_space_number(p->'active',-1,99998,true) is not true
    or public.tool_space_number(p->'pairA',-1,99998,true) is not true or public.tool_space_number(p->'pairB',-1,99998,true) is not true
    or public.tool_space_number(p->'region',0,4,true) is not true or public.tool_space_number(p->'vertex',0,191,true) is not true
    or exists(select 1 from jsonb_each(f) where jsonb_typeof(value)<>'boolean') then return false; end if;
  select coalesce(array_agg(substring(key from 6)::integer order by substring(key from 6)::integer),array[]::integer[]) into ids
    from jsonb_object_keys(p) as names(key) where key ~ '^kind\.(0|[1-9][0-9]{0,4})$';
  if cardinality(ids)>16 or exists(select 1 from unnest(ids) as value where value>=(p->>'nextId')::numeric) then return false; end if;
  foreach id in array array[(p->>'active')::numeric::integer,(p->>'pairA')::numeric::integer,(p->>'pairB')::numeric::integer] loop
    if id<>-1 and not id=any(ids) then return false; end if;
  end loop;
  if (p->>'pairA')::numeric>=0 and p->'pairA'=p->'pairB' then return false; end if;
  for entry in select * from jsonb_each(pts) loop
    if public.tool_space_keys(entry.value,array['x','y'],array['x','y']) is not true or public.tool_space_number(entry.value->'x',-4000,4000) is not true
      or public.tool_space_number(entry.value->'y',-4000,4000) is not true then return false; end if;
  end loop;
  foreach id in array ids loop
    if public.tool_space_number(p->('kind.'||id),0,2,true) is not true or public.tool_space_number(p->('angle.'||id),-180,180) is not true
      or public.tool_space_number(p->('flip.'||id),-1,1,true) is not true or abs((p->>('flip.'||id))::numeric)<>1
      or public.tool_space_number(p->('loops.'||id),1,32,true) is not true or public.tool_space_number(p->('circles.'||id),0,32,true) is not true then return false; end if;
    kind:=(p->>('kind.'||id))::numeric::integer; loops:=(p->>('loops.'||id))::numeric::integer; circles:=(p->>('circles.'||id))::numeric::integer;
    keys_p:=keys_p||array['kind.'||id,'angle.'||id,'flip.'||id,'loops.'||id,'circles.'||id]; keys_pt:=keys_pt||array['origin.'||id,'home.'||id]; keys_f:=array_append(keys_f,'reference.'||id);
    if pts->('origin.'||id) is null or pts->('home.'||id) is null then return false; end if;
    vertices:='[]'::jsonb; supports:='[]'::jsonb; counts:='[]'::jsonb; arcs:='[]'::jsonb; used:=array[]::integer[]; count_value:=0;
    if circles>0 then for i in 0..circles-1 loop
      keys_p:=array_append(keys_p,'radius.'||id||'.'||i); keys_pt:=array_append(keys_pt,'circle.'||id||'.'||i);
      if public.tool_space_number(p->('radius.'||id||'.'||i),4,1600) is not true or pts->('circle.'||id||'.'||i) is null then return false; end if;
      supports:=supports||jsonb_build_array((pts->('circle.'||id||'.'||i))||jsonb_build_object('r',p->('radius.'||id||'.'||i)));
    end loop; end if;
    for i in 0..loops-1 loop
      keys_p:=array_append(keys_p,'count.'||id||'.'||i);
      if public.tool_space_number(p->('count.'||id||'.'||i),2,192,true) is not true then return false; end if;
      size_value:=(p->>('count.'||id||'.'||i))::numeric::integer; counts:=counts||to_jsonb(size_value);
      if count_value+size_value+total_points>192 then return false; end if;
      for j in 0..size_value-1 loop
        keys_pt:=array_append(keys_pt,'vertex.'||id||'.'||count_value); at:=pts->('vertex.'||id||'.'||count_value); if at is null then return false; end if;
        vertices:=vertices||jsonb_build_array(at); arc_value:=0;
        if p ? ('arc.'||id||'.'||count_value) then
          keys_p:=array_append(keys_p,'arc.'||id||'.'||count_value);
          if public.tool_space_number(p->('arc.'||id||'.'||count_value),-circles,circles,true) is not true then return false; end if;
          arc_value:=(p->>('arc.'||id||'.'||count_value))::numeric::integer; if arc_value=0 then return false; end if;
          if not abs(arc_value)=any(used) then used:=array_append(used,abs(arc_value)); end if;
        end if;
        arcs:=arcs||to_jsonb(arc_value); count_value:=count_value+1;
      end loop;
    end loop;
    if cardinality(used)<>circles or (kind=0 and (circles<>0 or loops<>1 or count_value<3 or count_value>32)) then return false; end if;
    if public.tool_plane_overlap_curves_region_is_valid(jsonb_build_object('vertices',vertices,'circles',supports,'counts',counts,'arcs',arcs)) is not true then return false; end if;
    if kind=0 then
      area_value:=0; compensation:=0; ox:=(vertices->0->>'x')::double precision; oy:=(vertices->0->>'y')::double precision;
      for i in 0..count_value-1 loop
        j:=(i+1)%count_value; ax:=(vertices->i->>'x')::double precision; ay:=(vertices->i->>'y')::double precision; bx:=(vertices->j->>'x')::double precision; by_value:=(vertices->j->>'y')::double precision;
        if sqrt(power(bx-ax,2)+power(by_value-ay,2))<1 then return false; end if;
        term:=((ax-ox)*(by_value-oy)-(ay-oy)*(bx-ox))/2; adjusted:=term-compensation; temporary:=area_value+adjusted; compensation:=(temporary-area_value)-adjusted; area_value:=temporary;
      end loop;
      if area_value<=1 then return false; end if;
    elsif kind=1 then
      radius_value:=(p->>('radius.'||id||'.0'))::double precision;
      if circles<>1 or loops<>1 or count_value<>2 or arcs<>'[1,1]'::jsonb
        or (supports->0->>'x')::double precision<>0 or (supports->0->>'y')::double precision<>0
        or (vertices->0->>'x')::double precision<>radius_value or (vertices->0->>'y')::double precision<>0
        or (vertices->1->>'x')::double precision<>-radius_value or (vertices->1->>'y')::double precision<>0 then return false; end if;
    end if;
    total_points:=total_points+count_value; total_circles:=total_circles+circles; total_loops:=total_loops+loops;
  end loop;
  return total_points<=192 and total_circles<=32 and total_loops<=32 and public.tool_space_keys(p,keys_p,keys_p)
    and public.tool_space_keys(pts,keys_pt,keys_pt) and public.tool_space_keys(f,keys_f,keys_f);
exception when others then return false; end;
$$;

create function public.tool_plane_overlap_curves_scene_is_valid(s jsonb)
returns boolean language plpgsql immutable set search_path = pg_catalog,public as $$
declare title_value text; utf16_length integer;
begin
  if s->>'toolId' is distinct from 'plane-overlap' or s->>'contentVersion' is distinct from 'plane-overlap-lesson-v4'
    or public.tool_space_keys(s,array['toolId','contentVersion','payload'],array['toolId','contentVersion','payload']) is not true
    or public.tool_space_keys(s->'payload',array['title','initial'],array['title','initial']) is not true
    or jsonb_typeof(s#>'{payload,title}') is distinct from 'string' or octet_length(s::text)>150000 then return false; end if;
  title_value:=btrim(s#>>'{payload,title}',chr(9)||chr(10)||chr(11)||chr(12)||chr(13)||chr(32)||chr(160)||chr(5760)||chr(8192)||chr(8193)||chr(8194)||chr(8195)||chr(8196)||chr(8197)||chr(8198)||chr(8199)||chr(8200)||chr(8201)||chr(8202)||chr(8232)||chr(8233)||chr(8239)||chr(8287)||chr(12288)||chr(65279));
  if title_value='' then return false; end if;
  select coalesce(sum(case when octet_length(codepoint)>3 then 2 else 1 end),0)::integer into utf16_length from regexp_split_to_table(title_value,'') as characters(codepoint);
  return utf16_length between 1 and 80 and public.tool_plane_overlap_curves_state_is_valid(s#>'{payload,initial}');
exception when others then return false; end;
$$;

revoke all on function public.tool_plane_overlap_curves_region_is_valid(jsonb) from public,anon,authenticated,service_role;
revoke all on function public.tool_plane_overlap_curves_state_is_valid(jsonb) from public,anon,authenticated,service_role;
revoke all on function public.tool_plane_overlap_curves_scene_is_valid(jsonb) from public,anon,authenticated,service_role;

commit;
