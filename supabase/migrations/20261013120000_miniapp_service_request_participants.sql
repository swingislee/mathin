begin;
-- A family may enquire about or book a service with participation permission.
-- Keep the existing grades permission compatible without granting report access.
do $migration$
declare signature text; definition text;
  previous text := 'coalesce(public.miniapp_can_participate(id),false)';
  replacement text := 'coalesce(public.miniapp_can_participate(id,''grades'') or public.miniapp_can_participate(id,''activities''),false)';
begin
  foreach signature in array array[
    'public.miniapp_submit_experience_request(uuid,text,text,integer,jsonb,uuid[],jsonb)',
    'public.miniapp_assert_experience_participants(uuid[])'
  ] loop
    definition := pg_get_functiondef(signature::regprocedure);
    if (length(definition)-length(replace(definition,previous,'')))/length(previous) <> 1 then
      raise exception 'SERVICE_PARTICIPANT_GUARD_CHANGED';
    end if;
    execute replace(definition,previous,replacement);
  end loop;
end $migration$;
commit;
