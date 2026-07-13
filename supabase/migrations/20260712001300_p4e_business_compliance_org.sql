-- P4E-W/C/O：课消与补课、合并、课堂事实、合规与组织身份。

alter table public.profiles add column if not exists is_active boolean not null default true;

-- ---------------------------------------------------------------------------
-- 考勤 -> 课时账：每次状态变化写冲正，绝不覆盖历史流水。
-- ---------------------------------------------------------------------------

alter table public.student_accounts add column if not exists lesson_balance numeric(10,2) not null default 0;
create table public.consume_rules(
  classroom_id uuid primary key references public.classrooms(id) on delete cascade,
  present_lessons numeric(6,2) not null default 1 check(present_lessons>=0),
  late_lessons numeric(6,2) not null default 1 check(late_lessons>=0),
  absent_lessons numeric(6,2) not null default 1 check(absent_lessons>=0),
  leave_lessons numeric(6,2) not null default 0 check(leave_lessons>=0),
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);
create table public.lesson_ledger(
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id),
  session_id uuid references public.class_sessions(id),
  attendance_status text not null,
  lesson_delta numeric(10,2) not null check(lesson_delta<>0),
  reverses_id uuid references public.lesson_ledger(id),
  operator_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index lesson_ledger_student_idx on public.lesson_ledger(student_id,created_at desc);

create or replace function public.apply_attendance_consumption()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare cid uuid; amount numeric; previous public.lesson_ledger; entry_id uuid;
begin
  select classroom_id into cid from public.class_sessions where id=new.session_id;
  if tg_op='UPDATE' and new.status is not distinct from old.status then return new; end if;
  if tg_op='UPDATE' then
    select * into previous from public.lesson_ledger
      where session_id=old.session_id and student_id=old.student_id and reverses_id is null
      order by created_at desc limit 1;
    if previous.id is not null then
      insert into public.lesson_ledger(student_id,session_id,attendance_status,lesson_delta,reverses_id,operator_id)
      values(old.student_id,old.session_id,old.status,-previous.lesson_delta,previous.id,auth.uid());
      update public.student_accounts set lesson_balance=lesson_balance-previous.lesson_delta,updated_at=now()
       where student_id=old.student_id;
    end if;
  end if;
  select case new.status when 'present' then present_lessons when 'late' then late_lessons
    when 'absent' then absent_lessons when 'leave' then leave_lessons end into amount
    from public.consume_rules where classroom_id=cid;
  if coalesce(amount,0)>0 then
    insert into public.student_accounts(student_id,lesson_balance) values(new.student_id,0) on conflict do nothing;
    insert into public.lesson_ledger(student_id,session_id,attendance_status,lesson_delta,operator_id)
    values(new.student_id,new.session_id,new.status,-amount,auth.uid()) returning id into entry_id;
    update public.student_accounts set lesson_balance=lesson_balance-amount,updated_at=now() where student_id=new.student_id;
    perform public.emit_domain_event('attendance.consumed','student',new.student_id,
      jsonb_build_object('sessionId',new.session_id,'status',new.status,'lessonDelta',-amount,'ledgerId',entry_id),null,null);
  end if;
  if new.status='leave' and not exists(select 1 from public.session_changes where session_id=new.session_id and student_id=new.student_id and kind='leave') then
    insert into public.session_changes(session_id,student_id,kind,from_session,reason,operated_by)
    values(new.session_id,new.student_id,'leave',new.session_id,new.note,coalesce(auth.uid(),new.marked_by));
  end if;
  return new;
end $$;
create trigger attendance_consumes_lessons after insert or update of status on public.session_attendance
  for each row execute function public.apply_attendance_consumption();

alter table public.consume_rules enable row level security;
alter table public.lesson_ledger enable row level security;
create policy consume_rules_staff_read on public.consume_rules for select to authenticated using(public.is_staff((select auth.uid())));
create policy consume_rules_staff_write on public.consume_rules for all to authenticated
 using(public.has_perm((select auth.uid()),'finance.account.adjust')) with check(public.has_perm((select auth.uid()),'finance.account.adjust'));
