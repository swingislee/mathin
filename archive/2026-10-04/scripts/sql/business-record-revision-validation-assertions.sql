do $test$
declare admin_id uuid; record_id uuid; document jsonb; patch jsonb; rejected boolean; revision_count integer;
begin
  select id into strict admin_id from public.profiles where role='admin' order by id limit 1;
  select id into strict record_id from public.activity_registrations where record_state='historical' order by id limit 1;
  select count(*) into revision_count from public.business_record_revisions;
  perform set_config('request.jwt.claim.sub',admin_id::text,true);set local role authenticated;
  document:=public.get_business_record_revision('activity',record_id);
  for patch in select value from jsonb_array_elements('[{"activities":{"occurred_on":"infinity"}},{"activities":{"occurred_on":"2026-02-30"}},{"activities":{"title":""}},{"activities":{"title":null}},{"activities":{"title":123}},{"activity_registrations":{"status":"invalid"}}]') loop
    rejected:=false;
    begin perform public.revise_business_record('activity',record_id,document->>'version',patch,'invalid input');
    exception when raise_exception then if sqlerrm='VALIDATION' then rejected:=true;else raise;end if;end;
    if not rejected then raise exception 'REVISION_MALFORMED_ALLOWED'; end if;
  end loop;
  if (public.get_business_record_revision('activity',record_id)->>'version')<>document->>'version' or (select count(*) from public.business_record_revisions)<>revision_count then raise exception 'REVISION_MALFORMED_MUTATED'; end if;
  select id into strict record_id from public.course_enrollments where record_state='historical' order by id limit 1;
  document:=public.get_business_record_revision('enrollment',record_id);
  rejected:=false;
  begin perform public.revise_business_record('enrollment',record_id,document->>'version','{"course_enrollments":{"amount":1.234}}','precision');
  exception when raise_exception then if sqlerrm='VALIDATION' then rejected:=true;else raise;end if;end;
  if not rejected then raise exception 'REVISION_AMOUNT_ROUNDED'; end if;
  reset role;perform set_config('request.jwt.claim.sub','',true);
end $test$;
