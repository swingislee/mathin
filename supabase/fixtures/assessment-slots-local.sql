-- 仅供已识别的本机数据库使用。复用固定 test 身份，独立创建明确的联调校区。
-- 现有排班和校区一律不覆盖；不创建学生/账号，也不提交家长预约。
do $context$
begin
  if not exists(select 1 from public.profiles where id=current_setting('test.parent_preview.admin_user_id')::uuid and role='admin' and purpose='test' and is_active)
    or not exists(select 1 from public.profiles where id=current_setting('test.parent_preview.teacher_user_id')::uuid and role='staff' and purpose='test' and is_active)
    then raise exception 'FIXED_TEST_STAFF_REQUIRED'; end if;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.parent_preview.admin_user_id'),'role','authenticated','aal','aal2')::text,true);
end $context$;
do $preview$
declare
  v_admin uuid:=current_setting('test.parent_preview.admin_user_id')::uuid;
  v_teacher uuid:=current_setting('test.parent_preview.teacher_user_id')::uuid;
  v_campus public.campuses%rowtype;
  v_campus_id uuid;
  v_day date:=(now() at time zone 'Asia/Shanghai')::date;
  v_start timestamptz;
  v_id uuid;
  v_offset integer;
  v_inserted integer:=0;
  v_existing integer:=0;
  v_busy integer:=0;
  v_row jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended('assessment-slots-preview-20261005',0));
  select * into v_campus from public.campuses where address='assessment-slots-preview-20261005 · 本机开发联调，非真实校区';
  if v_campus.id is null then
    if exists(select 1 from public.campuses where name='小程序开发联调校区') then raise exception 'PREVIEW_CAMPUS_NAME_CONFLICT'; end if;
    v_campus_id:=public.create_campus_v2('小程序开发联调校区','assessment-slots-preview-20261005 · 本机开发联调，非真实校区');
  else
    if v_campus.created_by is distinct from v_admin or v_campus.status<>'active' or v_campus.name<>'小程序开发联调校区'
      then raise exception 'PREVIEW_CAMPUS_CHANGED'; end if;
    v_campus_id:=v_campus.id;
  end if;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',v_teacher,'role','authenticated','aal','aal2')::text,true);
  foreach v_offset in array array[1,3,6,8,10,12] loop
    v_start:=((v_day+v_offset)+case when v_offset%2=0 then time '16:00' else time '10:00' end) at time zone 'Asia/Shanghai';
    v_id:=overlay(overlay(md5('assessment-slots-preview-20261005:'||v_campus_id::text||':'||v_teacher::text||':'||to_char(v_start at time zone 'Asia/Shanghai','YYYY-MM-DD HH24:MI')) placing '5' from 13 for 1) placing '8' from 17 for 1)::uuid;
    if exists(select 1 from public.assessment_slots where id=v_id) then
      v_existing:=v_existing+1;
      continue;
    end if;
    begin
      v_row:=public.save_assessment_slot(v_id,v_teacher,v_campus_id,array['math','english'],'{}',v_start,v_start+interval '40 minutes',true);
      v_inserted:=v_inserted+1;
    exception when raise_exception then
      if sqlerrm='TIME_UNAVAILABLE' then v_busy:=v_busy+1; else raise; end if;
    end;
  end loop;
  perform set_config('test.slots.preview_result',jsonb_build_object('target','verified-windows-loopback','campusId',v_campus_id,
    'campusName','小程序开发联调校区','teacherPurpose','test','createdSlots',v_inserted,'preservedSlots',v_existing,'busySkipped',v_busy,
    'subjects',array['math','english'],'durationMinutes',40,'from',v_day,'to',v_day+13,'parentBookingsCreated',0)::text,true);
end $preview$;
select current_setting('test.slots.preview_result');