create policy lesson_ledger_scope on public.lesson_ledger for select to authenticated
 using(public.can_access_student(student_id,(select auth.uid())) or exists(select 1 from public.students s where s.id=student_id and (s.user_id=(select auth.uid()) or exists(select 1 from public.student_guardians g where g.student_id=s.id and g.guardian_id=(select auth.uid()) and 'finance'=any(g.scope)))));
revoke all on public.consume_rules,public.lesson_ledger from anon,authenticated;
grant select,insert,update on public.consume_rules to authenticated;
grant select on public.lesson_ledger to authenticated;

-- ---------------------------------------------------------------------------
-- 请假/调课/补课与按次代课
-- ---------------------------------------------------------------------------

alter table public.class_sessions add column if not exists teacher_override uuid references public.profiles(id) on delete set null;
create table public.session_changes(
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.class_sessions(id),
  student_id uuid references public.students(id),
  kind text not null check(kind in ('leave','reschedule','makeup','substitute')),
  from_session uuid references public.class_sessions(id),
  to_session uuid references public.class_sessions(id),
  reason text not null default '',
  operated_by uuid not null references public.profiles(id),
  term_id uuid references public.school_terms(id),
  created_at timestamptz not null default now()
);
create index session_changes_student_idx on public.session_changes(student_id,created_at desc);
create trigger session_changes_fill_term before insert on public.session_changes for each row execute function public.fill_current_term();

create or replace function public.is_session_teacher(sid uuid,uid uuid)
returns boolean language sql security definer stable set search_path=public,pg_temp as $$
 select public.is_admin(uid) or exists(
   select 1 from public.class_sessions s left join public.classroom_members m
     on m.classroom_id=s.classroom_id and m.user_id=uid and m.role='teacher'
   join public.profiles p on p.id=uid and p.is_active
   where s.id=sid and (s.teacher_override=uid or m.user_id is not null)
 )
$$;

create or replace function public.record_session_change(
 p_session_id uuid,p_student_id uuid,p_kind text,p_to_session uuid default null,p_reason text default ''
) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare uid uuid:=auth.uid(); cid uuid; change_id uuid;
begin
 select classroom_id into cid from public.class_sessions where id=p_session_id and deleted_at is null;
 if uid is null or cid is null or not public.can_mark_attendance(cid,uid) then raise exception 'FORBIDDEN'; end if;
 if p_kind not in ('leave','reschedule','makeup','substitute') then raise exception 'INVALID_KIND'; end if;
 insert into public.session_changes(session_id,student_id,kind,from_session,to_session,reason,operated_by)
 values(p_session_id,p_student_id,p_kind,p_session_id,p_to_session,left(trim(coalesce(p_reason,'')),1000),uid)
 returning id into change_id;
 perform public.emit_domain_event('session_change.'||p_kind,'session_change',change_id,
   jsonb_build_object('sessionId',p_session_id,'studentId',p_student_id,'toSession',p_to_session),null,null);
 return change_id;
end $$;

alter table public.session_changes enable row level security;
create policy session_changes_scope on public.session_changes for select to authenticated
 using(student_id is null or public.can_access_student(student_id,(select auth.uid())) or exists(select 1 from public.students s where s.id=student_id and (s.user_id=(select auth.uid()) or exists(select 1 from public.student_guardians g where g.student_id=s.id and g.guardian_id=(select auth.uid())))));
revoke all on public.session_changes from anon,authenticated;
grant select on public.session_changes to authenticated;
revoke all on function public.record_session_change(uuid,uuid,text,uuid,text) from public,anon,authenticated;
grant execute on function public.record_session_change(uuid,uuid,text,uuid,text) to authenticated;

-- 权威课堂状态只能由教师 RPC 落库；广播只负责提速。
create or replace function public.set_session_authoritative_state(p_session_id uuid,p_current_page int)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if auth.uid() is null or not public.is_session_teacher(p_session_id,auth.uid()) then raise exception 'FORBIDDEN'; end if;
 if p_current_page<0 then raise exception 'INVALID_PAGE'; end if;
 update public.class_sessions set current_page=p_current_page where id=p_session_id and deleted_at is null;
 if not found then raise exception 'SESSION_NOT_FOUND'; end if;
 perform public.emit_domain_event('session.page_changed','class_session',p_session_id,jsonb_build_object('page',p_current_page),null,null);
