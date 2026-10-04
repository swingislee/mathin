-- 只在已核对的隔离本机事务内运行。调用方回滚此段的全部修订。
do $test$
declare admin_id uuid; other_id uuid; record_id uuid; kind text; relation text; document jsonb; values jsonb; after_document jsonb;
  revision_id uuid; rejected boolean; existing_revision_count integer; source_before text; source_after text; before_rows jsonb; after_rows jsonb; id_current uuid;
begin
  select id into strict admin_id from public.profiles where role='admin' order by id limit 1;
  select id into strict other_id from public.profiles where role<>'admin' order by id limit 1;
  select md5(jsonb_agg(t order by id)::text) into source_before from public.history_import_records t;
  foreach kind in array array['activity','assessment','renewal','enrollment','communication'] loop
    relation:=case kind when 'activity' then 'activity_registrations' when 'assessment' then 'assessment_results' when 'renewal' then 'course_opportunities' when 'enrollment' then 'course_enrollments' else 'student_follow_ups' end;
    execute format('select id from public.%I where record_state=''historical'' order by id limit 1',relation) into strict record_id;
    before_rows:=public.business_record_revision_rows(kind,record_id);
    perform set_config('request.jwt.claim.sub',admin_id::text,true);set local role authenticated;
    document:=public.get_business_record_revision(kind,record_id);
    select jsonb_object_agg(s->>'relation',s->'values') into values from jsonb_array_elements(document->'sections')s;
    if kind='activity' then
      values:=jsonb_set(values,'{activities,title}',to_jsonb('Revision check activity'::text));
      values:=jsonb_set(values,'{activities,occurred_on}',to_jsonb('2025-06-01'::text));
      values:=jsonb_set(values,'{activity_registrations,reported_result}',to_jsonb('Corrected award'::text));
      values:=jsonb_set(values,'{activity_registrations,result_link_status}',to_jsonb('confirmed'::text));
    elsif kind='assessment' then
      values:=jsonb_set(values,'{assessment_results,strengths}',to_jsonb('Corrected feedback'::text));
      values:=jsonb_set(values,'{assessment_results,assessed_on}',to_jsonb('2025-06-02'::text));
    elsif kind='renewal' then
      values:=jsonb_set(values,'{course_opportunities,note}',to_jsonb('Corrected intention'::text));
      values:=jsonb_set(values,'{course_opportunities,stage}',to_jsonb('not_enrolled'::text));
    elsif kind='enrollment' then
      values:=jsonb_set(values,'{course_enrollments,amount}','0'::jsonb);
      values:=jsonb_set(values,'{course_enrollment_assignments,teacher_label}',to_jsonb('Corrected teacher'::text));
    else
      values:=jsonb_set(values,'{student_follow_ups,content}',to_jsonb('Corrected conversation'::text));
      values:=jsonb_set(values,'{student_follow_ups,occurred_on}','null'::jsonb);
    end if;
    revision_id:=public.revise_business_record(kind,record_id,document->>'version',values,'transaction-only verification');
    after_document:=public.get_business_record_revision(kind,record_id);
    if document->>'version'=after_document->>'version' then raise exception 'REVISION_VERSION_UNCHANGED'; end if;
    if not exists(select 1 from jsonb_array_elements(after_document->'revisions')r where r->>'id'=revision_id::text) then raise exception 'REVISION_NOT_VISIBLE'; end if;
    if (select jsonb_object_agg(s->>'relation',s->'values') from jsonb_array_elements(after_document->'sections')s)<>values then raise exception 'REVISION_NOT_PERSISTED'; end if;
    rejected:=false;
    begin perform public.revise_business_record(kind,record_id,document->>'version',values,'stale');
    exception when raise_exception then if sqlerrm='REVISION_CONFLICT' then rejected:=true;else raise;end if;end;
    if not rejected then raise exception 'REVISION_STALE_ALLOWED'; end if;
    rejected:=false;
    begin perform public.revise_business_record(kind,record_id,after_document->>'version',jsonb_build_object(relation,jsonb_build_object('student_id',other_id)),'forbidden');
    exception when raise_exception then if sqlerrm='VALIDATION' then rejected:=true;else raise;end if;end;
    if not rejected then raise exception 'REVISION_IDENTITY_PATCH_ALLOWED'; end if;
    rejected:=false;
    begin perform public.revise_business_record(kind,record_id,after_document->>'version',jsonb_build_object(relation,jsonb_build_object('record_state','current')),'forbidden');
    exception when raise_exception then if sqlerrm='VALIDATION' then rejected:=true;else raise;end if;end;
    if not rejected then raise exception 'REVISION_STATE_PATCH_ALLOWED'; end if;
    rejected:=false;
    begin execute format('update public.%I set history_revision=history_revision+1 where id=$1',relation) using record_id;
    exception when insufficient_privilege or raise_exception then rejected:=true;end;
    if not rejected then raise exception 'REVISION_DIRECT_WRITE_ALLOWED'; end if;
    rejected:=false;
    begin update public.business_record_revisions set reason='altered' where id=revision_id;
    exception when insufficient_privilege or raise_exception then rejected:=true;end;
    if not rejected then raise exception 'REVISION_AUDIT_MUTABLE'; end if;
    reset role;
    after_rows:=public.business_record_revision_rows(kind,record_id);
    if exists(select 1 from jsonb_array_elements(before_rows)b join jsonb_array_elements(after_rows)a on a->>'id'=b->>'id'
      where a->'data'->'source_record_id'<>b->'data'->'source_record_id' or a->'data'->'source_field_ids'<>b->'data'->'source_field_ids'
        or a->'data'->'source_payload_sha256'<>b->'data'->'source_payload_sha256' or a->'data'->>'record_state'<>'historical') then raise exception 'REVISION_PROVENANCE_CHANGED'; end if;
    perform set_config('request.jwt.claim.sub',other_id::text,true);set local role authenticated;
    rejected:=false;
    begin perform public.get_business_record_revision(kind,record_id);
    exception when raise_exception then if sqlerrm='FORBIDDEN' then rejected:=true;else raise;end if;end;
    if not rejected then raise exception 'REVISION_NONADMIN_READ_ALLOWED'; end if;
    rejected:=false;
    begin perform public.revise_business_record(kind,record_id,after_document->>'version',values,'unauthorized');
    exception when raise_exception then if sqlerrm='FORBIDDEN' then rejected:=true;else raise;end if;end;
    if not rejected then raise exception 'REVISION_NONADMIN_WRITE_ALLOWED'; end if;
    if exists(select 1 from public.business_record_revisions) then raise exception 'REVISION_AUDIT_LEAK'; end if;
    reset role;
  end loop;
  select md5(jsonb_agg(t order by id)::text) into source_after from public.history_import_records t;
  if source_before is distinct from source_after then raise exception 'REVISION_IMPORT_CHANGED'; end if;
  select count(*) into existing_revision_count from public.business_record_revisions;
  perform set_config('request.jwt.claim.sub',admin_id::text,true);set local role authenticated;
  document:=public.get_business_record_revision('activity',(select id from public.activity_registrations where record_state='historical' order by id limit 1));
  record_id:=(select id from public.activity_registrations where record_state='historical' order by id limit 1);
  rejected:=false;
  begin perform public.revise_business_record('activity',record_id,document->>'version','{"activities":{"title":"must roll back"},"activity_registrations":{"status":"invalid"}}','invalid child');
  exception when raise_exception then if sqlerrm='VALIDATION' then rejected:=true;else raise;end if;end;
  if not rejected or (select count(*) from public.business_record_revisions)<>existing_revision_count
    or (public.get_business_record_revision('activity',record_id)->>'version')<>document->>'version' then raise exception 'REVISION_PARTIAL_WRITE'; end if;
  select id into id_current from public.activity_registrations where record_state='current' limit 1;
  if id_current is not null then
    rejected:=false;
    begin perform public.get_business_record_revision('activity',id_current);
    exception when raise_exception then if sqlerrm='NOT_FOUND' then rejected:=true;else raise;end if;end;
    if not rejected then raise exception 'REVISION_CURRENT_FLOW_ALLOWED'; end if;
  end if;
  reset role;perform set_config('request.jwt.claim.sub','',true);
end $test$;
