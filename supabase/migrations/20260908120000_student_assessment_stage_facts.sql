-- 已到场的旧测评可用文字反馈确认测评经历；分数与等级继续保留原始值。
create function public.student_assessment_is_complete(
  p_status text,p_completed_at timestamptz,p_finalized_at timestamptz,p_source text,
  p_score numeric,p_band text,p_strengths text,p_feedback text
) returns boolean language sql immutable set search_path=public,pg_temp as $$
  select coalesce(p_status not in ('no_show','cancelled') and (
    p_completed_at is not null or p_finalized_at is not null
    or p_source='legacy' and (
      p_score is not null or p_band is not null
      or p_strengths ~ '(^|[\r\n])(原测评等级|学习力测评等级)：'
      or p_status='attended' and not public.student_list_is_blank(p_feedback)
    )
  ),false);
$$;
revoke all on function public.student_assessment_is_complete(text,timestamptz,timestamptz,text,numeric,text,text,text)
  from public,anon,authenticated,service_role;

-- 在现有授权与来源关联内替换测评判定，保留各入口的当前/历史范围和列表查询计划。
do $alignment$
declare definition text; target record; matches integer;
  old_predicate text:=$pattern$r\.status not in \('no_show','cancelled'\)[[:space:]]+and[[:space:]]+\(r\.assessment_completed_at is not null or a\.result_finalized_at is not null[[:space:]]+or $pattern$;
  legacy_predicate text:=$pattern$a\.result_source='legacy' and[[:space:]]*\(a\.score is not null or a\.assessment_band is not null[[:space:]]+or a\.strengths ~ '[^']*原测评等级[^']*'\)$pattern$;
  new_predicate text:=$call$public.student_assessment_is_complete(r.status,r.assessment_completed_at,a.result_finalized_at,
        a.result_source,a.score,a.assessment_band,a.strengths,
        concat_ws(E'\n',a.strengths,a.focus_areas,a.parent_concerns,a.teacher_recommendation,a.teacher_observation))$call$;
begin
  old_predicate:=old_predicate||'(\('||legacy_predicate||'\)|'||legacy_predicate||')\)';
  for target in select * from (values
    ('public.student_stage_index_with_enrollments(text,text,public.business_course_enrollment_subjects[])',1),
    ('public.read_student_stage_subject_with_enrollments(uuid,uuid,public.business_course_enrollment_subjects[])',1),
    ('public.student_record_index_with_enrollments(text,text,public.business_course_enrollment_subjects[])',1),
    ('public.read_student_record_with_enrollments(uuid,uuid,public.business_course_enrollment_subjects[])',1),
    ('public.student_stage_learning_background(uuid,uuid,text,text)',2),
    ('public.student_list_facts(text,text,text,text)',1)
  ) f(signature,expected_matches) loop
    definition:=pg_get_functiondef(target.signature::regprocedure);
    select count(*) into matches from regexp_matches(definition,old_predicate,'g');
    if matches<>target.expected_matches then raise exception 'ASSESSMENT_STAGE_CONTRACT_CHANGED: %',target.signature; end if;
    execute regexp_replace(definition,old_predicate,replace(new_predicate,E'\\',E'\\\\'),'g');
  end loop;

  -- 侧栏读取同一修订后的测评事实，识别测评本身或其参与记录的实际身份关联。
  definition:=pg_get_functiondef('public.get_student_lifecycle(uuid,uuid)'::regprocedure);
  old_predicate:=$pattern$(?s)if exists\(select 1 from public\.(business_)?assessment_results a.*?then return 'awaiting_enrollment'; end if;$pattern$;
  select count(*) into matches from regexp_matches(definition,old_predicate,'g');
  if matches<>1 then raise exception 'ASSESSMENT_LIFECYCLE_CONTRACT_CHANGED'; end if;
  execute regexp_replace(definition,old_predicate,replace($lifecycle$if exists(select 1 from public.business_assessment_results a
    join public.business_activity_registrations r on r.id=a.activity_registration_id
    where (a.student_id=v_student_id or r.student_id=v_student_id
      or a.lead_id=any(v_lead_ids) or r.lead_id=any(v_lead_ids)
      or r.source_record_id in (select h.id from public.history_import_records h
        where h.lead_id=any(v_lead_ids) or h.id in (select source_record_id from public.leads where id=any(v_lead_ids))))
      and $lifecycle$||new_predicate||$lifecycle$)
  then return 'awaiting_enrollment'; end if;$lifecycle$,E'\\',E'\\\\'));
end;
$alignment$;

notify pgrst,'reload schema';