end $$;
revoke all on function public.set_session_authoritative_state(uuid,int) from public,anon,authenticated;
grant execute on function public.set_session_authoritative_state(uuid,int) to authenticated;
revoke update(current_page) on public.class_sessions from authenticated;

-- ---------------------------------------------------------------------------
-- 学生软查重与合并留痕。冲突时事务整体回滚，避免部分迁移。
-- ---------------------------------------------------------------------------

create table public.student_merges(
 id uuid primary key default gen_random_uuid(),kept_id uuid not null references public.students(id),
 merged_id uuid not null references public.students(id),operated_by uuid not null references public.profiles(id),
 merged_at timestamptz not null default now(),unique(merged_id)
);

create or replace function public.find_duplicate_students(p_name text,p_phone text default '')
returns table(id uuid,name text,phone text,status text) language sql security definer stable set search_path=public,pg_temp as $$
 select s.id,s.name,s.phone,s.status from public.students s where s.deleted_at is null
   and (nullif(regexp_replace(coalesce(p_phone,''),'\D','','g'),'') is not null and regexp_replace(s.phone,'\D','','g')=regexp_replace(p_phone,'\D','','g')
     or (lower(trim(s.name))=lower(trim(p_name)) and trim(p_name)<>''))
   and public.can_access_student(s.id,auth.uid()) limit 20
$$;

create or replace function public.merge_students(p_kept_id uuid,p_merged_id uuid)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare uid uuid:=auth.uid(); old_balance numeric; old_lessons numeric; merged_user uuid;
begin
 if p_kept_id=p_merged_id then raise exception 'SAME_STUDENT'; end if;
 if uid is null or not public.has_perm(uid,'student.edit') or not public.can_access_student(p_kept_id,uid) or not public.can_access_student(p_merged_id,uid)
 then raise exception 'FORBIDDEN'; end if;
 perform 1 from public.students where id in(p_kept_id,p_merged_id) order by id for update;
 select user_id into merged_user from public.students where id=p_merged_id;
 insert into public.student_guardians(student_id,guardian_id,relation,scope,created_at)
 select p_kept_id,guardian_id,relation,scope,created_at from public.student_guardians where student_id=p_merged_id
 on conflict(student_id,guardian_id) do update set scope=(select array(select distinct unnest(public.student_guardians.scope||excluded.scope)));
 delete from public.student_guardians where student_id=p_merged_id;
 update public.student_follow_ups set student_id=p_kept_id where student_id=p_merged_id;
 update public.orders set student_id=p_kept_id where student_id=p_merged_id;
 update public.account_ledger set student_id=p_kept_id where student_id=p_merged_id;
 update public.lesson_ledger set student_id=p_kept_id where student_id=p_merged_id;
 update public.session_videos set student_id=p_kept_id where student_id=p_merged_id;
 update public.session_changes set student_id=p_kept_id where student_id=p_merged_id;
 delete from public.activity_registrations a using public.activity_registrations k where a.student_id=p_merged_id and k.student_id=p_kept_id and k.activity_id=a.activity_id;
 update public.activity_registrations set student_id=p_kept_id where student_id=p_merged_id;
 -- 以下复合唯一表若 kept 已有同一事实，保留 kept 行并删除 merged 行。
 delete from public.session_attendance a using public.session_attendance k where a.student_id=p_merged_id and k.student_id=p_kept_id and k.session_id=a.session_id;
 update public.session_attendance set student_id=p_kept_id where student_id=p_merged_id;
 delete from public.session_reviews a using public.session_reviews k where a.student_id=p_merged_id and k.student_id=p_kept_id and k.session_id=a.session_id;
 update public.session_reviews set student_id=p_kept_id where student_id=p_merged_id;
 delete from public.enrollments a using public.enrollments k where a.student_id=p_merged_id and k.student_id=p_kept_id and k.classroom_id=a.classroom_id and k.left_at is not distinct from a.left_at;
 update public.enrollments set student_id=p_kept_id where student_id=p_merged_id;
 delete from public.student_grade_history a using public.student_grade_history k where a.student_id=p_merged_id and k.student_id=p_kept_id and k.term_id=a.term_id;
 update public.student_grade_history set student_id=p_kept_id where student_id=p_merged_id;
 update public.guardian_consents set student_id=p_kept_id where student_id=p_merged_id;
 update public.guardian_bind_invitations set student_id=p_kept_id where student_id=p_merged_id;
 select balance,lesson_balance into old_balance,old_lessons from public.student_accounts where student_id=p_merged_id for update;
 insert into public.student_accounts(student_id,balance,lesson_balance) values(p_kept_id,coalesce(old_balance,0),coalesce(old_lessons,0))
 on conflict(student_id) do update set balance=public.student_accounts.balance+excluded.balance,lesson_balance=public.student_accounts.lesson_balance+excluded.lesson_balance,updated_at=now();
 delete from public.student_accounts where student_id=p_merged_id;
 update public.students set deleted_at=now(),user_id=null where id=p_merged_id;
 update public.students set user_id=coalesce(user_id,merged_user) where id=p_kept_id;
 insert into public.student_merges(kept_id,merged_id,operated_by) values(p_kept_id,p_merged_id,uid);
 perform public.emit_domain_event('student.merged','student',p_kept_id,jsonb_build_object('mergedId',p_merged_id),null,null);
