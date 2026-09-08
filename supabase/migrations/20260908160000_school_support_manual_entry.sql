-- 学服从实际业务节点补入；不完整资料留在同一办理事项中，完整资料接入领域记录。
alter table public.leads add column manual_entry boolean not null default false;
alter table public.leads add column manual_identity_pending boolean not null default false;

do $constraints$
declare item record;
begin
  for item in select conname,pg_get_constraintdef(oid) as definition from pg_constraint
    where conrelid='public.leads'::regclass and contype='c' and
      (conname in ('leads_phone_check','leads_phone_normalized_check','leads_normalized_name_check','leads_provisional_student_name_check')
        or pg_get_constraintdef(oid) like '%length(btrim(phone))%'
        or pg_get_constraintdef(oid) like '%phone_normalized ~%'
        or pg_get_constraintdef(oid) like '%length(normalized_name)%'
        or pg_get_constraintdef(oid) like '%length(TRIM(BOTH FROM provisional_student_name))%') loop
    execute format('alter table public.leads drop constraint %I',item.conname);
  end loop;
end;
$constraints$;
alter table public.leads add constraint leads_manual_phone_check check (
  (length(btrim(phone)) between 6 and 40) or ((source_record_id is not null or manual_entry) and phone=''));
alter table public.leads add constraint leads_manual_phone_normalized_check check (
  (phone_normalized is not null and phone_normalized ~ '^[0-9]{6,20}$') or ((source_record_id is not null or manual_entry) and phone_normalized is null));
alter table public.leads add constraint leads_manual_name_check check (
  length(btrim(provisional_student_name)) between 1 and 100 or (manual_entry and provisional_student_name=''));
alter table public.leads add constraint leads_manual_normalized_name_check check (
  length(normalized_name) between 1 and 100 or (manual_entry and normalized_name=''));
alter table public.leads add constraint leads_manual_identifiable_check check (
  not manual_entry or nullif(btrim(provisional_student_name),'') is not null or nullif(btrim(phone),'') is not null);

create function public.school_support_subject_access(p_student_id uuid,p_lead_id uuid,p_write boolean default false)
returns boolean language plpgsql stable security definer set search_path=public,pg_temp as $$
declare actor uuid:=auth.uid(); l public.leads%rowtype;
begin
  if actor is null or not public.is_staff(actor) or not public.has_perm(actor,'followup.view')
    or p_write and not public.has_perm(actor,'followup.write') or num_nonnulls(p_student_id,p_lead_id)=0 then return false; end if;
  if p_student_id is not null and not exists(select 1 from public.students s where s.id=p_student_id
    and s.deleted_at is null and public.can_access_student(s.id,actor)) then return false; end if;
  if p_lead_id is not null then
    select * into l from public.leads where id=p_lead_id;
    if l.id is null or p_student_id is not null and l.student_id is distinct from p_student_id then return false; end if;
    if l.student_id is not null and not exists(select 1 from public.students s where s.id=l.student_id
      and s.deleted_at is null and public.can_access_student(s.id,actor)) then return false; end if;
    if not (coalesce(l.owner_id=actor,false) or public.has_perm(actor,'student.view.all') or not p_write and l.owner_id is null) then return false; end if;
  end if;
  return true;
end;
$$;

create table public.school_support_work_items (
  id uuid primary key default gen_random_uuid(),
  workspace text not null check(workspace in ('leads','communication','assessments','enrollments','renewals','students')),
  student_id uuid references public.students(id) on delete restrict,
  lead_id uuid references public.leads(id) on delete restrict,
  context_key text not null check(length(context_key) between 1 and 200),
  work_date date,
  note text not null default '' check(length(note)<=2000),
  worklist_id uuid references public.communication_worklists(id) on delete restrict,
  registration_id uuid references public.activity_registrations(id) on delete restrict,
  course_id uuid references public.courses(id) on delete restrict,
  term_id uuid references public.school_terms(id) on delete restrict,
  opportunity_id uuid references public.course_opportunities(id) on delete restrict,
  cycle_id uuid references public.renewal_cycles(id) on delete restrict,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revision integer not null default 0 check(revision>=0),
  closed_at timestamptz,
  check(num_nonnulls(student_id,lead_id)>0)
);
create index school_support_work_items_open on public.school_support_work_items(workspace,created_at desc) where closed_at is null;
create index school_support_work_items_student on public.school_support_work_items(student_id) where student_id is not null;
create index school_support_work_items_lead on public.school_support_work_items(lead_id) where lead_id is not null;
alter table public.school_support_work_items enable row level security;
create policy school_support_work_items_select on public.school_support_work_items for select to authenticated
  using(public.school_support_subject_access(student_id,lead_id,false));

