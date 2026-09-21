-- 旋转成体领域校验；统一 Tools 目录与公共写入口由本批接入迁移登记。
begin;
create function public.tool_solid_revolution_scene_is_valid(s jsonb)
returns boolean language plpgsql immutable set search_path = pg_catalog,public as $$
declare i jsonb := s#>'{payload,initial}'; key text;
begin
  if not coalesce(s->>'toolId'='solid-revolution' and s->>'contentVersion'='solid-revolution-lesson-v1'
    and i->>'shape' in ('rectangle','right-triangle') and i->>'axis' in ('height','width')
    and i->>'view' in ('angle','front','left','right','top','bottom'),false) then return false; end if;
  if not public.tool_space_keys(s,array['toolId','contentVersion','payload'],array['toolId','contentVersion','payload'])
    or s->>'toolId'<>'solid-revolution' or s->>'contentVersion'<>'solid-revolution-lesson-v1'
    or not public.tool_space_keys(s->'payload',array['title','initial'],array['title','initial'])
    or jsonb_typeof(s#>'{payload,title}')<>'string' or char_length(btrim(s#>>'{payload,title}')) not between 1 and 80
    or not public.tool_space_keys(i,array['shape','axis','width','height','angle','speed','showSweep','showStart','showMeasures','axes','grid','view'],array['shape','axis','width','height','angle','speed','showSweep','showStart','showMeasures','axes','grid','view'])
    or i->>'shape' not in ('rectangle','right-triangle') or i->>'axis' not in ('height','width')
    or i->>'view' not in ('angle','front','left','right','top','bottom')
    or not public.tool_space_number(i->'width',0.5,6) or not public.tool_space_number(i->'height',0.5,6)
    or not public.tool_space_number(i->'angle',0,360)
    or jsonb_typeof(i->'speed')<>'number' or i->'speed' not in ('15'::jsonb,'30'::jsonb,'60'::jsonb) then return false; end if;
  foreach key in array array['showSweep','showStart','showMeasures','axes','grid'] loop
    if jsonb_typeof(i->key)<>'boolean' then return false; end if;
  end loop;
  return true;
exception when others then return false; end;
$$;
revoke all on function public.tool_solid_revolution_scene_is_valid(jsonb) from public,anon,authenticated,service_role;
notify pgrst, 'reload schema';
commit;