end $$;
alter table public.student_merges enable row level security;
create policy student_merges_scope on public.student_merges for select to authenticated using(public.can_access_student(kept_id,(select auth.uid())));
revoke all on public.student_merges from anon,authenticated;grant select on public.student_merges to authenticated;
revoke all on function public.find_duplicate_students(text,text) from public,anon,authenticated;
revoke all on function public.merge_students(uuid,uuid) from public,anon,authenticated;
grant execute on function public.find_duplicate_students(text,text),public.merge_students(uuid,uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 未成年人合规：监护人单独同意、注销/导出申请、平台 UGC 审核。
-- ---------------------------------------------------------------------------

create table public.guardian_consents(
 id uuid primary key default gen_random_uuid(),student_id uuid not null references public.students(id),
 guardian_id uuid not null references public.profiles(id),scope text not null check(scope in ('profile','learning','video')),
 consented boolean not null,consented_at timestamptz not null default now(),ip_hint text,
 unique(student_id,guardian_id,scope,consented_at)
);
create table public.account_requests(
 id uuid primary key default gen_random_uuid(),user_id uuid not null references public.profiles(id),
 kind text not null check(kind in ('delete','export')),status text not null default 'pending' check(status in ('pending','processing','done','rejected')),
 reason text not null default '',created_at timestamptz not null default now(),handled_by uuid references public.profiles(id),handled_at timestamptz
);
alter table public.posts add column if not exists review_status text not null default 'approved'
 check(review_status in ('pending','approved','rejected','hidden'));

create or replace function public.record_guardian_consent(p_student_id uuid,p_scope text,p_consented boolean)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare cid uuid;
begin
 if auth.uid() is null or not exists(select 1 from public.student_guardians where student_id=p_student_id and guardian_id=auth.uid()) then raise exception 'FORBIDDEN'; end if;
 insert into public.guardian_consents(student_id,guardian_id,scope,consented) values(p_student_id,auth.uid(),p_scope,p_consented) returning id into cid;
 if not p_consented then
   update public.student_guardians set scope=array_remove(scope,case p_scope when 'learning' then 'grades' else p_scope end)
    where student_id=p_student_id and guardian_id=auth.uid();
 end if;
 perform public.emit_domain_event('consent.recorded','student',p_student_id,jsonb_build_object('scope',p_scope,'consented',p_consented),auth.uid(),null);
 return cid;
end $$;
create or replace function public.request_account_action(p_kind text,p_reason text default '')
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare rid uuid;
begin
 if auth.uid() is null then raise exception 'UNAUTHENTICATED'; end if;
 if p_kind not in('delete','export') then raise exception 'INVALID_KIND'; end if;
 insert into public.account_requests(user_id,kind,reason) values(auth.uid(),p_kind,left(trim(coalesce(p_reason,'')),1000)) returning id into rid;
 return rid;
end $$;

alter table public.guardian_consents enable row level security;alter table public.account_requests enable row level security;
create policy guardian_consents_own on public.guardian_consents for select to authenticated using(guardian_id=(select auth.uid()) or public.has_perm((select auth.uid()),'audit.view'));
create policy account_requests_own on public.account_requests for select to authenticated using(user_id=(select auth.uid()) or public.has_perm((select auth.uid()),'audit.view'));
revoke all on public.guardian_consents,public.account_requests from anon,authenticated;grant select on public.guardian_consents,public.account_requests to authenticated;
revoke all on function public.record_guardian_consent(uuid,text,boolean),public.request_account_action(text,text) from public,anon,authenticated;
grant execute on function public.record_guardian_consent(uuid,text,boolean),public.request_account_action(text,text) to authenticated;

-- ---------------------------------------------------------------------------
-- 员工停用与交接。profiles.is_active 同时进入 is_staff/has_perm。
-- ---------------------------------------------------------------------------

alter table public.profiles add column if not exists is_active boolean not null default true;
create or replace function public.is_staff(uid uuid) returns boolean language sql security definer stable set search_path=public,pg_temp as $$
 select exists(select 1 from public.profiles where id=uid and role in('staff','admin') and is_active)
$$;
create or replace function public.has_perm(uid uuid,p_key text) returns boolean language sql security definer stable set search_path=public,pg_temp as $$
 select public.is_admin(uid) or (public.is_staff(uid) and exists(select 1 from public.staff_role_members m join public.role_permissions rp on rp.role_id=m.role_id where m.user_id=uid and rp.perm_key=p_key))
$$;
create or replace function public.deactivate_staff(p_target uuid,p_reassign_to uuid)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if auth.uid() is null or not public.has_perm(auth.uid(),'staff.manage') or p_target=auth.uid() then raise exception 'FORBIDDEN'; end if;
 if p_reassign_to is not null and not public.is_staff(p_reassign_to) then raise exception 'INVALID_REPLACEMENT'; end if;
 update public.students set assigned_to=p_reassign_to where assigned_to=p_target and deleted_at is null;
 update public.class_sessions set teacher_override=p_reassign_to where teacher_override=p_target and coalesce(scheduled_at,now())>=now() and deleted_at is null;
 if p_reassign_to is not null then
   insert into public.classroom_members(classroom_id,user_id,role)
   select classroom_id,p_reassign_to,'teacher' from public.classroom_members where user_id=p_target and role='teacher' on conflict do nothing;
 end if;
 update public.profiles set is_active=false where id=p_target and role='staff';
 perform public.emit_domain_event('staff.deactivated','profile',p_target,jsonb_build_object('reassignedTo',p_reassign_to),null,null);
end $$;
revoke all on function public.deactivate_staff(uuid,uuid) from public,anon,authenticated;grant execute on function public.deactivate_staff(uuid,uuid) to authenticated;

drop function if exists public.list_staff_members();
create function public.list_staff_members()
returns table(user_id uuid,display_name text,email text,identity text,role_ids uuid[],role_names text[],can_follow_up boolean,is_active boolean)
language sql security definer stable set search_path=public,pg_temp as $$
 select p.id,p.display_name,u.email::text,p.role,coalesce(r.role_ids,'{}'::uuid[]),coalesce(r.role_names,'{}'::text[]),
   p.is_active and public.has_perm(p.id,'followup.write'),p.is_active
 from public.profiles p join auth.users u on u.id=p.id
 left join lateral(select array_agg(sr.id order by sr.created_at) role_ids,array_agg(sr.name order by sr.created_at) role_names
   from public.staff_role_members m join public.staff_roles sr on sr.id=m.role_id where m.user_id=p.id)r on true
 where p.role in('staff','admin') and (public.has_perm(auth.uid(),'staff.manage') or (public.has_perm(auth.uid(),'student.assign') and p.is_active and public.has_perm(p.id,'followup.write')))
 order by p.is_active desc,p.role desc,p.display_name
$$;
revoke all on function public.list_staff_members() from public,anon,authenticated;grant execute on function public.list_staff_members() to authenticated;

create or replace function public.guardian_can(p_student_id uuid,p_uid uuid,p_scope text)
returns boolean language sql security definer stable set search_path=public,pg_temp as $$
 select exists(select 1 from public.student_guardians where student_id=p_student_id and guardian_id=p_uid and p_scope=any(scope))
$$;
revoke all on function public.guardian_can(uuid,uuid,text) from public;grant execute on function public.guardian_can(uuid,uuid,text) to authenticated;

create or replace function public.get_my_orders()
returns table(order_id uuid,order_no text,classroom_name text,kind text,amount_original numeric,amount_discount numeric,amount_due numeric,status text,created_at timestamptz,paid_total numeric,items jsonb)
language sql security definer stable set search_path=public,pg_temp as $$
 select o.id,o.order_no,c.name,o.kind,o.amount_original,o.amount_discount,o.amount_due,o.status,o.created_at,
  coalesce((select sum(p.amount) from public.payments p where p.order_id=o.id),0),
  coalesce((select jsonb_agg(jsonb_build_object('name',oi.name,'unitPrice',oi.unit_price,'qty',oi.qty) order by oi.name) from public.order_items oi where oi.order_id=o.id),'[]'::jsonb)
 from public.orders o left join public.classrooms c on c.id=o.classroom_id join public.students s on s.id=o.student_id
 where s.user_id=auth.uid() or public.guardian_can(s.id,auth.uid(),'finance') order by o.created_at desc
$$;
create or replace function public.get_my_account()
returns table(student_id uuid,student_name text,balance numeric,ledger jsonb)
language sql security definer stable set search_path=public,pg_temp as $$
 select s.id,s.name,coalesce(sa.balance,0),coalesce((select jsonb_agg(jsonb_build_object('delta',al.delta,'reason',al.reason,'createdAt',al.created_at) order by al.created_at desc) from (select * from public.account_ledger where student_id=s.id order by created_at desc limit 50) al),'[]'::jsonb)
 from public.students s left join public.student_accounts sa on sa.student_id=s.id
 where s.user_id=auth.uid() or public.guardian_can(s.id,auth.uid(),'finance')
$$;
create or replace function public.get_my_session_reviews(p_from timestamptz,p_to timestamptz)
returns table(session_id uuid,student_id uuid,student_name text,classroom_name text,lecture_name text,scheduled_at timestamptz,entry_score numeric,exit_score numeric,focus smallint,participation smallint,mastery smallint,comment text,knowledge_summary text)
language sql security definer stable set search_path=public,pg_temp as $$
 select cs.id,s.id,s.name,c.name,cs.title,cs.scheduled_at,sr.entry_score,sr.exit_score,sr.focus,sr.participation,sr.mastery,sr.comment,cs.knowledge_summary
 from public.session_reviews sr join public.class_sessions cs on cs.id=sr.session_id join public.classrooms c on c.id=cs.classroom_id join public.students s on s.id=sr.student_id
 where s.deleted_at is null and cs.deleted_at is null and cs.scheduled_at>=p_from and cs.scheduled_at<p_to
  and (s.user_id=auth.uid() or public.guardian_can(s.id,auth.uid(),'grades')) order by cs.scheduled_at desc
$$;
create or replace function public.get_my_reviewed_videos()
returns table(video_id uuid,session_id uuid,student_id uuid,review_score smallint,review_comment text)
language sql security definer stable set search_path=public,pg_temp as $$
 select v.id,v.session_id,v.student_id,v.review_score,v.review_comment from public.session_videos v join public.students s on s.id=v.student_id
 where v.deleted_at is null and v.reviewed_at is not null and s.deleted_at is null
  and (s.user_id=auth.uid() or public.guardian_can(s.id,auth.uid(),'video'))
$$;

create policy posts_review_status_anon on public.posts as restrictive for select to anon
 using(review_status='approved');
create policy posts_review_status_authenticated on public.posts as restrictive for select to authenticated
 using(review_status='approved' or author_id=(select auth.uid()) or public.is_admin((select auth.uid())));
