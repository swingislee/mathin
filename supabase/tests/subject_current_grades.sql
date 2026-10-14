-- 定向覆盖存储年级：按记录日期换算写入、较新记录优先、人工更正、学年切换升级与来源保留；仅在隔离开发库事务回滚。
begin;
do $check$
declare actor uuid; fixture_role uuid:=gen_random_uuid(); lid uuid:=gen_random_uuid(); batch uuid:=gen_random_uuid(); sid uuid:=gen_random_uuid();
  snapshot jsonb; result jsonb; values jsonb; projected jsonb; current_year integer; raw_before jsonb; stored_before jsonb;
  next_year uuid; promote_count integer; observed_before timestamptz;
  label text:='年级修订事务 '||gen_random_uuid();
begin
  if public.school_grade_year('2026-06-30')<>2025 or public.school_grade_year('2026-07-01')<>2026 then raise exception 'JULY_BOUNDARY'; end if;
  if public.school_grade_projection(1,2025,'2026-06-30')->>'code'<>'1'
    or public.school_grade_projection(1,2025,'2026-07-01')->>'code'<>'2'
    or public.school_grade_projection(0,2025,'2026-07-01')->>'code'<>'1'
    or public.school_grade_projection(-2,2025,'2027-07-01')->>'code'<>'0'
    or public.school_grade_projection(12,2025,'2026-07-01')->>'code'<>'13'
    or public.school_grade_projection(null,2025,'2027-07-01')->>'code' is not null
    or public.school_grade_projection(3,null,'2027-07-01')->>'code'<>'3' then raise exception 'GRADE_PROJECTION'; end if;
  if public.school_grade_convert(1,2025,2026)<>2 or public.school_grade_convert(0,2025,2026)<>1 or public.school_grade_convert(-2,2025,2027)<>0
    or public.school_grade_convert(12,2025,2027)<>13 or public.school_grade_convert(13,2025,2030)<>13 or public.school_grade_convert(3,2027,2026)<>3
    or public.school_grade_convert(null,2025,2026) is not null or public.school_grade_label(0)<>'大班' or public.school_grade_label(13)<>'已毕业'
    or public.school_grade_label(14) is not null then raise exception 'GRADE_CONVERT'; end if;
  if public.school_source_acquisition_date('{"cells":[{"fieldName":"获取日期","text":"2026-07-01"}]}')<>'2026-07-01'::date
    or public.school_source_acquisition_date('{"cells":[{"fieldName":"获取日期","text":"2026-02-31"}]}') is not null then raise exception 'SOURCE_DATE'; end if;
  if public.school_worklist_support_name('{"cells":[{"fieldName":"确认人员","text":"章润"}]}')<>'章润'
    or public.school_worklist_support_name('{"cells":[{"fieldName":"获取人员","text":"事务兼职"}]}') is not null then raise exception 'SUPPORT_IDENTITY'; end if;
  select id into actor from public.profiles where role='staff' and purpose='test' and is_active and account_status='active'
    and not password_change_required order by id limit 1;
  if actor is null then raise exception 'FIXED_DEVELOPMENT_STAFF_REQUIRED'; end if;
  insert into public.staff_roles(id,key,name) values(fixture_role,'current_grade_fixture_'||fixture_role,label);
  insert into public.role_permissions(role_id,perm_key) values(fixture_role,'student.view.all'),(fixture_role,'student.edit'),
    (fixture_role,'followup.view'),(fixture_role,'followup.write'),(fixture_role,'schedule.manage');
  insert into public.staff_role_members(user_id,role_id) values(actor,fixture_role);
  current_year:=public.school_current_grade_year();

  -- 补录的历史线索按建档学年换算后写入，读取直接返回存储值。
  insert into public.leads(id,provisional_student_name,normalized_name,phone,phone_normalized,grade_hint,owner_id,created_by,created_at)
    values(lid,label,public.normalize_lead_name(label),'15600004321','15600004321',1,actor,actor,'2025-10-10');
  if not exists(select 1 from public.leads where id=lid and grade_basis_code=least(13,1+current_year-2025) and grade_basis_year=current_year
    and grade_observed_at='2025-10-10'::timestamptz and grade_hint=least(13,1+current_year-2025)) then raise exception 'BACKDATED_LEAD_GRADE'; end if;
  insert into public.data_import_batches(id,import_kind,template_version,idempotency_key,input_hash,input_fingerprint,status,
    total_rows,valid_rows,inserted_rows,created_by,completed_at,batch_label)
    values(batch,'leads','test',batch::text,repeat('a',64),repeat('a',32),'completed',1,1,1,actor,now(),label);
  insert into public.lead_source_records(lead_id,batch_id,row_no,source_system,batch_label,source_row,submitted_at,raw_grade_text)
    values(lid,batch,1,'xiaoditui',label,2,'2026-06-30 04:00:00+00','一年级');
  perform set_config('request.jwt.claim.sub','',true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated','aal','aal2')::text,true);
  select value into projected from public.school_current_subject_grades(jsonb_build_array(jsonb_build_object('key','lead:'||lid,'leadId',lid)),'2027-07-01');
  if projected->>'code'<>least(13,1+current_year-2025)::text or projected->>'basisYear'<>current_year::text then raise exception 'STORED_READ'; end if;

  -- 来源变化后刷新：最新的记录按其学年换算；同一学年的记录不再升级。
  perform public.school_refresh_subject_grades(null,array[lid]);
  if not exists(select 1 from public.leads where id=lid and grade_basis_code=least(13,1+current_year-2025) and grade_observed_at='2026-06-30 04:00:00+00')
    then raise exception 'PRE_JULY_SOURCE'; end if;
  update public.lead_source_records set submitted_at='2026-07-01 04:00:00+00' where lead_id=lid;
  select to_jsonb(r) into raw_before from public.lead_source_records r where lead_id=lid;
  if public.school_refresh_subject_grades(null,array[lid])<>1 then raise exception 'NEWER_SOURCE_NOT_APPLIED'; end if;
  select value into projected from public.school_current_subject_grades(jsonb_build_array(jsonb_build_object('key','lead:'||lid,'leadId',lid)),'2026-07-01');
  if projected->>'code'<>least(13,1+current_year-2026)::text or projected->>'basisYear'<>current_year::text then raise exception 'JULY_SOURCE'; end if;
  if public.school_refresh_subject_grades(null,array[lid])<>0 then raise exception 'REFRESH_NOT_IDEMPOTENT'; end if;

  snapshot:=public.read_school_support_profile(null,lid);
  if (snapshot->'values'->>'grade')::integer<>least(13,1+current_year-2026) then raise exception 'PROFILE_CURRENT_GRADE'; end if;
  select jsonb_build_array(grade_hint,grade_basis_code,grade_basis_year,grade_observed_at) into stored_before from public.leads where id=lid;
  values:=snapshot->'values'||jsonb_build_object('name',label||' 已更正');
  result:=public.update_school_support_profile(null,lid,snapshot->>'version',values);
  if stored_before is distinct from (select jsonb_build_array(grade_hint,grade_basis_code,grade_basis_year,grade_observed_at) from public.leads where id=lid)
    then raise exception 'NAME_CHANGE_REBASED_GRADE'; end if;
  begin perform public.update_school_support_profile(null,lid,snapshot->>'version',values); raise exception 'STALE_WRITE_ALLOWED';
    exception when others then if sqlerrm<>'PROFILE_CONFLICT' then raise; end if; end;
  values:=result->'values'||jsonb_build_object('grade',0);
  result:=public.update_school_support_profile(null,lid,result->>'version',values);
  if result->'values'->>'grade'<>'0' or not exists(select 1 from public.leads where id=lid and grade_basis_code=0 and grade_basis_year=current_year
    and grade_hint is null and grade_text='大班' and grade_observed_at=now()) then raise exception 'MANUAL_KINDERGARTEN_GRADE'; end if;
  -- 人工更正之后，较旧的来源记录不会覆盖它。
  if public.school_refresh_subject_grades(null,array[lid])<>0 then raise exception 'OLDER_SOURCE_OVERRODE_MANUAL'; end if;
  values:=result->'values'||jsonb_build_object('grade',1);
  result:=public.update_school_support_profile(null,lid,result->>'version',values);
  if not exists(select 1 from public.leads where id=lid and grade_hint=1 and grade_basis_code=1 and grade_basis_year=current_year) then raise exception 'MANUAL_CURRENT_GRADE'; end if;
  projected:=public.school_apply_current_grades(jsonb_build_array(jsonb_build_object('key','lead:'||lid,'leadId',lid,'grade',8,'gradeText','旧值')));
  if projected->0->>'grade'<>'1' then raise exception 'SHARED_CURRENT_GRADE'; end if;
  values:=result->'values'||jsonb_build_object('grade',null);
  result:=public.update_school_support_profile(null,lid,result->>'version',values);
  if result->'values'->>'grade' is not null then raise exception 'UNKNOWN_GRADE_RESURRECTED'; end if;
  if raw_before is distinct from (select to_jsonb(r) from public.lead_source_records r where lead_id=lid) then raise exception 'SOURCE_WAS_REWRITTEN'; end if;
  insert into public.students(id,name,bind_code,grade,grade_basis_code,grade_basis_year,assigned_to,created_by,purpose)
    values(sid,label,gen_random_uuid()::text,3,3,current_year,actor,actor,'test');
  update public.leads set student_id=sid,identity_confirmed_by=actor,identity_confirmed_at=now(),status='converted',
    grade_hint=3,grade_basis_code=3,grade_basis_year=current_year where id=lid;
  snapshot:=public.read_school_support_profile(sid,lid);
  values:=snapshot->'values'||jsonb_build_object('grade',0,'name',label||' 学生更正');
  result:=public.update_school_support_profile(sid,lid,snapshot->>'version',values);
  if result->'values'->>'grade'<>'0'
    or not exists(select 1 from public.students where id=sid and grade is null and grade_basis_code=0 and grade_basis_year=current_year)
    or not exists(select 1 from public.leads where id=lid and grade_hint is null and grade_basis_code=0 and grade_basis_year=current_year and grade_text='大班')
    then raise exception 'LINKED_STUDENT_CURRENT_GRADE'; end if;
  projected:=public.read_student_record_with_enrollments(sid,lid,null);
  if projected->>'gradeText'<>'大班' or projected->>'name'<>label||' 学生更正' then raise exception 'SAVED_RECORD_CURRENT_GRADE'; end if;

  -- 学年切换：存储年级统一升级一次（含幼儿园与线索），记录时间不变。
  select grade_observed_at into observed_before from public.leads where id=lid;
  next_year:=public.create_school_year(current_year+1);
  select count(*) into promote_count from public.students student_row where student_row.deleted_at is null
    and student_row.status not in ('alumni','invalid') and student_row.grade between 1 and 11
    and coalesce(student_row.grade_basis_year,current_year)<current_year+1;
  perform public.activate_school_year(next_year,make_date(current_year+1,7,1),promote_count);
  if not exists(select 1 from public.students where id=sid and grade=1 and grade_basis_code=1 and grade_basis_year=current_year+1)
    or not exists(select 1 from public.leads where id=lid and grade_hint=1 and grade_basis_code=1 and grade_text='1年级' and grade_basis_year=current_year+1
      and grade_observed_at=observed_before)
    or exists(select 1 from public.leads where grade_basis_year=current_year)
    or exists(select 1 from public.students where deleted_at is null and grade_basis_year=current_year) then raise exception 'SCHOOL_YEAR_PROMOTION'; end if;
  perform set_config('request.jwt.claims','{}',true);
  begin perform public.update_school_support_profile(null,lid,result->>'version',values); raise exception 'ANONYMOUS_WRITE_ALLOWED';
    exception when others then if sqlerrm<>'UNAUTHENTICATED' then raise; end if; end;
end $check$;
rollback;
