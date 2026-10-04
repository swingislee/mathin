-- 固定开发账号与本批底稿；所有反馈和分配在保存点内验证后回滚。
savepoint profile_review_contract;
create temp table profile_review_test as
select
  (select id from auth.users where email='test-admin@mathin.local') admin_id,
  (select id from auth.users where email='test-teacher@mathin.local') teacher_id,
  (select id from auth.users where email='test-sales@mathin.local') support_id,
  i.id item_id,i.group_id
from public.student_profile_review_items i where i.needs_contact and i.name<>'' and i.grade<>'' limit 1;
grant select on profile_review_test to authenticated;

do $test$
declare c record; result public.student_profile_review_responses; v integer;
begin
  select * into c from profile_review_test;
  if c.admin_id is null or c.teacher_id is null or c.support_id is null then raise exception 'FIXED_LOCAL_STAFF_REQUIRED'; end if;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',c.admin_id,'role','authenticated')::text,true);
  select version into v from public.student_profile_review_groups where id=c.group_id;
  perform public.assign_student_profile_review(c.group_id,c.teacher_id,c.support_id,v);
  if not public.can_read_student_profile_review(c.group_id) then raise exception 'ADMIN_SCOPE_FAILED'; end if;
end $test$;

set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub',teacher_id,'role','authenticated')::text,true) from profile_review_test;
do $test$
declare c record; result public.student_profile_review_responses; n integer;
begin
  select * into c from profile_review_test;
  if (select count(*) from public.student_profile_review_groups)<>1 then raise exception 'TEACHER_GROUP_RLS'; end if;
  if (select count(*) from public.student_profile_review_batches)<>1 then raise exception 'TEACHER_BATCH_RLS'; end if;
  if exists(select 1 from public.student_profile_review_items where group_id<>c.group_id) then raise exception 'TEACHER_ITEM_RLS'; end if;
  begin
    perform public.assign_student_profile_review(c.group_id,c.teacher_id,null,1);
    raise exception 'TEACHER_ASSIGNED';
  exception when raise_exception then if sqlerrm<>'FORBIDDEN' then raise; end if; end;
  begin
    perform public.save_student_profile_review(c.item_id,'support',0,'{"contact":{"answer":"correction","value":"600000123456"}}');
    raise exception 'TEACHER_SUPPORT_WRITE';
  exception when raise_exception then if sqlerrm<>'FORBIDDEN' then raise; end if; end;
  begin
    perform public.save_student_profile_review(c.item_id,'teacher',0,'{"contact":{"answer":"unknown"}}');
    raise exception 'TEACHER_CONTACT_FIELD';
  exception when raise_exception then if sqlerrm<>'VALIDATION' then raise; end if; end;
  begin
    perform public.save_student_profile_review(c.item_id,'teacher',0,'{"name":{"answer":"correction","value":" "}}');
    raise exception 'BLANK_CORRECTION_ACCEPTED';
  exception when raise_exception then if sqlerrm<>'VALIDATION' then raise; end if; end;
  begin
    perform public.save_student_profile_review(c.item_id,'teacher',0,'{"targetId":{"answer":"yes"}}');
    raise exception 'IDENTITY_WRITE_ACCEPTED';
  exception when raise_exception then if sqlerrm<>'VALIDATION' then raise; end if; end;
  result := public.save_student_profile_review(c.item_id,'teacher',0,'{"name":{"answer":"yes"},"grade":{"answer":"unknown"}}');
  if result.version<>1 or result.recorded_by<>c.teacher_id then raise exception 'RESPONSE_ATTRIBUTION'; end if;
  result := public.save_student_profile_review(c.item_id,'teacher',0,'{"name":{"answer":"yes"},"grade":{"answer":"unknown"}}');
  if result.version<>1 then raise exception 'RETRY_DUPLICATED'; end if;
  begin
    perform public.save_student_profile_review(c.item_id,'teacher',0,'{"name":{"answer":"unknown"}}');
    raise exception 'STALE_OVERWRITE_ACCEPTED';
  exception when raise_exception then if sqlerrm<>'VERSION_CONFLICT' then raise; end if; end;
  result := public.save_student_profile_review(c.item_id,'teacher',1,'{"grade":{"answer":"correction","value":"3年级"}}');
  if result.version<>2 or result.answers->'name'->>'answer'<>'yes' then raise exception 'PARTIAL_FEEDBACK_LOST'; end if;
  if (select version from public.student_profile_review_responses where item_id=c.item_id and scope='teacher')<>2 then raise exception 'PERSISTENT_READ_FAILED'; end if;
  begin
    update public.student_profile_review_items set name='changed' where id=c.item_id;
    raise exception 'DIRECT_SOURCE_WRITE_ACCEPTED';
  exception when insufficient_privilege then null; end;
  if exists(select 1 from public.student_profile_review_events) then raise exception 'PRIVATE_AUDIT_EXPOSED'; end if;
end $test$;

select set_config('request.jwt.claims',jsonb_build_object('sub',support_id,'role','authenticated')::text,true) from profile_review_test;
do $test$
declare c record; result public.student_profile_review_responses;
begin
  select * into c from profile_review_test;
  if exists(select 1 from public.student_profile_review_responses where scope='teacher') then raise exception 'OTHER_SCOPE_RESPONSE_EXPOSED'; end if;
  result := public.save_student_profile_review(c.item_id,'support',0,'{"contact":{"answer":"unknown"}}');
  if result.answers->'contact'->>'answer'<>'unknown' then raise exception 'UNKNOWN_REQUIRED_REASON'; end if;
  begin
    perform public.save_student_profile_review(c.item_id,'support',1,'{"contact":{"answer":"yes"}}');
    raise exception 'EMPTY_CONTACT_CONFIRMED';
  exception when raise_exception then if sqlerrm<>'VALIDATION' then raise; end if; end;
  result := public.save_student_profile_review(c.item_id,'support',1,'{"contact":{"answer":"correction","value":"600000123456，妈妈"}}');
end $test$;

reset role;
select set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,'role','authenticated')::text,true) from profile_review_test;
do $test$
declare c record; v integer;
begin
  select * into c from profile_review_test;
  if (select count(*) from public.student_profile_review_events where group_id=c.group_id and scope='teacher')<>2 then raise exception 'REVISION_HISTORY_LOST'; end if;
  select version into v from public.student_profile_review_groups where id=c.group_id;
  perform public.assign_student_profile_review(c.group_id,null,c.support_id,v);
end $test$;
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub',teacher_id,'role','authenticated')::text,true) from profile_review_test;
do $test$
declare c record;
begin
  select * into c from profile_review_test;
  if exists(select 1 from public.student_profile_review_items) or exists(select 1 from public.student_profile_review_batches) then raise exception 'REVOKED_SCOPE_READ'; end if;
  begin
    perform public.save_student_profile_review(c.item_id,'teacher',2,'{"name":{"answer":"unknown"}}');
    raise exception 'REVOKED_SCOPE_WRITE';
  exception when raise_exception then if sqlerrm<>'FORBIDDEN' then raise; end if; end;
end $test$;
reset role;
set local role anon;
do $test$ begin
  begin
    perform count(*) from public.student_profile_review_items;
    raise exception 'ANONYMOUS_READ';
  exception when insufficient_privilege then null; end;
  begin
    perform public.save_student_profile_review(gen_random_uuid(),'teacher',0,'{"name":{"answer":"yes"}}');
    raise exception 'ANONYMOUS_WRITE';
  exception when insufficient_privilege then null; end;
end $test$;
reset role;
rollback to savepoint profile_review_contract;
select 'PROFILE_REVIEW_ASSERTIONS_PASS';
