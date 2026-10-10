-- Persist participant wording in the form itself. Clients render this saved copy verbatim.
-- Keep field bindings, modes, ordering, option IDs and historical intake snapshots intact.
create function pg_temp.miniapp_participant_text(p_text jsonb) returns jsonb
language plpgsql as $$
declare result jsonb := p_text; value text; locale text;
begin
  foreach locale in array array['zh','en'] loop
    value := p_text->>locale;
    if value is null then continue; end if;
    if locale='zh' then
      value := replace(replace(replace(value,'认识你的家庭','参与信息'),'家庭信息','参与信息'),'家庭资料','参与资料');
      value := replace(replace(replace(value,'家庭','参与信息'),'家长','联系人'),'孩子','参与人');
    else
      value := regexp_replace(value,'\myour family\M','Participation details','gi');
      value := regexp_replace(value,'\mfamily (details|information)\M','Participation details','gi');
      value := regexp_replace(value,'\mFamily\M','Participation','g');
      value := regexp_replace(value,'\mfamily\M','participation','g');
      value := regexp_replace(value,'\mParent\M','Contact','g');
      value := regexp_replace(value,'\mparent\M','contact','g');
      value := regexp_replace(value,'\mChildren\M','Participants','g');
      value := regexp_replace(value,'\mchildren\M','participants','g');
      value := regexp_replace(value,'\mChild\M','Participant','g');
      value := regexp_replace(value,'\mchild\M','participant','g');
    end if;
    result := jsonb_set(result,array[locale],to_jsonb(value));
  end loop;
  return result;
end $$;

do $$
declare form_record record; field jsonb; item jsonb; new_title jsonb; new_description jsonb; new_fields jsonb; new_options jsonb;
begin
  for form_record in select slug,title,description,fields from public.miniapp_forms where purpose in ('family','promotion') for update loop
    new_title := pg_temp.miniapp_participant_text(form_record.title);
    new_description := pg_temp.miniapp_participant_text(form_record.description);
    new_fields := '[]'::jsonb;
    for field in select value from jsonb_array_elements(form_record.fields) loop
      field := jsonb_set(field,'{label}',pg_temp.miniapp_participant_text(field->'label'));
      if field->>'id'='relation' and field#>>'{label,en}'='Relationship' then
        field := jsonb_set(field,'{label,en}','"Relationship to the participant"');
      end if;
      if field ? 'options' then
        new_options := '[]'::jsonb;
        for item in select value from jsonb_array_elements(field->'options') loop
          new_options := new_options || jsonb_build_array(jsonb_set(item,'{label}',pg_temp.miniapp_participant_text(item->'label')));
        end loop;
        field := jsonb_set(field,'{options}',new_options);
      end if;
      new_fields := new_fields || jsonb_build_array(field);
    end loop;
    if (new_title,new_description,new_fields) is distinct from (form_record.title,form_record.description,form_record.fields) then
      update public.miniapp_forms set title=new_title,description=new_description,fields=new_fields where slug=form_record.slug;
    end if;
  end loop;
end $$;
drop function pg_temp.miniapp_participant_text(jsonb);
