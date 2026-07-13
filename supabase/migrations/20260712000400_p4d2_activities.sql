-- P4D-2：获客活动、报名与到场结果。

create table public.activities (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('trial_class','assessment_1v1','sanbanfu','lecture','competition')),
  title text not null,
  scheduled_at timestamptz not null,
  duration_min smallint,
  location text not null default '',
  capacity smallint,
  remark text not null default '',
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);
create table public.activity_registrations (
  id uuid primary key default gen_random_uuid(),
  activity_id uuid not null references public.activities(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  status text not null default 'booked' check (status in ('booked','attended','no_show','cancelled')),
  outcome text not null default '',
  operated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(activity_id,student_id)
);
create index activities_schedule_idx on public.activities(scheduled_at) where deleted_at is null;
create index activity_registrations_student_idx on public.activity_registrations(student_id);
create trigger activity_registrations_set_updated_at before update on public.activity_registrations
  for each row execute function public.set_updated_at();

alter table public.student_follow_ups drop constraint if exists student_follow_ups_kind_check;
alter table public.student_follow_ups add constraint student_follow_ups_kind_check
  check (kind in ('note','call','class','visit','activity'));

alter table public.activities enable row level security;
alter table public.activity_registrations enable row level security;
create policy activities_staff_select on public.activities for select to authenticated using (public.is_staff((select auth.uid())));
create policy activity_registrations_staff_select on public.activity_registrations for select to authenticated using (public.is_staff((select auth.uid())));
revoke all on public.activities from anon, authenticated;
revoke all on public.activity_registrations from anon, authenticated;
grant select on public.activities, public.activity_registrations to authenticated;

create or replace function public.create_activity(p_kind text,p_title text,p_scheduled_at timestamptz,p_duration_min smallint default null,p_location text default '',p_capacity smallint default null,p_remark text default '')
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare uid uuid:=auth.uid(); aid uuid;
begin
 if uid is null or not public.has_perm(uid,'activity.manage') then raise exception 'FORBIDDEN'; end if;
 if p_kind not in ('trial_class','assessment_1v1','sanbanfu','lecture','competition') then raise exception 'INVALID_KIND'; end if;
 if trim(coalesce(p_title,''))='' then raise exception 'EMPTY_TITLE'; end if;
 insert into public.activities(kind,title,scheduled_at,duration_min,location,capacity,remark,created_by)
 values(p_kind,left(trim(p_title),100),p_scheduled_at,p_duration_min,left(trim(coalesce(p_location,'')),100),p_capacity,left(trim(coalesce(p_remark,'')),1000),uid)
 returning id into aid; return aid;
end $$;

create or replace function public.update_activity(p_activity_id uuid,p_kind text,p_title text,p_scheduled_at timestamptz,p_duration_min smallint default null,p_location text default '',p_capacity smallint default null,p_remark text default '')
returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if auth.uid() is null or not public.has_perm(auth.uid(),'activity.manage') then raise exception 'FORBIDDEN'; end if;
 if p_kind not in ('trial_class','assessment_1v1','sanbanfu','lecture','competition') or trim(coalesce(p_title,''))='' then raise exception 'INVALID_INPUT'; end if;
 update public.activities set kind=p_kind,title=left(trim(p_title),100),scheduled_at=p_scheduled_at,duration_min=p_duration_min,location=left(trim(coalesce(p_location,'')),100),capacity=p_capacity,remark=left(trim(coalesce(p_remark,'')),1000)
 where id=p_activity_id and deleted_at is null; if not found then raise exception 'NOT_FOUND'; end if;
end $$;

create or replace function public.delete_activity(p_activity_id uuid)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if auth.uid() is null or not public.has_perm(auth.uid(),'activity.manage') then raise exception 'FORBIDDEN'; end if;
 update public.activities set deleted_at=now() where id=p_activity_id and deleted_at is null;
 if not found then raise exception 'NOT_FOUND'; end if;
end $$;

create or replace function public.book_activity(p_activity_id uuid,p_student_id uuid)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare uid uuid:=auth.uid(); cap smallint; used int; aid_title text; rid uuid; current_follow text;
begin
 if uid is null or not public.has_perm(uid,'activity.register') then raise exception 'FORBIDDEN'; end if;
 if not public.can_access_student(p_student_id,uid) then raise exception 'FORBIDDEN_SCOPE'; end if;
 select capacity,title into cap,aid_title from public.activities where id=p_activity_id and deleted_at is null for update;
 if aid_title is null then raise exception 'ACTIVITY_NOT_FOUND'; end if;
 select count(*) into used from public.activity_registrations where activity_id=p_activity_id and status in ('booked','attended');
 if cap is not null and used>=cap and not exists(select 1 from public.activity_registrations where activity_id=p_activity_id and student_id=p_student_id and status in ('booked','attended')) then raise exception 'ACTIVITY_FULL'; end if;
 insert into public.activity_registrations(activity_id,student_id,status,operated_by) values(p_activity_id,p_student_id,'booked',uid)
 on conflict(activity_id,student_id) do update set status='booked',outcome='',operated_by=uid returning id into rid;
 select follow_up_status into current_follow from public.students where id=p_student_id and deleted_at is null;
 if current_follow in ('pending','following') then update public.students set follow_up_status='invited' where id=p_student_id; end if;
 insert into public.student_follow_ups(student_id,author_id,content,kind) values(p_student_id,uid,'报名活动：'||aid_title,'activity');
 return rid;
end $$;

create or replace function public.mark_activity_result(p_registration_id uuid,p_status text,p_outcome text default '')
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare uid uuid:=auth.uid(); sid uuid; activity_kind text; activity_title text; current_follow text;
begin
 if uid is null or not public.has_perm(uid,'activity.register') then raise exception 'FORBIDDEN'; end if;
 if p_status not in ('attended','no_show','cancelled') then raise exception 'INVALID_STATUS'; end if;
 select ar.student_id,a.kind,a.title into sid,activity_kind,activity_title from public.activity_registrations ar join public.activities a on a.id=ar.activity_id where ar.id=p_registration_id;
 if sid is null then raise exception 'NOT_FOUND'; end if;
 if not public.can_access_student(sid,uid) then raise exception 'FORBIDDEN_SCOPE'; end if;
 update public.activity_registrations set status=p_status,outcome=left(trim(coalesce(p_outcome,'')),1000),operated_by=uid where id=p_registration_id;
 select follow_up_status into current_follow from public.students where id=sid;
 if p_status='attended' and activity_kind in ('trial_class','assessment_1v1','sanbanfu') and current_follow in ('pending','following','invited') then update public.students set follow_up_status='trialed' where id=sid; end if;
 insert into public.student_follow_ups(student_id,author_id,content,kind) values(sid,uid,case p_status when 'attended' then '活动到场：' when 'no_show' then '活动爽约：' else '取消活动：' end||activity_title||case when trim(coalesce(p_outcome,''))<>'' then '；'||left(trim(p_outcome),1000) else '' end,'activity');
end $$;

revoke all on function public.create_activity(text,text,timestamptz,smallint,text,smallint,text) from public,anon,authenticated;
revoke all on function public.update_activity(uuid,text,text,timestamptz,smallint,text,smallint,text) from public,anon,authenticated;
revoke all on function public.delete_activity(uuid) from public,anon,authenticated;
revoke all on function public.book_activity(uuid,uuid) from public,anon,authenticated;
revoke all on function public.mark_activity_result(uuid,text,text) from public,anon,authenticated;
grant execute on function public.create_activity(text,text,timestamptz,smallint,text,smallint,text) to authenticated;
grant execute on function public.update_activity(uuid,text,text,timestamptz,smallint,text,smallint,text) to authenticated;
grant execute on function public.delete_activity(uuid) to authenticated;
grant execute on function public.book_activity(uuid,uuid) to authenticated;
grant execute on function public.mark_activity_result(uuid,text,text) to authenticated;
