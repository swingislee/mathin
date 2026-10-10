-- Keep rule candidates while a booking occupies them. The shared busy check hides
-- them until cancellation, at which point availability returns without another edit.
do $release$
declare v_definition text; v_needle text := $skip$        -- Existing confirmed appointments keep their original time, teacher and topic.
        if exists(select 1 from public.lead_invitation_threads t left join public.assessment_slots s on s.id=t.assessment_slot_id
          where t.assessor_id=p_teacher and t.kind='assessment_1v1' and t.state in ('awaiting_parent','confirmed','completed') and t.scheduled_at is not null
          and tstzrange(t.scheduled_at,coalesce(s.ends_at,t.scheduled_at+interval '40 minutes'),'[)') && tstzrange(v_start,v_end,'[)')) then continue; end if;
$skip$;
begin
  v_definition:=pg_get_functiondef('public.refresh_assessment_rule_slots(uuid,uuid)'::regprocedure);
  if position(v_needle in v_definition)=0 then raise exception 'ASSESSMENT_RULE_RELEASE_ANCHOR_MISSING'; end if;
  execute replace(v_definition,v_needle,'        -- Occupied candidates stay published; the booking/read busy guard remains authoritative.'||chr(10));
end $release$;
select pg_notify('pgrst','reload schema');
