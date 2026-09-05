-- 仅在已核对的本机隔离库执行；复用固定开发身份，业务夹具全部事务回滚。
begin;
do $$
declare
  actor uuid; writer uuid; outsider uuid;
  lead_a uuid:=gen_random_uuid(); lead_b uuid:=gen_random_uuid(); lead_unassigned uuid:=gen_random_uuid();
  contact_a uuid:=gen_random_uuid(); contact_b uuid:=gen_random_uuid(); contact_later uuid:=gen_random_uuid();
  activity_id uuid:=gen_random_uuid(); registration_id uuid:=gen_random_uuid();
  invitation_id uuid:=gen_random_uuid(); invitation_event uuid:=gen_random_uuid(); former_author_event uuid:=gen_random_uuid();
  post_id uuid:=gen_random_uuid(); post_later uuid:=gen_random_uuid();
  list_id uuid; own_list uuid; revision_a uuid; revision_b uuid; revision_post uuid; revision_inv uuid;
  original_time timestamptz:=clock_timestamp()-interval '2 hours'; corrected_time timestamptz:=date_trunc('day',now())-interval '2 days';
  result jsonb; rejected boolean; original_count integer; revisions_count integer; saved_completion timestamptz;
begin
  select id into actor from public.profiles where role='admin' and is_active order by created_at,id limit 1;
  select id into writer from public.profiles where role='staff' and is_active
    and public.has_perm(id,'followup.write') and public.has_perm(id,'followup.view') and not public.has_perm(id,'student.view.all')
    order by created_at,id limit 1;
  select id into outsider from public.profiles where role in ('student','parent') and is_active order by created_at,id limit 1;
  if actor is null or writer is null or outsider is null then raise exception 'FIXED_ADMIN_SCOPED_WRITER_AND_OUTSIDER_REQUIRED'; end if;
  perform set_config('request.jwt.claim.sub',actor::text,true);
  perform set_config('request.jwt.claim.role','authenticated',true);
  insert into public.leads(id,provisional_student_name,normalized_name,phone,phone_normalized,grade_hint,owner_id,status,created_by)
    values(lead_a,'Worklist assertion A','worklist assertion a','19999999081','19999999081',4,actor,'contacted',actor),
      (lead_b,'Worklist assertion B','worklist assertion b','19999999082','19999999082',4,writer,'contacted',actor),
      (lead_unassigned,'Worklist assertion unassigned','worklist assertion unassigned','19999999083','19999999083',4,null,'uncontacted',actor);
  insert into public.lead_communications(id,lead_id,channel,outcome,note,wechat_added,visit_committed,interest_level,recorded_by,owner_id_at_contact,occurred_at)
    values(contact_a,lead_a,'phone','connected','Original contact',false,false,'B',actor,actor,original_time),
      (contact_b,lead_b,'phone','connected','Other author',null,null,null,actor,writer,original_time);
  insert into public.activities(id,kind,title,scheduled_at,created_by)
    values(activity_id,'assessment_1v1','Worklist revision assertion',original_time,actor);
  insert into public.activity_registrations(id,activity_id,lead_id,status,operated_by,assessment_started_at,assessment_completed_at)
    values(registration_id,activity_id,lead_b,'attended',actor,original_time,original_time);
  perform public.save_post_activity_contact(registration_id,post_id,'phone','connected','continue_follow_up','Original post',null);

  list_id:=public.create_communication_worklist('Daily fixed list',current_date,array['lead:'||lead_a::text,'post:'||registration_id::text,'lead:'||lead_a::text]);
  result:=public.get_communication_worklist(list_id);
  if result->>'ownerId'<>actor::text or result->>'createdBy'<>actor::text or jsonb_array_length(result->'items')<>2
    or result->'rowKeys'<>jsonb_build_array('lead:'||lead_a::text,'post:'||registration_id::text)
    or (result->'items'->0->>'position')::integer<>1 then raise exception 'WORKLIST_ORDER_OR_DEDUPLICATION_FAILED'; end if;
  perform public.complete_communication_worklist_item(list_id,'lead:'||lead_a::text,true);
  select completed_at into saved_completion from public.communication_worklist_items where worklist_id=list_id and row_key='lead:'||lead_a::text;
  perform public.complete_communication_worklist_item(list_id,'lead:'||lead_a::text,true);
  if saved_completion is null or saved_completion is distinct from (select completed_at from public.communication_worklist_items where worklist_id=list_id and row_key='lead:'||lead_a::text)
    or jsonb_array_length(public.get_communication_worklist(list_id)->'items')<>2 then raise exception 'COMPLETION_REMOVED_OR_CHANGED_MEMBER'; end if;
  perform public.complete_communication_worklist_item(list_id,'lead:'||lead_a::text,false);
  if (select completed_at from public.communication_worklist_items where worklist_id=list_id and row_key='lead:'||lead_a::text) is not null then raise exception 'WORKLIST_REOPEN_FAILED'; end if;

  select count(*) into original_count from public.lead_communications where lead_id=lead_a;
  revision_a:=public.revise_communication_record('contact',contact_a,null,jsonb_build_object('note','Corrected contact','channel','wechat','occurredAt',corrected_time,'wechatAdded',true,'interestLevel','A'));
  revision_b:=public.revise_communication_record('contact',contact_a,revision_a,'{"note":"Second note"}'::jsonb);
  if not exists(select 1 from public.effective_lead_communications where id=contact_a and note='Second note' and channel='wechat'
    and occurred_at=corrected_time and original_occurred_at=original_time and revision_id=revision_b and revised_by=actor and wechat_added is true and interest_level='A' and can_revise) then raise exception 'EFFECTIVE_CONTACT_OVERLAY_FAILED'; end if;
  if not exists(select 1 from public.lead_communications where id=contact_a and note='Original contact' and channel='phone' and occurred_at=original_time and wechat_added is false)
    or (select count(*) from public.lead_communications where lead_id=lead_a)<>original_count then raise exception 'ORIGINAL_CONTACT_OR_COUNT_MUTATED'; end if;
  if not exists(select 1 from public.communication_record_revisions where id=revision_b and previous_revision_id=revision_a and patch='{"note":"Second note"}'::jsonb
    and effective_patch->>'channel'='wechat') then raise exception 'REVISION_DELTA_OR_CHAIN_LOST'; end if;
  rejected:=false;
  begin perform public.revise_communication_record('contact',contact_a,revision_a,'{"note":"Stale edit"}');
    exception when others then if sqlerrm<>'REVISION_CONFLICT' then raise; end if; rejected:=true; end;
  if not rejected then raise exception 'STALE_REVISION_ALLOWED'; end if;
  select count(*) into revisions_count from public.communication_record_revisions where source='contact' and event_id=contact_a;
  rejected:=false;
  begin perform public.revise_communication_record('contact',contact_a,revision_b,'{"recordedBy":"forged"}');
    exception when others then if sqlerrm<>'VALIDATION' then raise; end if; rejected:=true; end;
  if not rejected then raise exception 'UNKNOWN_REVISION_FIELD_ALLOWED'; end if;
  rejected:=false;
  begin perform public.revise_communication_record('contact',contact_a,revision_b,'{"occurredAt":"2026-02-30T12:00:00+08:00"}');
    exception when others then if sqlerrm<>'VALIDATION' then raise; end if; rejected:=true; end;
  if not rejected then raise exception 'INVALID_REVISION_DATE_ALLOWED'; end if;
  rejected:=false;
  begin perform public.revise_communication_record('contact',contact_a,revision_b,'{"outcome":"unreachable"}');
    exception when others then if sqlerrm<>'VALIDATION' then raise; end if; rejected:=true; end;
  if not rejected or (select count(*) from public.communication_record_revisions where source='contact' and event_id=contact_a)<>revisions_count then raise exception 'UNREACHABLE_WECHAT_OR_PARTIAL_REVISION_ALLOWED'; end if;
  revision_b:=public.revise_communication_record('contact',contact_a,revision_b,'{"outcome":"declined"}');
  if (select status from public.leads where id=lead_a)<>'nurture' or (select outcome from public.lead_communications where id=contact_a)<>'connected' then raise exception 'SAFE_LATEST_CONTACT_PROJECTION_FAILED'; end if;
  insert into public.lead_communications(id,lead_id,channel,outcome,note,recorded_by,owner_id_at_contact,occurred_at)
    values(contact_later,lead_a,'phone','connected','Later communication',actor,actor,clock_timestamp());
  update public.leads set status='contacted' where id=lead_a;
  revision_b:=public.revise_communication_record('contact',contact_a,revision_b,jsonb_build_object('outcome','invalid_number','wechatAdded',false,'occurredAt',clock_timestamp()+interval '1 day'));
  if (select status from public.leads where id=lead_a)<>'contacted'
    or (select outcome from public.effective_lead_communications where id=contact_a)<>'invalid_number'
    or (select id from public.effective_lead_communications where lead_id=lead_a order by original_occurred_at desc,id desc limit 1)<>contact_later then raise exception 'HISTORICAL_CONTACT_ROLLED_BACK_CURRENT_STATE'; end if;
  update public.leads set status='invalid' where id=lead_a;
  if jsonb_array_length(public.get_communication_worklist(list_id)->'items')<>2 then raise exception 'STATUS_CHANGE_REMOVED_WORKLIST_MEMBER'; end if;
  update public.leads set status='contacted' where id=lead_a;

  insert into public.lead_invitation_threads(id,lead_id,kind,state,summary,owner_id_at_open,created_by,updated_by)
    values(invitation_id,lead_a,'waiting_activity','waiting_activity','Original invitation',actor,actor,actor);
  insert into public.lead_invitation_events(id,invitation_id,to_state,channel,note,recorded_by,occurred_at)
    values(invitation_event,invitation_id,'waiting_activity','phone','Original invitation',actor,original_time),
      (former_author_event,invitation_id,'waiting_activity','phone','Former owner event',writer,original_time-interval '1 day');
  rejected:=false;
  begin perform public.revise_communication_record('contact',contact_later,null,'{"outcome":"invalid_number"}');
    exception when others then if sqlerrm<>'CORRECTION_REQUIRES_WORKFLOW' then raise; end if; rejected:=true; end;
  if not rejected or (select status from public.leads where id=lead_a)<>'contacted' then raise exception 'LATEST_CONTACT_REVERSED_INVITATION_WORKFLOW'; end if;
  revision_inv:=public.revise_communication_record('invitation',invitation_event,null,jsonb_build_object('note','Corrected invitation','channel','other','occurredAt',corrected_time));
  if not exists(select 1 from public.effective_lead_invitation_events where id=invitation_event and revision_id=revision_inv and note='Corrected invitation'
    and to_state='waiting_activity' and occurred_at=corrected_time and original_occurred_at=original_time)
    or (select note from public.lead_invitation_events where id=invitation_event)<>'Original invitation' then raise exception 'INVITATION_REVISION_FAILED'; end if;
  rejected:=false;
  begin perform public.revise_communication_record('invitation',invitation_event,revision_inv,'{"toState":"confirmed"}');
    exception when others then if sqlerrm<>'VALIDATION' then raise; end if; rejected:=true; end;
  if not rejected or (select state from public.lead_invitation_threads where id=invitation_id)<>'waiting_activity' then raise exception 'INVITATION_STATE_BYPASSED_WORKFLOW'; end if;

  revision_post:=public.revise_communication_record('post_activity',post_id,null,'{"route":"await_product","note":"Corrected post","channel":"wechat"}');
  result:=public.get_activity_enrollment_context(registration_id,null);
  if result->>'route'<>'await_product' or result->'contacts'->0->>'note'<>'Corrected post' or result->'contacts'->0->>'channel'<>'wechat'
    or (select note from public.activity_followup_contacts where id=post_id)<>'Original post' then raise exception 'POST_CONTEXT_NOT_EFFECTIVE_OR_ORIGINAL_MUTATED'; end if;
  perform public.save_post_activity_contact(registration_id,post_later,'phone','connected','closed','Later post',null);
  revision_post:=public.revise_communication_record('post_activity',post_id,revision_post,jsonb_build_object('route','continue_follow_up','outcome','unreachable','occurredAt',clock_timestamp()+interval '1 day'));
  result:=public.get_activity_enrollment_context(registration_id,null);
  if result->>'route'<>'closed' or result->'contacts'->0->>'id'<>post_later::text
    or (select route from public.effective_activity_followup_contacts where id=post_id)<>'continue_follow_up' then raise exception 'POST_REVISION_REVERSED_LATER_ROUTE'; end if;
  rejected:=false;
  begin update public.communication_record_revisions set patch='{"note":"overwrite"}' where id=revision_post;
    exception when others then if sqlerrm<>'COMMUNICATION_REVISION_IMMUTABLE' then raise; end if; rejected:=true; end;
  if not rejected then raise exception 'REVISION_HISTORY_MUTABLE'; end if;
  rejected:=false;
  begin delete from public.communication_record_revisions where id=revision_post;
    exception when others then if sqlerrm<>'COMMUNICATION_REVISION_IMMUTABLE' then raise; end if; rejected:=true; end;
  if not rejected then raise exception 'REVISION_HISTORY_DELETABLE'; end if;

  perform set_config('request.jwt.claim.sub',writer::text,true);
  own_list:=public.create_communication_worklist('Scoped writer list',current_date,array['lead:'||lead_b::text]);
  if public.can_revise_communication_record('contact',contact_b) then raise exception 'OTHER_AUTHOR_REVISION_ALLOWED'; end if;
  if public.can_revise_communication_record('invitation',former_author_event) then raise exception 'FORMER_AUTHOR_WITHOUT_CURRENT_SCOPE_ALLOWED'; end if;
  rejected:=false;
  begin perform public.revise_communication_record('contact',contact_b,null,'{"note":"Not my event"}');
    exception when others then if sqlerrm<>'FORBIDDEN_SCOPE' then raise; end if; rejected:=true; end;
  if not rejected then raise exception 'OTHER_AUTHOR_REVISION_RPC_ALLOWED'; end if;
  rejected:=false;
  begin perform public.create_communication_worklist('Read-only unassigned lead',current_date,array['lead:'||lead_unassigned::text]);
    exception when others then if sqlerrm<>'FORBIDDEN_SCOPE' then raise; end if; rejected:=true; end;
  if not rejected then raise exception 'READ_ONLY_LEAD_ADDED_TO_OPERABLE_LIST'; end if;
  rejected:=false;
  begin perform public.get_communication_worklist(list_id);
    exception when others then if sqlerrm<>'FORBIDDEN_SCOPE' then raise; end if; rejected:=true; end;
  if not rejected then raise exception 'OTHER_OWNER_WORKLIST_VISIBLE'; end if;
  rejected:=false;
  begin perform public.complete_communication_worklist_item(list_id,'lead:'||lead_a::text,true);
    exception when others then if sqlerrm<>'FORBIDDEN_SCOPE' then raise; end if; rejected:=true; end;
  if not rejected then raise exception 'OTHER_OWNER_WORKLIST_WRITABLE'; end if;
  execute 'set local role authenticated';
  if exists(select 1 from public.communication_worklists where id=list_id)
    or exists(select 1 from public.communication_worklist_items where worklist_id=list_id)
    or exists(select 1 from public.effective_lead_communications where id=contact_a)
    or exists(select 1 from public.communication_record_revisions where event_id=contact_a) then raise exception 'SCOPED_READER_RLS_LEAK'; end if;
  if not exists(select 1 from public.communication_worklists where id=own_list) then raise exception 'OWN_WORKLIST_RLS_HIDDEN'; end if;
  execute 'reset role';
  perform set_config('request.jwt.claim.sub',actor::text,true);
  if not exists(select 1 from jsonb_array_elements(public.get_communication_worklists(current_date)) x where x->>'id'=own_list::text) then raise exception 'AUTHORIZED_TEAM_LIST_HIDDEN'; end if;
  perform public.complete_communication_worklist_item(own_list,'lead:'||lead_b::text,true);
  if (select completed_at from public.communication_worklist_items where worklist_id=own_list and row_key='lead:'||lead_b::text) is null then raise exception 'AUTHORIZED_TEAM_COMPLETION_FAILED'; end if;
  if (select count(*) from public.effective_lead_communications where lead_id=lead_a)<>(select count(*) from public.lead_communications where lead_id=lead_a)
    or (select count(*) from public.effective_lead_invitation_events where id in (invitation_event,former_author_event))<>2
    or (select count(*) from public.effective_activity_followup_contacts where id in (post_id,post_later))<>2 then raise exception 'REVISION_CHANGED_COMMUNICATION_COUNTS'; end if;
  perform set_config('request.jwt.claim.sub',outsider::text,true);
  rejected:=false;
  begin perform public.create_communication_worklist('Outsider list',current_date,array['lead:'||lead_a::text]);
    exception when others then if sqlerrm<>'FORBIDDEN' then raise; end if; rejected:=true; end;
  if not rejected then raise exception 'OUTSIDER_WORKLIST_CREATE_ALLOWED'; end if;
  if public.can_revise_communication_record('invitation',invitation_event) then raise exception 'OUTSIDER_INVITATION_REVISION_ALLOWED'; end if;
  execute 'set local role authenticated';
  if exists(select 1 from public.effective_activity_followup_contacts where id=post_id)
    or exists(select 1 from public.effective_lead_invitation_events where id=invitation_event) then raise exception 'OUTSIDER_EFFECTIVE_VIEW_LEAK'; end if;
  execute 'reset role';
  if has_table_privilege('authenticated','public.communication_worklists','INSERT')
    or has_table_privilege('authenticated','public.communication_worklist_items','UPDATE')
    or has_table_privilege('authenticated','public.communication_record_revisions','INSERT') then raise exception 'DIRECT_COMMUNICATION_MUTATION_GRANTED'; end if;
  if exists(select 1 from pg_class where oid in ('public.effective_lead_communications'::regclass,'public.effective_lead_invitation_events'::regclass,'public.effective_activity_followup_contacts'::regclass)
    and not(coalesce(reloptions,'{}'::text[])@>array['security_invoker=true'])) then raise exception 'EFFECTIVE_VIEW_NOT_SECURITY_INVOKER'; end if;
  raise notice 'PASS: fixed worklist membership, completion, owner/RLS scope, cumulative append-only revisions, effective views, CAS and protected workflow projections.';
end $$;
rollback;