create table public.school_support_entry_receipts (
  actor_id uuid not null references public.profiles(id) on delete restrict,
  request_id uuid not null,
  fingerprint text not null,
  work_item_id uuid not null references public.school_support_work_items(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key(actor_id,request_id)
);
alter table public.school_support_entry_receipts enable row level security;

create table public.school_support_change_log (
  id uuid primary key default gen_random_uuid(),
  work_item_id uuid references public.school_support_work_items(id) on delete restrict,
  student_id uuid references public.students(id) on delete restrict,
  lead_id uuid references public.leads(id) on delete restrict,
  kind text not null check(kind in ('profile','identity','work')),
  before_data jsonb not null,
  after_data jsonb not null,
  recorded_by uuid not null references public.profiles(id) on delete restrict,
  recorded_at timestamptz not null default now(),
  check(num_nonnulls(student_id,lead_id)>0)
);
alter table public.school_support_change_log enable row level security;
create policy school_support_change_log_select on public.school_support_change_log for select to authenticated
  using(public.school_support_subject_access(student_id,lead_id,false));
revoke all on public.school_support_work_items,public.school_support_entry_receipts,public.school_support_change_log from anon,authenticated;
grant select on public.school_support_work_items,public.school_support_change_log to authenticated;

create function public.search_school_support_subjects(p_search text)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
#variable_conflict use_variable
declare actor uuid:=auth.uid(); needle text:=btrim(coalesce(p_search,'')); phone text; result jsonb;
begin
  if actor is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.is_staff(actor) or not public.has_perm(actor,'followup.view') then raise exception 'FORBIDDEN'; end if;
  if length(needle)>100 then raise exception 'VALIDATION'; end if;
  if needle='' then return '[]'::jsonb; end if;
  phone:=public.normalize_school_ops_phone(needle);
  with matches as (
    select s.id as student_id,null::uuid as lead_id,s.name,s.grade,s.parent_phone as phone,s.phone as other_phone,
      s.parent_name,s.school,s.assigned_to as owner_id,md5(to_jsonb(s)::text) as version,s.status,
      (phone<>'' and phone in (public.normalize_school_ops_phone(s.phone),public.normalize_school_ops_phone(s.parent_phone))) as phone_match,
      public.normalize_lead_name(s.name)=public.normalize_lead_name(needle) as name_match
    from public.students s where s.deleted_at is null and public.school_support_subject_access(s.id,null,false)
      and (position(lower(needle) in lower(concat_ws(' ',s.name,s.phone,s.parent_phone,s.parent_name,s.wechat)))>0
        or phone<>'' and phone in (public.normalize_school_ops_phone(s.phone),public.normalize_school_ops_phone(s.parent_phone)))
    union all
    select null,l.id,l.provisional_student_name,l.grade_hint,l.phone,'','','',l.owner_id,md5(to_jsonb(l)::text),l.status,
      phone<>'' and l.phone_normalized=phone, l.normalized_name=public.normalize_lead_name(needle)
    from public.leads l where l.student_id is null and public.school_support_subject_access(null,l.id,false)
      and (position(lower(needle) in lower(concat_ws(' ',l.provisional_student_name,l.phone)))>0 or phone<>'' and l.phone_normalized=phone)
  ), limited as (select * from matches order by phone_match desc,name_match desc,name,student_id,lead_id limit 30)
  select coalesce(jsonb_agg(jsonb_build_object('studentId',m.student_id,'leadId',m.lead_id,'name',m.name,'grade',m.grade,
    'phone',coalesce(nullif(m.phone,''),m.other_phone),'parentName',m.parent_name,'school',m.school,'ownerId',m.owner_id,
    'ownerName',coalesce(p.display_name,''),'version',m.version,'phoneMatch',m.phone_match,'nameMatch',m.name_match,
    'canWrite',public.school_support_subject_access(m.student_id,m.lead_id,true))
    order by m.phone_match desc,m.name_match desc,m.name),'[]'::jsonb) into result from limited m left join public.profiles p on p.id=m.owner_id;
  return result;
end;
$$;

create function public.read_school_support_work_item(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare item public.school_support_work_items%rowtype; s public.students%rowtype; l public.leads%rowtype; enrollment_id uuid;
begin
  select * into item from public.school_support_work_items where id=p_id;
  if item.id is null then raise exception 'NOT_FOUND'; end if;
  if not public.school_support_subject_access(item.student_id,item.lead_id,false) then raise exception 'FORBIDDEN_SCOPE'; end if;
  if item.lead_id is not null then select * into l from public.leads where id=item.lead_id; end if;
  select * into s from public.students where id=coalesce(item.student_id,l.student_id);
  select id into enrollment_id from public.course_enrollments where opportunity_id=item.opportunity_id and status='active';
  return jsonb_build_object('id',item.id,'workspace',item.workspace,'studentId',s.id,'leadId',l.id,
    'name',coalesce(nullif(s.name,''),nullif(l.provisional_student_name,''),l.phone,''),
    'phone',coalesce(nullif(s.parent_phone,''),nullif(s.phone,''),l.phone,''),'grade',coalesce(s.grade,l.grade_hint),
    'note',item.note,'workDate',item.work_date,'worklistId',item.worklist_id,'registrationId',item.registration_id,
    'courseId',item.course_id,'termId',item.term_id,'opportunityId',item.opportunity_id,'enrollmentId',enrollment_id,
    'cycleId',item.cycle_id,'revision',item.revision,'closedAt',item.closed_at,'createdAt',item.created_at,
    'identityPending',coalesce(l.manual_identity_pending,false),'canWrite',public.school_support_subject_access(item.student_id,item.lead_id,true),
    'courseTitle',coalesce((select title from public.courses where id=item.course_id),''),
    'termName',coalesce((select name from public.school_terms where id=item.term_id),''));
end;
$$;

create function public.list_school_support_work_items(p_workspace text)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare actor uuid:=auth.uid(); result jsonb;
begin
  if actor is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.is_staff(actor) or not public.has_perm(actor,'followup.view') then raise exception 'FORBIDDEN'; end if;
  if p_workspace is null or p_workspace not in ('leads','communication','assessments','enrollments','renewals','students') then raise exception 'VALIDATION'; end if;
  select coalesce(jsonb_agg(public.read_school_support_work_item(i.id) order by i.created_at desc),'[]'::jsonb) into result
    from (select * from public.school_support_work_items w where w.workspace=p_workspace and w.closed_at is null
      and public.school_support_subject_access(w.student_id,w.lead_id,false)
      and (p_workspace='leads' and w.lead_id is null
        or p_workspace='communication' and w.worklist_id is null
        or p_workspace='assessments' and w.registration_id is null
        or p_workspace in ('enrollments','renewals') and not exists(select 1 from public.course_enrollments e where e.opportunity_id=w.opportunity_id and e.status='active'))
      order by w.created_at desc limit 200) i;
  return result;
end;
$$;

-- 挂接已有身份时使用原有的 Lead 业务重挂触发器；未确认的手工资料保持可办理。
do $profile_guard$
declare definition text;
begin
  definition:=pg_get_functiondef('public.ensure_lead_student_profile(uuid)'::regprocedure);
  if position('if v_lead.status in (''invalid'',''converted'') then' in definition)=0 then raise exception 'PROFILE_CREATION_CONTRACT_CHANGED'; end if;
  execute replace(definition,'if v_lead.status in (''invalid'',''converted'') then',
    'if v_lead.manual_identity_pending or nullif(btrim(v_lead.provisional_student_name),'''') is null then
       return jsonb_build_object(''studentId'',null,''studentProfileStatus'',''needs_review'');
     end if;
     if v_lead.status in (''invalid'',''converted'') then');
end;
$profile_guard$;

create function public.materialize_school_support_work_item(p_id uuid,p_work jsonb)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare item public.school_support_work_items%rowtype; actor uuid:=auth.uid(); s public.students%rowtype; l public.leads%rowtype;
  target_activity uuid; target_registration uuid; target_worklist uuid; target_opportunity uuid; activity public.activities%rowtype;
  requested_at timestamptz; arrived boolean; target_row_key text; next_position integer; opportunity_type text;
begin
  select * into item from public.school_support_work_items where id=p_id for update;
  if item.id is null or not public.school_support_subject_access(item.student_id,item.lead_id,true) then raise exception 'FORBIDDEN_SCOPE'; end if;
  if item.closed_at is not null then raise exception 'WORK_ITEM_CLOSED'; end if;
  select * into l from public.leads where id=item.lead_id;
  select * into s from public.students where id=coalesce(item.student_id,l.student_id);
  if item.workspace='communication' and item.worklist_id is null and l.id is not null and l.status not in ('invalid','converted') then
    target_row_key:='lead:'||l.id;
    target_worklist:=(p_work->>'worklistId')::uuid;
    if target_worklist is null then
      -- 同一负责人的同日手工补入复用一张持久工作单。
      perform pg_advisory_xact_lock(hashtextextended('school-support-day:'||actor||':'||item.work_date,0));
      select w.id into target_worklist from public.communication_worklists w
        join public.school_support_work_items previous on previous.worklist_id=w.id
        where w.owner_id=actor and w.work_date=item.work_date and w.closed_at is null
          and previous.workspace='communication' order by w.created_at,w.id limit 1 for update of w;
      if target_worklist is null then
        insert into public.communication_worklists(name,work_date,owner_id,created_by,is_scheduled)
          values('手工联系 / Manual contacts · '||item.work_date,item.work_date,actor,actor,true) returning id into target_worklist;
      end if;
    else
      perform 1 from public.communication_worklists where id=target_worklist and closed_at is null
        and (owner_id=actor or public.has_perm(actor,'student.view.all')) for update;
      if not found then raise exception 'WORKLIST_UNAVAILABLE'; end if;
    end if;
    select coalesce(max(position),0)+1 into next_position from public.communication_worklist_items where worklist_id=target_worklist;
    insert into public.communication_worklist_items(worklist_id,row_key,position) values(target_worklist,target_row_key,next_position)
      on conflict(worklist_id,row_key) do nothing;
    update public.school_support_work_items set worklist_id=target_worklist where id=p_id;
  elsif item.workspace='assessments' and item.registration_id is null then
    target_activity:=(p_work->>'activityId')::uuid;
    requested_at:=(p_work->>'scheduledAt')::timestamptz;
    arrived:=coalesce((p_work->>'arrived')::boolean,false);
    if target_activity is null and requested_at is not null then
      if not isfinite(requested_at) then raise exception 'VALIDATION'; end if;
      insert into public.activities(kind,title,scheduled_at,duration_min,location,created_by,occurred_on)
        values('assessment_1v1',coalesce(nullif(s.name,''),nullif(l.provisional_student_name,''),l.phone)||' · 1 对 1 / 1-to-1',
          requested_at,60,coalesce(p_work->>'location',''),actor,(requested_at at time zone public.get_organization_timezone_v2())::date)
        returning id into target_activity;
    end if;
    if target_activity is not null then
      select * into activity from public.activities where id=target_activity and deleted_at is null and record_state='current' for update;
      if activity.id is null or activity.kind not in ('assessment_1v1','trial_class','public_class','sanbanfu') then raise exception 'ACTIVITY_NOT_AVAILABLE'; end if;
      select r.id into target_registration from public.activity_registrations r left join public.leads related on related.id=r.lead_id
        where r.activity_id=target_activity and (r.lead_id=l.id or s.id is not null and coalesce(r.student_id,related.student_id)=s.id)
        order by r.created_at,r.id limit 1 for update of r;
      if target_registration is not null then
        if exists(select 1 from public.activity_registrations where id=target_registration and (status in ('no_show','cancelled') or record_state<>'current')) then raise exception 'PARTICIPATION_CLOSED'; end if;
        if arrived then update public.activity_registrations set status='attended',operated_by=actor where id=target_registration and status='booked'; end if;
      else
        insert into public.activity_registrations(activity_id,student_id,lead_id,status,operated_by,registered_on)
          values(target_activity,s.id,case when s.id is null then l.id end,case when arrived then 'attended' else 'booked' end,
            actor,(now() at time zone public.get_organization_timezone_v2())::date) returning id into target_registration;
      end if;
      update public.school_support_work_items set registration_id=target_registration where id=p_id;
    end if;
  elsif item.workspace in ('enrollments','renewals') and item.opportunity_id is null and item.course_id is not null and item.term_id is not null then
    opportunity_type:=case when item.workspace='renewals' then 'renewal' else 'new' end;
    target_opportunity:=public.save_course_opportunity(null,null,s.id,case when s.id is null then l.id end,
      opportunity_type,item.course_id,item.term_id,'planning',null,'',null,item.note);
    update public.school_support_work_items set opportunity_id=target_opportunity where id=p_id;
  end if;
end;
$$;

create function public.add_school_support_work_item(p_request_id uuid,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
#variable_conflict use_variable
declare actor uuid:=auth.uid(); workspace text:=p_payload->>'workspace'; subject jsonb:=nullif(p_payload->'subject','null'::jsonb);
  person jsonb:=nullif(p_payload->'newPerson','null'::jsonb); work jsonb:=p_payload->'work';
  student_id uuid; lead_id uuid; name text; phone text; normalized_phone text; grade smallint; note text; work_date date;
  context_key text; item_id uuid; receipt public.school_support_entry_receipts%rowtype;
  s public.students%rowtype; l public.leads%rowtype; create_student boolean; identity_pending boolean; target_course uuid; target_term uuid; target_cycle uuid;
begin
  if actor is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.is_staff(actor) or not public.has_perm(actor,'followup.write') or not public.has_perm(actor,'followup.view') then raise exception 'FORBIDDEN'; end if;
  if p_request_id is null or jsonb_typeof(p_payload) is distinct from 'object' or workspace is null
    or workspace not in ('leads','communication','assessments','enrollments','renewals','students')
    or num_nonnulls(subject,person)<>1 or jsonb_typeof(work) is distinct from 'object' then raise exception 'VALIDATION'; end if;
  if workspace='enrollments' and not public.has_perm(actor,'enrollment.manage') then raise exception 'FORBIDDEN'; end if;
  perform pg_advisory_xact_lock(hashtextextended('school-support-request:'||actor||':'||p_request_id,0));
  select * into receipt from public.school_support_entry_receipts where actor_id=actor and request_id=p_request_id;
  if found then
    if receipt.fingerprint<>md5(p_payload::text) then raise exception 'REQUEST_CONFLICT'; end if;
    return public.read_school_support_work_item(receipt.work_item_id);
  end if;
  note:=btrim(coalesce(work->>'note','')); work_date:=(work->>'date')::date;
  target_course:=(work->>'courseId')::uuid; target_term:=(work->>'termId')::uuid; target_cycle:=(work->>'cycleId')::uuid;
  if length(note)>2000 or length(coalesce(work->>'location',''))>200 or work_date is not null and not isfinite(work_date)
    or workspace='communication' and work_date is null then raise exception 'VALIDATION'; end if;
  if target_course is not null and not exists(select 1 from public.courses where id=target_course and status='enabled'
    and purpose='production' and course_kind='curriculum' and trashed_at is null) then raise exception 'COURSE_NOT_AVAILABLE'; end if;
  if target_term is not null and not exists(select 1 from public.school_terms where id=target_term) then raise exception 'TERM_NOT_FOUND'; end if;
  if target_cycle is not null and not exists(select 1 from public.renewal_cycles where id=target_cycle and status<>'closed') then raise exception 'INVALID_CYCLE_STATE'; end if;
  if subject is not null then
    student_id:=(subject->>'studentId')::uuid; lead_id:=(subject->>'leadId')::uuid;
    if not public.school_support_subject_access(student_id,lead_id,true) then raise exception 'FORBIDDEN_SCOPE'; end if;
    if lead_id is not null then
      select * into l from public.leads where id=lead_id for update;
      if md5(to_jsonb(l)::text) is distinct from subject->>'version' then raise exception 'SUBJECT_CHANGED'; end if;
      if l.status='invalid' then raise exception 'LEAD_CLOSED'; end if;
      student_id:=coalesce(student_id,l.student_id);
    else
      select * into s from public.students where id=student_id for update;
      if md5(to_jsonb(s)::text) is distinct from subject->>'version' then raise exception 'SUBJECT_CHANGED'; end if;
    end if;
  else
    if not public.has_perm(actor,'student.create') then raise exception 'FORBIDDEN'; end if;
    name:=btrim(coalesce(person->>'name','')); phone:=btrim(coalesce(person->>'phone','')); grade:=(person->>'grade')::smallint;
    normalized_phone:=nullif(public.normalize_school_ops_phone(phone),'');
    create_student:=coalesce((person->>'createStudent')::boolean,false);
    identity_pending:=coalesce((person->>'identityPending')::boolean,false) or name='';
    if length(name)>100 or length(phone)>40 or name='' and phone='' or phone<>'' and (normalized_phone is null or normalized_phone !~ '^[0-9]{6,20}$')
      or grade is not null and grade not between 1 and 12 or create_student and (name='' or identity_pending) then raise exception 'VALIDATION'; end if;
    perform pg_advisory_xact_lock(hashtextextended('school-support-person:'||public.normalize_lead_name(name)||':'||coalesce(normalized_phone,''),0));
    if normalized_phone is not null and exists(select 1 from public.leads where normalized_name=public.normalize_lead_name(name) and phone_normalized=normalized_phone) then
      raise exception 'POSSIBLE_DUPLICATE';
    end if;
    if normalized_phone is not null and exists(select 1 from public.students where deleted_at is null
      and public.normalize_lead_name(students.name)=public.normalize_lead_name(name)
      and normalized_phone in (public.normalize_school_ops_phone(students.phone),public.normalize_school_ops_phone(parent_phone)))
      and not coalesce((p_payload->>'acknowledgeDuplicate')::boolean,false) then raise exception 'POSSIBLE_DUPLICATE'; end if;
    if create_student then
      student_id:=public.create_student(name,grade,'','','Manual entry','',''||phone,'');
    end if;
    insert into public.leads(provisional_student_name,normalized_name,phone,phone_normalized,grade_hint,status,owner_id,created_by,
      student_id,identity_confirmed_by,identity_confirmed_at,manual_entry,manual_identity_pending)
      values(name,public.normalize_lead_name(name),phone,normalized_phone,grade,'uncontacted',actor,actor,
        student_id,case when student_id is not null then actor end,case when student_id is not null then now() end,true,identity_pending)
      returning id into lead_id;
  end if;
  if lead_id is null and workspace in ('leads','communication') then
    select * into l from public.leads where leads.student_id=student_id and status not in ('invalid','converted')
      and public.school_support_subject_access(student_id,id,true) order by created_at,id limit 1 for update;
    lead_id:=l.id;
    if lead_id is null then
      select * into s from public.students where id=student_id;
      phone:=coalesce(nullif(s.parent_phone,''),s.phone); normalized_phone:=nullif(public.normalize_school_ops_phone(phone),'');
      -- 已有关联线索占用相同身份键时，保留为按学生办理的工作，继续读取原关系。
      if not exists(select 1 from public.leads where normalized_name=public.normalize_lead_name(s.name) and phone_normalized=normalized_phone) then
        insert into public.leads(provisional_student_name,normalized_name,phone,phone_normalized,grade_hint,status,owner_id,created_by,
          student_id,identity_confirmed_by,identity_confirmed_at,manual_entry)
          values(s.name,public.normalize_lead_name(s.name),phone,normalized_phone,s.grade,'uncontacted',coalesce(s.assigned_to,actor),actor,student_id,actor,now(),true)
          returning id into lead_id;
      end if;
    end if;
  end if;
  context_key:=case when workspace='assessments' then coalesce('activity:'||(work->>'activityId'),'time:'||(work->>'scheduledAt'),'pending')
    when workspace='communication' then coalesce('worklist:'||(work->>'worklistId'),'date:'||work_date)
    when workspace in ('enrollments','renewals') then coalesce('cycle:'||target_cycle,'course:'||target_course||':'||target_term,'pending')
    else 'profile' end;
  perform pg_advisory_xact_lock(hashtextextended('school-support-work:'||coalesce(student_id,lead_id)||':'||workspace||':'||context_key,0));
  select w.id into item_id from public.school_support_work_items w left join public.leads related on related.id=w.lead_id
    where w.workspace=workspace and w.context_key=context_key and w.closed_at is null
      and (lead_id is not null and w.lead_id=lead_id or student_id is not null and coalesce(w.student_id,related.student_id)=student_id)
      order by w.created_at,w.id limit 1 for update of w;
  if item_id is null then
    insert into public.school_support_work_items(workspace,student_id,lead_id,context_key,work_date,note,course_id,term_id,cycle_id,created_by)
      values(workspace,student_id,lead_id,context_key,work_date,note,target_course,target_term,target_cycle,actor) returning id into item_id;
    perform public.materialize_school_support_work_item(item_id,work);
    perform public.emit_domain_event('school_support.student_added','school_support_work_item',item_id,
      jsonb_build_object('workspace',workspace,'studentId',student_id,'leadId',lead_id),actor,null);
  end if;
  insert into public.school_support_entry_receipts(actor_id,request_id,fingerprint,work_item_id) values(actor,p_request_id,md5(p_payload::text),item_id);
  return public.read_school_support_work_item(item_id);
end;
$$;

create function public.read_school_support_profile(p_student_id uuid,p_lead_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
#variable_conflict use_variable
declare s public.students%rowtype; l public.leads%rowtype; fields jsonb; version text; student_id uuid; changes jsonb;
begin
  if not public.school_support_subject_access(p_student_id,p_lead_id,false) then raise exception 'FORBIDDEN_SCOPE'; end if;
  select * into l from public.leads where id=p_lead_id;
  student_id:=coalesce(p_student_id,l.student_id);
  if student_id is not null then
    select * into s from public.students where id=student_id;
    fields:=jsonb_build_object('name',s.name,'grade',s.grade,'phone',s.phone,'parentPhone',s.parent_phone,
      'parentName',s.parent_name,'school',s.school,'wechat',s.wechat,'remark',s.remark);
    version:=md5(to_jsonb(s)::text);
  else
    fields:=jsonb_build_object('name',l.provisional_student_name,'grade',l.grade_hint,'phone',l.phone,'remark',l.note);
    version:=md5(to_jsonb(l)::text);
  end if;
  select coalesce(jsonb_agg(c order by c."recordedAt" desc),'[]'::jsonb) into changes from (
    select c.id,c.before_data as "before",c.after_data as "after",c.recorded_at as "recordedAt",coalesce(p.display_name,'') as "recordedBy"
    from public.school_support_change_log c left join public.profiles p on p.id=c.recorded_by
    where c.kind='profile' and (student_id is not null and c.student_id=student_id or student_id is null and c.lead_id=p_lead_id)
    order by c.recorded_at desc,c.id desc limit 20) c;
  return jsonb_build_object('studentId',student_id,'leadId',p_lead_id,'version',version,'values',fields,
    'canEdit',public.has_perm(auth.uid(),'student.edit') and public.school_support_subject_access(p_student_id,p_lead_id,true),
    'identityPending',coalesce(l.manual_identity_pending,false),'changes',changes);
end;
$$;

create function public.update_school_support_profile(p_student_id uuid,p_lead_id uuid,p_expected_version text,p_values jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
#variable_conflict use_variable
declare actor uuid:=auth.uid(); snapshot jsonb; result jsonb; student_id uuid; l public.leads%rowtype; s public.students%rowtype;
  name text:=btrim(coalesce(p_values->>'name','')); phone text:=btrim(coalesce(p_values->>'phone',''));
  parent_phone text:=btrim(coalesce(p_values->>'parentPhone','')); grade smallint:=(p_values->>'grade')::smallint;
  remark text:=coalesce(p_values->>'remark','');
begin
  if actor is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.has_perm(actor,'student.edit') or not public.school_support_subject_access(p_student_id,p_lead_id,true) then raise exception 'FORBIDDEN_SCOPE'; end if;
  if p_expected_version is null or jsonb_typeof(p_values) is distinct from 'object' or length(name)>100 or length(phone)>40
    or length(parent_phone)>40 or length(coalesce(p_values->>'parentName',''))>100 or length(coalesce(p_values->>'school',''))>100
    or length(coalesce(p_values->>'wechat',''))>80 or length(remark)>2000 or grade is not null and grade not between 1 and 12
    or p_values-array['name','grade','phone','parentPhone','parentName','school','wechat','remark']<>'{}'::jsonb then raise exception 'VALIDATION'; end if;
  select * into l from public.leads where id=p_lead_id for update;
  student_id:=coalesce(p_student_id,l.student_id);
  if student_id is not null then
    select * into s from public.students where id=student_id for update;
    if name='' then raise exception 'VALIDATION'; end if;
  elsif name='' and phone='' then raise exception 'VALIDATION'; end if;
  snapshot:=public.read_school_support_profile(p_student_id,p_lead_id);
  if snapshot->>'version' is distinct from p_expected_version then raise exception 'PROFILE_CONFLICT'; end if;
  if student_id is not null then
    update public.students set name=name,grade=grade,
      phone=phone,parent_phone=parent_phone,
      parent_name=coalesce(p_values->>'parentName',''),school=coalesce(p_values->>'school',''),wechat=coalesce(p_values->>'wechat',''),
      remark=remark,updated_at=clock_timestamp() where id=student_id;
    -- 更新直接沿用档案信息的线索摘要；独立联系人和原始导入凭据继续保留。
    update public.leads linked set
      provisional_student_name=case when linked.normalized_name=public.normalize_lead_name(s.name) then name else linked.provisional_student_name end,
      normalized_name=case when linked.normalized_name=public.normalize_lead_name(s.name) then public.normalize_lead_name(name) else linked.normalized_name end,
      grade_hint=case when linked.grade_hint is not distinct from s.grade then grade else linked.grade_hint end,
      phone=case when linked.phone=coalesce(nullif(s.parent_phone,''),s.phone) then coalesce(nullif(parent_phone,''),phone) else linked.phone end,
      phone_normalized=case when linked.phone=coalesce(nullif(s.parent_phone,''),s.phone) then nullif(public.normalize_school_ops_phone(coalesce(nullif(parent_phone,''),phone)),'') else linked.phone_normalized end,
      manual_entry=linked.manual_entry or coalesce(nullif(parent_phone,''),phone)='',updated_at=clock_timestamp()
      where linked.student_id=student_id;
  else
    if phone<>'' and public.normalize_school_ops_phone(phone) !~ '^[0-9]{6,20}$' then raise exception 'VALIDATION'; end if;
    update public.leads set provisional_student_name=name,normalized_name=public.normalize_lead_name(name),
      phone=phone,phone_normalized=nullif(public.normalize_school_ops_phone(phone),''),
      grade_hint=grade,note=remark,manual_entry=manual_entry or phone='' or name='',updated_at=clock_timestamp() where id=p_lead_id;
  end if;
  result:=public.read_school_support_profile(student_id,p_lead_id);
  insert into public.school_support_change_log(student_id,lead_id,kind,before_data,after_data,recorded_by)
    values(student_id,p_lead_id,'profile',snapshot->'values',result->'values',actor);
  return public.read_school_support_profile(student_id,p_lead_id);
exception when unique_violation then raise exception 'CONTACT_CONFLICT';
end;
$$;

create function public.update_school_support_work_item(p_id uuid,p_expected_revision integer,p_work jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare actor uuid:=auth.uid(); item public.school_support_work_items%rowtype; before jsonb; target_course uuid; target_term uuid; closed boolean;
begin
  select * into item from public.school_support_work_items where id=p_id for update;
  if item.id is null then raise exception 'NOT_FOUND'; end if;
  if not public.school_support_subject_access(item.student_id,item.lead_id,true) then raise exception 'FORBIDDEN_SCOPE'; end if;
  if item.revision is distinct from p_expected_revision then raise exception 'WORK_ITEM_CONFLICT'; end if;
  if item.closed_at is not null then raise exception 'WORK_ITEM_CLOSED'; end if;
  if jsonb_typeof(p_work) is distinct from 'object' or length(coalesce(p_work->>'note',''))>2000
    or length(coalesce(p_work->>'location',''))>200 then raise exception 'VALIDATION'; end if;
  target_course:=(p_work->>'courseId')::uuid; target_term:=(p_work->>'termId')::uuid;
  closed:=coalesce((p_work->>'closed')::boolean,false);
  if item.opportunity_id is not null and (target_course is distinct from item.course_id or target_term is distinct from item.term_id) then raise exception 'BUSINESS_CHANGE_REQUIRED'; end if;
  if target_course is not null and not exists(select 1 from public.courses where id=target_course and status='enabled'
    and purpose='production' and course_kind='curriculum' and trashed_at is null) then raise exception 'COURSE_NOT_AVAILABLE'; end if;
  if target_term is not null and not exists(select 1 from public.school_terms where id=target_term) then raise exception 'TERM_NOT_FOUND'; end if;
  before:=to_jsonb(item);
  update public.school_support_work_items set note=btrim(coalesce(p_work->>'note','')),course_id=target_course,term_id=target_term,
    revision=revision+1,updated_at=clock_timestamp(),closed_at=case when closed then now() end where id=p_id;
  if not closed then perform public.materialize_school_support_work_item(p_id,p_work); end if;
  insert into public.school_support_change_log(work_item_id,student_id,lead_id,kind,before_data,after_data,recorded_by)
    values(p_id,item.student_id,item.lead_id,'work',before,public.read_school_support_work_item(p_id),actor);
  return public.read_school_support_work_item(p_id);
end;
$$;

create function public.resolve_school_support_identity(p_lead_id uuid,p_student_id uuid,p_expected_version text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare actor uuid:=auth.uid(); l public.leads%rowtype; before jsonb;
begin
  if actor is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.has_perm(actor,'student.edit') or not public.school_support_subject_access(null,p_lead_id,true)
    or not public.school_support_subject_access(p_student_id,null,true) then raise exception 'FORBIDDEN_SCOPE'; end if;
  select * into l from public.leads where id=p_lead_id for update;
  if md5(to_jsonb(l)::text) is distinct from p_expected_version then raise exception 'PROFILE_CONFLICT'; end if;
  if not l.manual_entry or l.student_id is not null then raise exception 'IDENTITY_CHANGE_REQUIRED'; end if;
  if exists(select 1 from public.school_support_work_items source join public.school_support_work_items target
    on target.workspace=source.workspace and target.context_key=source.context_key and target.id<>source.id
    left join public.leads target_lead on target_lead.id=target.lead_id
    where source.lead_id=p_lead_id and source.closed_at is null and target.closed_at is null
      and coalesce(target.student_id,target_lead.student_id)=p_student_id) then raise exception 'ASSOCIATION_CONFLICT'; end if;
  before:=jsonb_build_object('studentId',l.student_id,'identityPending',l.manual_identity_pending);
  update public.leads set student_id=p_student_id,identity_confirmed_by=actor,identity_confirmed_at=now(),
    manual_identity_pending=false,updated_at=clock_timestamp() where id=p_lead_id;
  update public.school_support_work_items set student_id=p_student_id,revision=revision+1,updated_at=clock_timestamp() where lead_id=p_lead_id;
  insert into public.school_support_change_log(student_id,lead_id,kind,before_data,after_data,recorded_by)
    values(p_student_id,p_lead_id,'identity',before,jsonb_build_object('studentId',p_student_id,'identityPending',false),actor);
  return public.read_school_support_profile(p_student_id,p_lead_id);
exception when unique_violation then raise exception 'ASSOCIATION_CONFLICT';
end;
$$;

create function public.confirm_school_support_identity(p_lead_id uuid,p_expected_version text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare actor uuid:=auth.uid(); l public.leads%rowtype; result jsonb; target_student uuid;
begin
  if actor is null or not public.has_perm(actor,'student.create') or not public.has_perm(actor,'student.edit')
    or not public.school_support_subject_access(null,p_lead_id,true) then raise exception 'FORBIDDEN_SCOPE'; end if;
  select * into l from public.leads where id=p_lead_id for update;
  if md5(to_jsonb(l)::text) is distinct from p_expected_version then raise exception 'PROFILE_CONFLICT'; end if;
  if not l.manual_entry or l.student_id is not null or nullif(btrim(l.provisional_student_name),'') is null then raise exception 'IDENTITY_CHANGE_REQUIRED'; end if;
  if exists(select 1 from public.students s where s.deleted_at is null and public.normalize_lead_name(s.name)=l.normalized_name
    and l.phone_normalized is not null and l.phone_normalized in (public.normalize_school_ops_phone(s.phone),public.normalize_school_ops_phone(s.parent_phone))) then raise exception 'POSSIBLE_DUPLICATE'; end if;
  target_student:=public.create_student(l.provisional_student_name,l.grade_hint,'','','','',''||l.phone,'');
  result:=public.resolve_school_support_identity(l.id,target_student,p_expected_version);
  return result;
end;
$$;

-- 管理员办理未分配档案与既有登记入口采用同一范围条件。
do $worklist_guard$
declare definition text;
begin
  definition:=pg_get_functiondef('public.can_access_communication_row(text,boolean)'::regprocedure);
  if position('and v_lead.owner_id is not null' in definition)=0 then raise exception 'COMMUNICATION_SCOPE_CONTRACT_CHANGED'; end if;
  execute replace(definition,'and v_lead.owner_id is not null',
    'and (v_lead.owner_id is not null or public.has_perm(v_uid,''student.view.all''))');
end;
$worklist_guard$;

revoke all on function public.school_support_subject_access(uuid,uuid,boolean) from public,anon,authenticated,service_role;
grant execute on function public.school_support_subject_access(uuid,uuid,boolean) to authenticated;
revoke all on function public.materialize_school_support_work_item(uuid,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.search_school_support_subjects(text),public.read_school_support_work_item(uuid),public.list_school_support_work_items(text),
  public.add_school_support_work_item(uuid,jsonb),public.read_school_support_profile(uuid,uuid),
  public.update_school_support_profile(uuid,uuid,text,jsonb),public.update_school_support_work_item(uuid,integer,jsonb),
  public.resolve_school_support_identity(uuid,uuid,text),public.confirm_school_support_identity(uuid,text) from public,anon,authenticated;
grant execute on function public.search_school_support_subjects(text),public.read_school_support_work_item(uuid),public.list_school_support_work_items(text),
  public.add_school_support_work_item(uuid,jsonb),public.read_school_support_profile(uuid,uuid),
  public.update_school_support_profile(uuid,uuid,text,jsonb),public.update_school_support_work_item(uuid,integer,jsonb),
  public.resolve_school_support_identity(uuid,uuid,text),public.confirm_school_support_identity(uuid,text) to authenticated;
