-- Appointment booking uses the existing participant/activity relationship.
-- Keep grades, video and finance scopes unchanged, including for newly registered users.
do $$
declare v_entry record; v_definition text;
  v_old text := 'public.miniapp_can_participate(p_student_id,''grades'')';
  v_new text := 'public.miniapp_can_register(p_student_id,''activity'')';
begin
  for v_entry in select * from (values
    ('public.parent_assessment_overview(uuid)',1),
    ('public.parent_assessment_availability(uuid,text[],integer)',1),
    ('public.book_parent_assessment_slot(uuid,uuid,uuid,text[],integer)',2),
    ('public.request_parent_assessment(uuid,uuid,uuid,text[])',3),
    ('public.confirm_parent_assessment(uuid,uuid,text,timestamptz)',2)
  ) as entries(signature,guard_count) loop
    v_definition := pg_get_functiondef(v_entry.signature::regprocedure);
    if (length(v_definition)-length(replace(v_definition,v_old,'')))/length(v_old) <> v_entry.guard_count then
      raise exception 'ASSESSMENT_PARTICIPATION_GUARD_CHANGED: %',v_entry.signature;
    end if;
    -- CREATE OR REPLACE preserves the current function ACL and booking logic.
    execute replace(v_definition,v_old,v_new);
  end loop;
end $$;
