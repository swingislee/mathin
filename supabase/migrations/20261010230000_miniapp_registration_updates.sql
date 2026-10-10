-- Keep the first registration immutable. Later participation forms are separate,
-- account-owned submissions with their own snapshots and idempotency keys.
alter table public.miniapp_intakes drop constraint miniapp_intakes_intake_kind_check;
alter table public.miniapp_intakes add constraint miniapp_intakes_intake_kind_check
  check(intake_kind in ('generic','family','touch','family_update'));
create index miniapp_intakes_registration_history_idx
  on public.miniapp_intakes(registration_user_id,created_at desc,id desc)
  where intake_kind in ('family','family_update') and completed_at is not null;

do $$ declare definition text; signature text; anchor text; replacement text; begin
  for signature,anchor,replacement in values
    ('public.miniapp_attach_family_child(uuid,jsonb,text,text,boolean)',
      'id=p_intake and intake_kind=''family''', 'id=p_intake and intake_kind in (''family'',''family_update'')'),
    ('public.miniapp_verify_family(uuid,timestamptz,jsonb)',
      'id=p_id and intake_kind=''family''', 'id=p_id and intake_kind in (''family'',''family_update'')'),
    ('public.miniapp_family_for_subject(uuid,uuid)',
      'i.intake_kind=''family''', 'i.intake_kind in (''family'',''family_update'')'),
    ('public.miniapp_family_for_subject(uuid,uuid)',
      'order by i.completed_at,i.id limit 1', 'order by i.completed_at desc,i.created_at desc,i.id desc limit 1'),
    ('public.miniapp_sync_lead_sources(uuid)',
      'id=p_id and intake_kind in (''family'',''touch'')', 'id=p_id and intake_kind in (''family'',''touch'',''family_update'')'),
    ('public.miniapp_sync_lead_sources(uuid)',
      'where intake_kind=''family'' and registration_user_id=i.registration_user_id and completed_at is not null for update',
      'where ((i.intake_kind=''family_update'' and id=i.id) or (i.intake_kind<>''family_update'' and intake_kind=''family'' and registration_user_id=i.registration_user_id)) and completed_at is not null for update'),
    ('public.miniapp_sync_lead_sources(uuid)',
      'if i.intake_kind=''family'' then',
      'if i.intake_kind=''family'' or (i.intake_kind=''family_update'' and not exists(select 1 from public.school_source_worklist_entries e where e.lead_id=lid or (linked_student is not null and e.student_id=linked_student))) then'),
    ('public.miniapp_sync_lead_sources(uuid)',
      'if lid is null and child_key=original_children->0->>''key'' then lid:=r.lead_id; end if;',
      'if lid is null and i.intake_kind=''family_update'' and sid is not null then
        select (prior.child_leads->>entry.key)::uuid into lid from public.miniapp_intakes prior
        cross join lateral jsonb_each_text(prior.child_participants) entry
        where prior.registration_user_id=r.registration_user_id and prior.completed_at is not null
          and entry.value=sid::text and prior.child_leads->>entry.key is not null
        order by prior.completed_at desc,prior.id desc limit 1;
      end if;
      if lid is null and child_key=original_children->0->>''key'' then lid:=r.lead_id; end if;'),
    ('public.miniapp_sync_lead_sources(uuid)',
      'grade_text,status,manual_identity_pending,created_by)', 'grade_text,status,manual_identity_pending,created_by,student_id,identity_confirmed_by,identity_confirmed_at)'),
    ('public.miniapp_sync_lead_sources(uuid)',
      '''uncontacted'',nullif(child->>''childName'','''') is null,r.registration_user_id) returning id into lid;',
      'case when i.intake_kind=''family_update'' and sid is not null then ''converted'' else ''uncontacted'' end,nullif(child->>''childName'','''') is null,r.registration_user_id,case when i.intake_kind=''family_update'' then sid end,
        case when i.intake_kind=''family_update'' and sid is not null then r.registration_user_id end,
        case when i.intake_kind=''family_update'' and sid is not null then now() end) returning id into lid;')
  loop
    definition:=pg_get_functiondef(signature::regprocedure);
    if position(anchor in definition)=0 then raise exception 'REGISTRATION_UPDATE_CONTRACT_CHANGED: %',signature; end if;
    execute replace(definition,anchor,replacement);
  end loop;
end $$;

create function public.miniapp_submit_registration_update(p_request_id uuid,p_version integer,p_answers jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare uid uuid:=auth.uid(); original public.miniapp_intakes%rowtype; saved public.miniapp_intakes%rowtype;
  form public.miniapp_forms%rowtype; child jsonb;
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.miniapp_family_ready() then raise exception 'ACCOUNT_SECURITY'; end if;
  if p_request_id is null or p_version is null or p_version<1 or jsonb_typeof(p_answers) is distinct from 'object'
    or octet_length(p_answers::text)>24576 or p_answers->>'consent' is distinct from 'true' then raise exception 'VALIDATION'; end if;
  perform pg_advisory_xact_lock(hashtextextended('miniapp-registration-update:'||uid::text,0));
  select * into saved from public.miniapp_intakes where request_id=p_request_id for update;
  if found then
    if saved.intake_kind<>'family_update' or saved.registration_user_id is distinct from uid
      or saved.form_version<>p_version or saved.answers<>p_answers then raise exception 'CONFLICT'; end if;
  else
    if (select count(*) from public.miniapp_intakes where intake_kind='family_update'
      and registration_user_id=uid and created_at>now()-interval '10 minutes')>=20 then raise exception 'RATE_LIMIT'; end if;
    select * into original from public.miniapp_intakes
      where intake_kind='family' and registration_user_id=uid and completed_at is not null for share;
    if original.id is null or original.family_id is null or original.verified_phone is null then raise exception 'FORBIDDEN'; end if;
    select * into form from public.miniapp_forms where slug='family-onboarding' and purpose='family' and enabled for share;
    if form.slug is null then raise exception 'NOT_FOUND'; end if;
    if form.version<>p_version or (p_answers->>'formVersion')::integer is distinct from p_version then raise exception 'FORM_CHANGED'; end if;
    if not exists(select 1 from public.consent_policies where policy_kind='privacy' and required and version=p_answers->>'privacyVersion')
      or not exists(select 1 from public.consent_policies where policy_kind='children_privacy' and required and version=p_answers->>'childrenPrivacyVersion')
      then raise exception 'FORM_CHANGED'; end if;
    perform public.miniapp_validate_family_answers(form.fields,p_answers);
    for child in select value from jsonb_array_elements(public.miniapp_family_children(p_answers)) loop
      if child ? 'participantId' and (child->>'participantId' is null
        or not public.miniapp_can_participate((child->>'participantId')::uuid,'activities')) then raise exception 'FORBIDDEN'; end if;
    end loop;
    insert into public.miniapp_intakes(request_id,form_slug,form_version,form_snapshot,answers,source,submitted_by,intake_kind,
      registration_user_id,verified_phone,local_phone,acquisition_state,uses_existing_account,profile_created_at,family_id)
      values(p_request_id,form.slug,form.version,to_jsonb(form),p_answers,'participant-registration',uid,'family_update',
        uid,original.verified_phone,original.local_phone,'registered',true,original.profile_created_at,original.family_id)
      returning * into saved;
    for child in select value from jsonb_array_elements(public.miniapp_family_children(p_answers)) loop
      perform public.miniapp_attach_family_child(saved.id,child,p_answers->>'parentName',p_answers->>'relation');
    end loop;
    update public.miniapp_intakes set completed_at=now() where id=saved.id returning * into saved;
  end if;
  return jsonb_build_object('id',saved.id,'participantId',saved.student_id,
    'participantIds',coalesce((select jsonb_agg(value order by key) from jsonb_each_text(saved.child_participants)),'[]'::jsonb),
    'grade',(public.miniapp_family_children(saved.answers)->0->>'grade')::integer);
end $$;
revoke all on function public.miniapp_submit_registration_update(uuid,integer,jsonb) from public,anon,authenticated;
grant execute on function public.miniapp_submit_registration_update(uuid,integer,jsonb) to authenticated;
