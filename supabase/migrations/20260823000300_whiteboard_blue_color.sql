begin;

-- M1 数独课堂工具栏：共享白板新增正式 blue token。课堂事件快照本身只校验
-- JSON 大小；备课解析会经过本函数，因此必须同步扩展笔迹、图形描边与填充白名单。
create or replace function public.validate_courseware_annotation_content(p_content jsonb)
returns jsonb language plpgsql immutable set search_path = public, pg_temp as $$
declare
  item jsonb;
  point jsonb;
  item_kind text;
  numeric_value numeric;
begin
  if jsonb_typeof(p_content) <> 'array'
     or jsonb_array_length(p_content) > 5000
     or octet_length(p_content::text) > 2097152 then
    raise exception 'VALIDATION';
  end if;

  for item in select value from jsonb_array_elements(p_content)
  loop
    if jsonb_typeof(item) <> 'object'
       or coalesce(item ->> 'id', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
      raise exception 'VALIDATION';
    end if;

    item_kind := item ->> 'kind';
    if item_kind is null then
      if (item - array['id', 'mode', 'color', 'wNorm', 'points']) <> '{}'::jsonb
         or coalesce(item ->> 'mode', '') not in ('ink', 'erase')
         or coalesce(item ->> 'color', '') not in ('ink', 'rose', 'blue', 'leaf', 'crater', 'cheek', 'moon')
         or coalesce(jsonb_typeof(item -> 'wNorm'), '') <> 'number'
         or coalesce(jsonb_typeof(item -> 'points'), '') <> 'array'
         or jsonb_array_length(item -> 'points') > 10000 then
        raise exception 'VALIDATION';
      end if;
      numeric_value := (item ->> 'wNorm')::numeric;
      if numeric_value <= 0 or numeric_value > 0.1 then raise exception 'VALIDATION'; end if;
      for point in select value from jsonb_array_elements(item -> 'points')
      loop
        if coalesce(jsonb_typeof(point), '') <> 'array'
           or jsonb_array_length(point) <> 2
           or coalesce(jsonb_typeof(point -> 0), '') <> 'number'
           or coalesce(jsonb_typeof(point -> 1), '') <> 'number'
           or (point ->> 0)::numeric < 0 or (point ->> 0)::numeric > 1
           or (point ->> 1)::numeric < 0 or (point ->> 1)::numeric > 1 then
          raise exception 'VALIDATION';
        end if;
      end loop;
    elsif item_kind = 'shape' then
      if (item - array['id', 'kind', 'shape', 'color', 'fill', 'strokeWidthNorm', 'x', 'y', 'width', 'height', 'rotation', 'startAngle', 'sweepAngle']) <> '{}'::jsonb
         or coalesce(item ->> 'shape', '') not in ('line', 'arrow', 'rectangle', 'ellipse', 'triangle', 'rightTriangle', 'diamond', 'pentagon', 'hexagon', 'star', 'arc')
         or coalesce(item ->> 'color', '') not in ('ink', 'rose', 'blue', 'leaf', 'crater', 'cheek', 'moon')
         or not (item ? 'fill')
         or not (
           jsonb_typeof(item -> 'fill') = 'null'
           or (
             jsonb_typeof(item -> 'fill') = 'string'
             and item ->> 'fill' in ('ink', 'rose', 'blue', 'leaf', 'crater', 'cheek', 'moon')
           )
         )
         or coalesce(jsonb_typeof(item -> 'strokeWidthNorm'), '') <> 'number'
         or coalesce(jsonb_typeof(item -> 'x'), '') <> 'number'
         or coalesce(jsonb_typeof(item -> 'y'), '') <> 'number'
         or coalesce(jsonb_typeof(item -> 'width'), '') <> 'number'
         or coalesce(jsonb_typeof(item -> 'height'), '') <> 'number'
         or coalesce(jsonb_typeof(item -> 'rotation'), '') <> 'number'
         or (item ? 'startAngle' and coalesce(jsonb_typeof(item -> 'startAngle'), '') <> 'number')
         or (item ? 'sweepAngle' and coalesce(jsonb_typeof(item -> 'sweepAngle'), '') <> 'number') then
        raise exception 'VALIDATION';
      end if;
      if (item ->> 'strokeWidthNorm')::numeric <= 0 or (item ->> 'strokeWidthNorm')::numeric > 0.1
         or (item ->> 'x')::numeric < 0 or (item ->> 'x')::numeric > 1
         or (item ->> 'y')::numeric < 0 or (item ->> 'y')::numeric > 1
         or (item ->> 'width')::numeric <= 0 or (item ->> 'width')::numeric > 1.5
         or (item ->> 'height')::numeric <= 0 or (item ->> 'height')::numeric > 1.5
         or abs((item ->> 'rotation')::numeric) > 100000
         or (item ? 'startAngle' and abs((item ->> 'startAngle')::numeric) > 100000)
         or (item ? 'sweepAngle' and abs((item ->> 'sweepAngle')::numeric) > 100000) then
        raise exception 'VALIDATION';
      end if;
    else
      raise exception 'VALIDATION';
    end if;
  end loop;
  return p_content;
end;
$$;

revoke all on function public.validate_courseware_annotation_content(jsonb) from public, anon, authenticated;

commit;
