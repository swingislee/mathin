-- 由 renewal-workbench.mjs 在整体回滚事务内执行，身份来自固定开发 manifest。
do $tests$
declare
  v_admin uuid := nullif(current_setting('mathin.assertion.admin', true), '')::uuid;
  v_other uuid := nullif(current_setting('mathin.assertion.other', true), '')::uuid;
  v_cycle uuid; v_membership uuid; v_id uuid; v_response jsonb;
  v_students bigint; v_enrollments bigint; v_events bigint; v_rejected boolean;
  v_next timestamptz := date_trunc('minute', now()) + interval '2 days';
begin
  if v_admin is null or v_other is null then raise exception 'FIXED_IDENTITIES_REQUIRED'; end if;
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  select c.id, e.source_class_membership_id into v_cycle, v_membership
    from public.renewal_cycles c join public.renewal_cycle_entries e on e.renewal_cycle_id = c.id
    left join public.course_opportunities o on o.id = e.opportunity_id
    where c.name = 'P5验收 · 暑期衔接→秋季续报' and c.status = 'open' and o.stage is distinct from 'enrolled'
    order by e.opportunity_id nulls first, e.source_class_membership_id limit 1;
  if v_cycle is null then raise exception 'EXISTING_RENEWAL_DEMO_REQUIRED'; end if;
  select count(*) into v_students from public.students;
  execute 'set local role authenticated';
  v_response := public.save_renewal_workbench_v1(v_cycle,v_membership,0,'considering','Conversation note','parent_meeting',array['winter','spring'],v_next,null,null,null,null);
  v_id := (v_response#>>'{record,opportunityId}')::uuid;
  if v_response->>'stage' <> 'considering' or v_response#>>'{record,revision}' <> '1'
    or v_response#>'{record,seasons}' <> '["winter","spring"]'::jsonb
    or (v_response->>'nextContactAt')::timestamptz <> v_next
    or v_response#>>'{record,contactMethod}' <> 'parent_meeting'
    or v_response->'payment' <> 'null'::jsonb then raise exception 'FOLLOWUP_ROUNDTRIP_FAILED'; end if;
  if exists(select 1 from public.course_enrollments where opportunity_id = v_id) then raise exception 'INTENT_CREATED_ENROLLMENT'; end if;
  if (select revision from public.renewal_workbench_details where opportunity_id = v_id) <> 1 then raise exception 'RLS_OWNER_CANNOT_READ'; end if;

  v_rejected := false;
  begin perform public.save_renewal_workbench_v1(v_cycle,v_membership,0,'considering','Stale',null,'{}',null,null,null,null,null);
  exception when others then if sqlerrm <> 'RENEWAL_WORKBENCH_CONFLICT' then raise; end if; v_rejected := true; end;
  if not v_rejected then raise exception 'STALE_WRITE_ALLOWED'; end if;
  v_rejected := false;
  begin perform public.save_renewal_workbench_v1(v_cycle,v_membership,1,'paid','Missing actual date',null,'{}',null,2,3200,null,'wechat');
  exception when others then if sqlerrm <> 'VALIDATION' then raise; end if; v_rejected := true; end;
  if not v_rejected then raise exception 'PAYMENT_WITHOUT_DATE_ALLOWED'; end if;
  v_rejected := false;
  begin perform public.save_renewal_workbench_v1(v_cycle,v_membership,1,'considering','Invalid seasons',null,array['winter','winter'],null,null,null,null,null);
  exception when others then if sqlerrm <> 'VALIDATION' then raise; end if; v_rejected := true; end;
  if not v_rejected then raise exception 'DUPLICATE_SEASONS_ALLOWED'; end if;
  v_rejected := false;
  begin perform public.save_renewal_workbench_v1(v_cycle,v_membership,1,'considering','Unexpected money',null,'{}',null,1,1,null,null);
  exception when others then if sqlerrm <> 'VALIDATION' then raise; end if; v_rejected := true; end;
  if not v_rejected then raise exception 'NONPAYMENT_MONEY_ALLOWED'; end if;

  v_response := public.save_renewal_workbench_v1(v_cycle,v_membership,1,'payment_pending','Parent intends to renew','phone',array['spring'],v_next,null,null,null,null);
  if v_response->>'stage' <> 'payment_pending' or exists(select 1 from public.course_enrollments where opportunity_id = v_id) then raise exception 'INTENT_NOT_SEPARATE'; end if;
  v_response := public.save_renewal_workbench_v1(v_cycle,v_membership,2,'registered','Confirm enrollment','individual',array['winter','spring'],v_next,null,null,null,null);
  select count(*) into v_enrollments from public.course_enrollments where opportunity_id = v_id;
  if v_response->>'stage' <> 'enrolled' or v_response->'payment' <> 'null'::jsonb or v_enrollments <> 1 then raise exception 'ENROLLMENT_NOT_SEPARATE'; end if;
  v_response := public.save_renewal_workbench_v1(v_cycle,v_membership,3,'registered',repeat('"',2000),'wechat',array['winter','spring'],v_next,null,null,null,null);
  if length(v_response->>'note') <> 2000 or (select count(*) from public.course_enrollments where opportunity_id=v_id) <> v_enrollments then raise exception 'ENROLLMENT_NOTE_OR_DUPLICATION'; end if;
  v_response := public.save_renewal_workbench_v1(v_cycle,v_membership,4,'paid','Actual payment','parent_meeting',array['winter','spring'],v_next,2,3200.50,'2026-09-01','wechat');
  if v_response#>>'{record,paidOn}' <> '2026-09-01' or v_response#>>'{record,paymentMethod}' <> 'wechat'
    or (v_response#>>'{payment,paid_amount}')::numeric <> 3200.50 or v_response#>>'{payment,period_count}' <> '2'
    or v_response->'nextContactAt' <> 'null'::jsonb
    or (select next_action_at from public.course_opportunities where id=v_id) is not null then raise exception 'PAYMENT_ROUNDTRIP_FAILED'; end if;
  v_response := public.save_renewal_workbench_v1(v_cycle,v_membership,5,'paid',repeat('"',2000),'parent_meeting',array['spring'],null,3,4800,'2026-09-02','cash');
  if (select count(*) from public.course_enrollments where opportunity_id=v_id) <> v_enrollments
    or length(v_response#>>'{payment,note}') <> 2000 or v_response#>>'{record,revision}' <> '6' then raise exception 'PAYMENT_UPDATE_LOST_FACTS'; end if;
  select count(*) into v_events from public.course_opportunity_events where opportunity_id=v_id;
  v_rejected := false;
  begin perform public.save_renewal_workbench_v1(v_cycle,v_membership,6,'registered','Remove payment',null,'{}',null,null,null,null,null);
  exception when others then if sqlerrm <> 'OPPORTUNITY_ENROLLED' then raise; end if; v_rejected := true; end;
  if not v_rejected then raise exception 'PAYMENT_REMOVAL_ALLOWED'; end if;
  v_rejected := false;
  begin perform public.save_renewal_workbench_v1(v_cycle,v_membership,6,'not_enrolled','Undo enrollment',null,'{}',null,null,null,null,null);
  exception when others then if sqlerrm <> 'OPPORTUNITY_ENROLLED' then raise; end if; v_rejected := true; end;
  if not v_rejected then raise exception 'ENROLLMENT_REMOVAL_ALLOWED'; end if;
  if (select count(*) from public.course_opportunity_events where opportunity_id=v_id) <> v_events then raise exception 'FAILED_SAVE_APPENDED_EVENTS'; end if;
  v_rejected := false;
  begin update public.renewal_workbench_details set seasons='{}' where opportunity_id=v_id;
  exception when insufficient_privilege then v_rejected := true; end;
  if not v_rejected then raise exception 'DIRECT_WRITE_ALLOWED'; end if;

  perform set_config('request.jwt.claim.sub',v_other::text,true);
  if exists(select 1 from public.renewal_workbench_details where opportunity_id=v_id) then raise exception 'OUTSIDER_RLS_READ_ALLOWED'; end if;
  v_rejected := false;
  begin perform public.save_renewal_workbench_v1(v_cycle,v_membership,6,'paid','Forbidden',null,'{}',null,1,1,'2026-09-02','cash');
  exception when others then if sqlerrm not in ('FORBIDDEN','FORBIDDEN_SCOPE') then raise; end if; v_rejected := true; end;
  if not v_rejected then raise exception 'OUTSIDER_SAVE_ALLOWED'; end if;
  perform set_config('request.jwt.claim.sub','',true);
  v_rejected := false;
  begin perform public.save_renewal_workbench_v1(v_cycle,v_membership,6,'considering','Anonymous',null,'{}',null,null,null,null,null);
  exception when others then if sqlerrm <> 'UNAUTHENTICATED' then raise; end if; v_rejected := true; end;
  if not v_rejected then raise exception 'ANONYMOUS_SAVE_ALLOWED'; end if;
  execute 'reset role';
  if has_table_privilege('anon','public.renewal_workbench_details','select')
    or has_function_privilege('anon','public.save_renewal_workbench_v1(uuid,uuid,integer,text,text,text,text[],timestamptz,integer,numeric,date,text)','execute') then raise exception 'ANONYMOUS_GRANT'; end if;
  if (select count(*) from public.students) <> v_students then raise exception 'IDENTITY_DUPLICATED'; end if;
  raise notice 'Renewal workbench: field roundtrip, intention/enrollment/payment separation, amendments, concurrency, RLS, direct-write and identity checks passed';
end $tests$;
