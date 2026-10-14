-- Match source records, students and leads with equality joins instead of a
-- three-way OR over every row and source. Choose narrow source keys before
-- sorting full assessment payloads, retaining the existing priority rules.
-- Carry month/group fields with evaluated rows so counts and pagination reuse
-- that result without repeatedly joining the materialized assessment rows.
do $migration$
declare definition text; before_text text; after_text text;
begin
  select pg_get_functiondef('public.list_assessment_workbench_page(text,text,integer,integer,jsonb,text,jsonb)'::regprocedure) into definition;
  before_text := $before0$select r.* from public.assessment_list_rows(p_state) r$before0$;
  after_text := $after0$select r.*,row_number() over() as source_row from public.assessment_list_rows(p_state) r$after0$;
  if position(before_text in definition)=0 then raise exception 'ASSESSMENT_INITIAL_LOAD_ANCHOR_1_MISSING'; end if;
  definition := replace(definition,before_text,after_text);

  before_text := $before1$  ), placed as materialized (
    select distinct on(r.payload->>'id') r.*,w.logical_key,w.kind,w.group_label,w.subgroup_label,w.group_rank,w.source_rank,w.periods,w.period_defaults
    from base_rows r left join source_layout w on w.source_record_id=r.payload->>'sourceRecordId'
      or (w.student_id::text=r.payload->>'studentId') or (w.lead_id::text=r.payload->>'leadId')$before1$;
  after_text := $after1$  ), source_matches as materialized (
    select r.source_row,r.payload->>'sourceRecordId' as subject_source_id,w.logical_key,w.kind,w.group_label,w.subgroup_label,w.group_rank,w.source_rank,w.periods,w.period_defaults,w.source_record_id
    from base_rows r join source_layout w on w.source_record_id=r.payload->>'sourceRecordId'
    union all
    select r.source_row,r.payload->>'sourceRecordId' as subject_source_id,w.logical_key,w.kind,w.group_label,w.subgroup_label,w.group_rank,w.source_rank,w.periods,w.period_defaults,w.source_record_id
    from base_rows r join source_layout w on w.student_id::text=r.payload->>'studentId'
    union all
    select r.source_row,r.payload->>'sourceRecordId' as subject_source_id,w.logical_key,w.kind,w.group_label,w.subgroup_label,w.group_rank,w.source_rank,w.periods,w.period_defaults,w.source_record_id
    from base_rows r join source_layout w on w.lead_id::text=r.payload->>'leadId'
  ), chosen_source as materialized (
    select distinct on(m.source_row) m.* from source_matches m
    order by m.source_row,case when m.source_record_id=m.subject_source_id then 0 else 1 end,m.group_rank,m.source_rank,m.logical_key
  ), placed as materialized (
    select distinct on(r.payload->>'id') r.*,w.logical_key,w.kind,w.group_label,w.subgroup_label,w.group_rank,w.source_rank,w.periods,w.period_defaults
    from base_rows r left join chosen_source w on w.source_row=r.source_row$after1$;
  if position(before_text in definition)=0 then raise exception 'ASSESSMENT_INITIAL_LOAD_ANCHOR_2_MISSING'; end if;
  definition := replace(definition,before_text,after_text);

  before_text := $before2$fields as materialized (select payload->>'id' as key,default_ordinal,public.assessment_list_fields(payload,p_labels,zone) as fields from rows r)$before2$;
  after_text := $after2$fields as materialized (select payload->>'id' as key,default_ordinal,period,period_rank,group_label,group_rank,public.assessment_list_fields(payload,p_labels,zone) as fields from rows r)$after2$;
  if position(before_text in definition)=0 then raise exception 'ASSESSMENT_INITIAL_LOAD_ANCHOR_3_MISSING'; end if;
  definition := replace(definition,before_text,after_text);

  before_text := $before3$select r.period,count(*)::integer as n,min(r.period_rank) as rank from rows r join evaluated e on e.key=r.payload->>'id'
      where cardinality(e.misses)=0 group by r.period$before3$;
  after_text := $after3$select r.period,count(*)::integer as n,min(r.period_rank) as rank from evaluated r
      where cardinality(r.misses)=0 group by r.period$after3$;
  if position(before_text in definition)=0 then raise exception 'ASSESSMENT_INITIAL_LOAD_ANCHOR_4_MISSING'; end if;
  definition := replace(definition,before_text,after_text);

  before_text := $before4$select r.group_label,count(*)::integer as n,min(r.group_rank) as rank from rows r join evaluated e on e.key=r.payload->>'id'
      where cardinality(e.misses)=0$before4$;
  after_text := $after4$select r.group_label,count(*)::integer as n,min(r.group_rank) as rank from evaluated r
      where cardinality(r.misses)=0$after4$;
  if position(before_text in definition)=0 then raise exception 'ASSESSMENT_INITIAL_LOAD_ANCHOR_5_MISSING'; end if;
  definition := replace(definition,before_text,after_text);

  before_text := $before5$select e.* from evaluated e join rows r on r.payload->>'id'=e.key where cardinality(e.misses)=0
      and (not source_mode or (((select period from source_choice)='all' or r.period=any(string_to_array((select period from source_choice),',')))
        and (source_group='all' or r.group_label=source_group)))$before5$;
  after_text := $after5$select e.* from evaluated e where cardinality(e.misses)=0
      and (not source_mode or (((select period from source_choice)='all' or e.period=any(string_to_array((select period from source_choice),',')))
        and (source_group='all' or e.group_label=source_group)))$after5$;
  if position(before_text in definition)=0 then raise exception 'ASSESSMENT_INITIAL_LOAD_ANCHOR_6_MISSING'; end if;
  definition := replace(definition,before_text,after_text);

  execute definition;
end;
$migration$;
