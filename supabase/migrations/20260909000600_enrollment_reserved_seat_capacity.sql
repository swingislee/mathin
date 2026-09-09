-- 常规报名的默认座位也保留临时安排，班额内无空位时返回明确提示。
create or replace function public.default_enrollment_placement_seat() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare reserved boolean; capacity_limit integer;
begin
  if new.status='active' and new.placement_seat is null then
    perform pg_advisory_xact_lock(hashtextextended('placement-seat:'||new.classroom_id::text,0));
    select exists(select 1 from public.session_student_transfers t join public.class_sessions s on s.id=t.to_session_id
      where s.classroom_id=new.classroom_id and t.cancelled_at is null and s.ended_at is null
        and s.deleted_at is null and s.cancelled_by is null and s.voided_at is null) into reserved;
    select capacity into capacity_limit from public.classrooms where id=new.classroom_id;
    select slot into new.placement_seat from generate_series(1,case when reserved then least(coalesce(capacity_limit,60),60)
      else (select coalesce(max(placement_seat),0)+1 from public.enrollments where classroom_id=new.classroom_id and status='active') end) slot
    where not exists(select 1 from public.enrollments where classroom_id=new.classroom_id and status='active' and placement_seat=slot)
      and not exists(select 1 from public.session_student_transfers t join public.class_sessions s on s.id=t.to_session_id
        where s.classroom_id=new.classroom_id and t.target_seat=slot and t.cancelled_at is null and s.ended_at is null
          and s.deleted_at is null and s.cancelled_by is null and s.voided_at is null)
    order by slot limit 1;
    if new.placement_seat is null then raise exception 'TEMPORARY_SEAT_RESERVED'; end if;
  end if;
  return new;
end $$;
