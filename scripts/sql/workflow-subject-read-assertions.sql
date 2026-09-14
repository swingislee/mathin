-- 仅在已核对的隔离开发库事务内改变既有样本；外层 SAVEPOINT 恢复全部内容。
do $edges$
declare sid uuid; lids uuid[]; actor uuid; resumed boolean; decision text; pair record;
begin
  select id into strict actor from auth.users where email='test-admin@mathin.local';
  select id into strict sid from public.students where deleted_at is null order by id limit 1;
  select array_agg(id) into lids from (select id from public.leads order by id limit 2) l;
  if cardinality(lids)<>2 then raise exception 'EXISTING_LEADS_REQUIRED';end if;
  update public.leads set student_id=sid where id=any(lids);
  insert into public.history_workflow_scopes(student_id,lead_id,reason,current_period,source_ids,source_filename,source_sha256)
    values(sid,null,'processed_prior_period','2026-09','{}','workflow-read-check',repeat('0',64)),
      (null,lids[1],'processed_prior_period','2026-09','{}','workflow-read-check',repeat('0',64)),
      (null,lids[2],'processed_prior_period','2026-09','{}','workflow-read-check',repeat('0',64))
    on conflict(scope_key) do nothing;
  foreach resumed in array array[false,true] loop
    update public.history_workflow_scopes set resumed_at=case when resumed then now() else null end where student_id=sid or lead_id=any(lids);
    foreach decision in array array['archive','continue'] loop
      insert into public.history_workflow_decisions(key,decision,note,actor_id)
        select scope_key,decision,'workflow-read-check',actor from public.history_workflow_scopes where student_id=sid or lead_id=any(lids)
        on conflict(key) do update set decision=excluded.decision;
      for pair in select * from (values (sid,null::uuid),(null::uuid,lids[1]),(sid,lids[1]),(sid,lids[2]),(null::uuid,null::uuid)) p(student_id,lead_id) loop
        if public.business_subject_is_current(pair.student_id,pair.lead_id) is distinct from pg_temp.workflow_original(pair.student_id,pair.lead_id) then raise exception 'HISTORY_DECISION_SCOPE_CHANGED';end if;
      end loop;
    end loop;
  end loop;
  -- 一个建档前线索继续、另一个归档时，学生仍由归档事实约束。
  update public.history_workflow_decisions set decision='archive' where key='lead:'||lids[2];
  if public.business_subject_is_current(sid,null) or pg_temp.workflow_original(sid,null) then raise exception 'LINKED_ARCHIVE_IGNORED';end if;
  if not public.business_subject_is_current(null,null) then raise exception 'NULL_SUBJECT_CHANGED';end if;
end;
$edges$;
