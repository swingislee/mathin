-- 当前业务范围按学生、线索和建档前线索分别匹配，保留历史接续规则。
do $workflow_read_path$
declare
  routine regprocedure := 'public.business_subject_is_current(uuid,uuid)'::regprocedure;
  previous_body text;
  definition text;
  next_body text := $body$
  select not exists (
    select 1 from public.history_workflow_scopes s
      left join public.history_workflow_decisions d on d.key=s.scope_key
      where s.student_id=p_student_id
        and (d.decision='archive' or s.resumed_at is null and coalesce(d.decision,'archive')<>'continue')
    union all
    select 1 from public.history_workflow_scopes s
      left join public.history_workflow_decisions d on d.key=s.scope_key
      where s.lead_id=p_lead_id
        and (d.decision='archive' or s.resumed_at is null and coalesce(d.decision,'archive')<>'continue')
    union all
    select 1 from public.leads l
      join public.history_workflow_scopes s on s.lead_id=l.id
      left join public.history_workflow_decisions d on d.key=s.scope_key
      where l.student_id=p_student_id
        and (d.decision='archive' or s.resumed_at is null and coalesce(d.decision,'archive')<>'continue')
  );
$body$;
begin
  select prosrc,pg_get_functiondef(oid) into strict previous_body,definition from pg_proc where oid=routine;
  if previous_body=next_body then return; end if;
  if md5(previous_body)<>'37760328906cc8b865c96be13b8da12c'
    or array_length(string_to_array(definition,previous_body),1)<>2 then
    raise exception 'WORKFLOW_SUBJECT_READ_DEFINITION_CHANGED';
  end if;
  -- 仅替换已知函数体；owner、ACL、稳定性和固定 search_path 保持。
  execute replace(definition,previous_body,next_body);
end;
$workflow_read_path$;
