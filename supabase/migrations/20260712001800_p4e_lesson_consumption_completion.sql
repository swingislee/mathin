-- P4E-V §4.1：默认课消规则、幂等冲正与规则配置。

insert into public.consume_rules(classroom_id)
select id from public.classrooms on conflict(classroom_id) do nothing;

create or replace function public.create_default_consume_rule()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin insert into public.consume_rules(classroom_id) values(new.id) on conflict do nothing; return new; end $$;
drop trigger if exists classrooms_create_consume_rule on public.classrooms;
create trigger classrooms_create_consume_rule after insert on public.classrooms
for each row execute function public.create_default_consume_rule();

create or replace function public.apply_attendance_consumption()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare cid uuid; amount numeric; previous public.lesson_ledger; entry_id uuid;
begin
  select classroom_id into cid from public.class_sessions where id=new.session_id;
  if tg_op='UPDATE' and new.status is not distinct from old.status then return new; end if;
  if tg_op='UPDATE' then
    select l.* into previous from public.lesson_ledger l
      where l.session_id=old.session_id and l.student_id=old.student_id and l.reverses_id is null
        and not exists(select 1 from public.lesson_ledger reversal where reversal.reverses_id=l.id)
      order by l.created_at desc limit 1;
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

create or replace function public.set_consume_rule(
  p_classroom_id uuid,p_present numeric,p_late numeric,p_absent numeric,p_leave numeric
) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare uid uuid:=auth.uid();
begin
  if uid is null or not public.has_perm(uid,'finance.account.adjust') or not (
    public.has_perm(uid,'class.view.all') or public.is_classroom_teacher(p_classroom_id,uid)
  ) then raise exception 'FORBIDDEN'; end if;
  if p_present<0 or p_late<0 or p_absent<0 or p_leave<0 or greatest(p_present,p_late,p_absent,p_leave)>100
  then raise exception 'INVALID_RULE'; end if;
  insert into public.consume_rules(classroom_id,present_lessons,late_lessons,absent_lessons,leave_lessons,updated_by,updated_at)
  values(p_classroom_id,p_present,p_late,p_absent,p_leave,uid,now())
  on conflict(classroom_id) do update set present_lessons=excluded.present_lessons,late_lessons=excluded.late_lessons,
    absent_lessons=excluded.absent_lessons,leave_lessons=excluded.leave_lessons,updated_by=uid,updated_at=now();
  perform public.emit_domain_event('consume_rule.updated','classroom',p_classroom_id,
    jsonb_build_object('present',p_present,'late',p_late,'absent',p_absent,'leave',p_leave),null,null);
end $$;

revoke all on function public.create_default_consume_rule() from public,anon,authenticated;
revoke all on function public.set_consume_rule(uuid,numeric,numeric,numeric,numeric) from public,anon,authenticated;
grant execute on function public.set_consume_rule(uuid,numeric,numeric,numeric,numeric) to authenticated;
