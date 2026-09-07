-- 工具栏是 v2 固定课件内容；v1 继续保持原结构，已有 revision/release 不改写。
begin;

create or replace function public.cw_cube_structures_tool_is_valid(p_tool jsonb)
returns boolean language plpgsql immutable
set search_path = public, pg_temp
as $cube$
declare
  payload jsonb := p_tool -> 'payload';
  history jsonb := p_tool #> '{payload,history}';
  initial_state jsonb := p_tool #> '{payload,history,initial}';
  toolbar jsonb := p_tool #> '{payload,toolbar}';
  allowed_tools text[] := array[
    'orbit','pan','view-angle','view-front','view-left','view-right','view-top','fit','axis-snap','axes',
    'select','build','remove','color','face','move','layer','cut',
    'mark','number','transparent','recording','undo','redo','reset','metrics'
  ];
begin
  if not coalesce(
    jsonb_typeof(p_tool) = 'object'
    and p_tool ->> 'toolId' = 'spatial-lab'
    and p_tool ->> 'contentVersion' in ('cube-structures-lesson-v1','cube-structures-lesson-v2')
    and p_tool - array['toolId','contentVersion','payload'] = '{}'::jsonb
    and jsonb_typeof(payload) = 'object'
    and payload - (case when p_tool ->> 'contentVersion' = 'cube-structures-lesson-v1' then array['title','history'] else array['title','history','toolbar'] end) = '{}'::jsonb
    and jsonb_typeof(payload -> 'title') = 'string'
    and char_length(btrim(payload ->> 'title')) between 1 and 80
    and octet_length(payload::text) <= 1024000
    and jsonb_typeof(history) = 'object'
    and history - array['version','initial','operations','cursor'] = '{}'::jsonb
    and history ->> 'version' = 'cube-structures-draft-v3'
    and history -> 'cursor' = '0'::jsonb
    and jsonb_typeof(history -> 'operations') = 'array'
    and jsonb_typeof(initial_state) = 'object'
    and jsonb_typeof(initial_state -> 'cubes') = 'array'
    and jsonb_typeof(initial_state -> 'groups') = 'array'
    and jsonb_typeof(initial_state -> 'hiddenCubeIds') = 'array'
    and jsonb_typeof(initial_state -> 'frame') = 'object'
    and jsonb_typeof(initial_state -> 'nextCubeId') = 'number'
    and jsonb_typeof(initial_state -> 'nextNumber') = 'number'
    and jsonb_typeof(initial_state -> 'axesVisible') = 'boolean'
    and jsonb_typeof(initial_state -> 'hiddenEdgesVisible') = 'boolean'
    and initial_state ->> 'view' in ('angle','front','left','right','top'),
    false
  ) then return false; end if;
  if p_tool ->> 'contentVersion' = 'cube-structures-lesson-v2' then
    if not coalesce(jsonb_typeof(toolbar) = 'array', false) then return false; end if;
    if jsonb_array_length(toolbar) > cardinality(allowed_tools)
      or exists (select 1 from jsonb_array_elements(toolbar) item where jsonb_typeof(item.value) <> 'string' or not ((item.value #>> '{}') = any(allowed_tools)))
      or (select count(*) <> count(distinct item.value) from jsonb_array_elements(toolbar) item)
    then return false; end if;
  end if;
  if jsonb_array_length(history -> 'operations') > 256
    or jsonb_array_length(initial_state -> 'cubes') > 512
    or jsonb_array_length(initial_state -> 'hiddenCubeIds') > 512
    or jsonb_array_length(initial_state -> 'groups') > 4096 then return false; end if;
  if exists (
    select 1 from jsonb_array_elements(history -> 'operations') op
    where jsonb_typeof(op.value) <> 'object' or coalesce(op.value ->> 'kind','') not in (
      'build','remove','color','paint','clear-paint','layer','show-all','group','ungroup',
      'move','cut','display-move','display-reset','mark','number','clear-labels',
      'restart-numbering','opacity','hidden-edges','axes','view'
    )
  ) then return false; end if;
  return true;
exception when others then return false;
end;
$cube$;

comment on function public.cw_cube_structures_tool_is_valid(jsonb)
  is 'Composition hard gate for cube lesson v1 and v2; v2 additionally freezes an explicit unique teaching-tool subset. Full geometry is validated by the server schema.';
revoke all on function public.cw_cube_structures_tool_is_valid(jsonb) from public, anon, authenticated;
-- 组合页校验器既有工具分支调用此 helper；入口及其 ACL 继续沿用。
comment on function public.cw_courseware_composition_doc_is_valid(jsonb)
  is 'Structural gate for composition blocks, including cube lesson v1/v2 through cw_cube_structures_tool_is_valid.';
notify pgrst, 'reload schema';
commit;
