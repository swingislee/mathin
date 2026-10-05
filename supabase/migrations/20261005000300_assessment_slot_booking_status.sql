-- 历史预约决定排班主体能否编辑；当前预约决定管理列表是否显示已占用。
create or replace function public.assessment_slot_projection(p_slot public.assessment_slots) returns jsonb
language sql security definer stable set search_path=public,pg_temp as $$
  select jsonb_build_object('id',p_slot.id,'teacherId',p_slot.teacher_id,'campusId',p_slot.campus_id,
    'subjects',p_slot.subjects,'grades',p_slot.grades,'startsAt',p_slot.starts_at,'endsAt',p_slot.ends_at,
    'enabled',p_slot.enabled,'booked',exists(select 1 from public.lead_invitation_threads where assessment_slot_id=p_slot.id),
    'activeBooked',exists(select 1 from public.lead_invitation_threads where assessment_slot_id=p_slot.id and state<>'cancelled'),
    'updatedAt',p_slot.updated_at);
$$;
select pg_notify('pgrst','reload schema');
