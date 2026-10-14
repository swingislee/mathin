-- Assessment grouping needs only identity, group and period columns. Keeping
-- full worklist JSON in source_rows spills its materialized result to disk.
-- Likewise, materialize scalar date values before DISTINCT aggregation so its
-- sort carries dates instead of complete field JSON. Scope checks stay intact.
do $migration$
declare definition text; before_text text; after_text text;
begin
  select pg_get_functiondef('public.school_visible_source_layout(text)'::regprocedure) into definition;
  before_text := $before0$select w.*,coalesce(l.student_id,w.student_id) as resolved_student_id,$before0$;
  after_text := $after0$select w.logical_key,w.source_record_id,w.lead_id,w.kind,w.group_label,w.source_rank,w.periods,w.period_defaults,
      coalesce(l.student_id,w.student_id) as resolved_student_id,$after0$;
  if position(before_text in definition)=0 then raise exception 'ASSESSMENT_NARROW_READ_ANCHOR_1_MISSING'; end if;
  definition := replace(definition,before_text,after_text);
  execute definition;

  select pg_get_functiondef('public.list_assessment_workbench_page(text,text,integer,integer,jsonb,text,jsonb)'::regprocedure) into definition;
  before_text := $before1$  ), date_facets as (
    select f.id,jsonb_build_object('options','[]'::jsonb,'days',coalesce(jsonb_agg(distinct e.fields->f.id->>'day' order by e.fields->f.id->>'day' desc) filter(where e.fields->f.id->>'day' is not null),'[]'::jsonb)) as data
    from unnest(date_fields) f(id) left join evaluated e on e.misses<@array[f.id] group by f.id$before1$;
  after_text := $after1$  ), date_values as materialized (
    select f.id,e.fields->f.id->>'day' as day
    from unnest(date_fields) f(id) left join evaluated e on e.misses<@array[f.id]
  ), date_facets as (
    select id,jsonb_build_object('options','[]'::jsonb,'days',coalesce(jsonb_agg(distinct day order by day desc) filter(where day is not null),'[]'::jsonb)) as data
    from date_values group by id$after1$;
  if position(before_text in definition)=0 then raise exception 'ASSESSMENT_NARROW_READ_ANCHOR_2_MISSING'; end if;
  definition := replace(definition,before_text,after_text);
  execute definition;
end;
$migration$;
