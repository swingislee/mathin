-- 当前业务读取也检查已恢复后明确归档的范围，因此索引覆盖全部非空身份。
create index history_workflow_scope_student_read on public.history_workflow_scopes(student_id) where student_id is not null;
create index history_workflow_scope_lead_read on public.history_workflow_scopes(lead_id) where lead_id is not null;

-- 工作列表先排除确定不会进入结果的暂停身份，减少逐身份的权限及关联计算。
-- 未完成工作单可以恢复学生或其任一线索；subjects 继续按最终选定的可见线索检查完整条件。
-- 保留现有函数的权限判断、字段合同及协作版本，只替换两个候选数据源。
do $candidate_reads$
declare definition text; student_source text := 'from public.students s where s.deleted_at is null';
  lead_source text := E'from public.leads l\n    where l.student_id is null and view_followup';
begin
  select pg_get_functiondef('public.student_list_facts(text,text,text,text)'::regprocedure) into definition;
  if position('student_candidates as materialized' in definition)>0
    or array_length(string_to_array(definition,'identities as materialized ('),1)<>2
    or array_length(string_to_array(definition,student_source),1)<>2
    or array_length(string_to_array(definition,lead_source),1)<>2 then
    raise exception 'STUDENT_LIST_CANDIDATE_SOURCE_CHANGED';
  end if;
  definition := replace(definition,'identities as materialized (',$candidates$student_candidates as materialized (
    select s.* from public.students s where s.deleted_at is null and (
      p_population='records'
      or not exists(select 1 from paused_subjects p where p.key='student:'||s.id)
      or exists(select 1 from scheduled_subjects w where w.key='student:'||s.id)
      or exists(select 1 from public.leads l join scheduled_subjects w on w.key='lead:'||l.id where l.student_id=s.id)
    )
  ), lead_candidates as materialized (
    select l.* from public.leads l where l.student_id is null and (
      p_population='records'
      or not exists(select 1 from paused_subjects p where p.key='lead:'||l.id)
      or exists(select 1 from scheduled_subjects w where w.key='lead:'||l.id)
    )
  ), identities as materialized ($candidates$);
  -- 候选集已验证删除状态和独立线索条件；此处直接读取，保持后续连接的基数估计。
  definition := replace(definition,student_source||' and (view_all',
    'from student_candidates s where (view_all');
  definition := replace(definition,lead_source,E'from lead_candidates l\n    where view_followup');
  if position('from student_candidates s where' in definition)=0 or position('from lead_candidates l' in definition)=0 then
    raise exception 'STUDENT_LIST_CANDIDATE_PATCH_FAILED';
  end if;
  execute definition;
end;
$candidate_reads$;
