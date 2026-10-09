-- Auth's admin create endpoint inserts users before applying app_metadata and
-- phone_confirm. Recognize only the server-reserved UUID and verified phone at
-- that insert; ordinary signup still follows the existing invitation rules.
create or replace function public.miniapp_create_parent_profile(p_id uuid,p_phone text,p_registration text)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.miniapp_intakes%rowtype;
begin
  select * into r from public.miniapp_intakes where intake_kind='family' and registration_user_id=p_id
    and (p_registration is null or id::text=p_registration)
    and substring(verified_phone from 2)=regexp_replace(p_phone,'[^0-9]','','g')
    and profile_created_at is null and lease_key is not null and lease_until>now() for update;
  if r.id is null then raise exception 'INVALID_REGISTRATION'; end if;
  if not exists(select 1 from public.consent_policies where policy_kind='privacy' and required and version=r.answers->>'privacyVersion')
    or not exists(select 1 from public.consent_policies where policy_kind='children_privacy' and required and version=r.answers->>'childrenPrivacyVersion') then raise exception 'FORM_CHANGED'; end if;
  insert into public.profiles(id,display_name,role,privacy_consented_at,children_privacy_consented_at)
    values(p_id,coalesce(nullif(r.answers->>'parentName',''),'家长'),'parent',now(),now());
  insert into public.consent_records(actor_user_id,subject_user_id,policy_kind,policy_version,scope,decision,source) values
    (p_id,p_id,'privacy',r.answers->>'privacyVersion','account','granted','registration'),
    (p_id,p_id,'children_privacy',r.answers->>'childrenPrivacyVersion','account','granted','registration');
  insert into public.account_identifier_assurances(user_id,identifier_type,identifier_hash,attestation_source,provider_verified,provider_verified_at)
    values(p_id,'phone',encode(extensions.digest(public.normalize_login_identifier('phone',p_phone),'sha256'),'hex'),'wechat_phone',true,now());
  update public.miniapp_intakes set profile_created_at=now(),submitted_by=p_id where id=r.id;
  return true;
end $$;
revoke all on function public.miniapp_create_parent_profile(uuid,text,text) from public,anon,authenticated;

do $$ declare definition text; anchor text; begin
  definition:=pg_get_functiondef('public.handle_new_user()'::regprocedure);
  anchor:=$old$if new.raw_app_meta_data ? 'miniapp_registration_id' then
    if nullif(btrim(coalesce(new.email,'')),'') is not null or new.phone_confirmed_at is null then$old$;
  if position(anchor in definition)=0 then raise exception 'AUTH_INSERT_CONTRACT_CHANGED'; end if;
  execute replace(definition,anchor,$new$if new.raw_app_meta_data ? 'miniapp_registration_id' or exists(
    select 1 from public.miniapp_intakes where intake_kind='family' and registration_user_id=new.id
  ) then
    if nullif(btrim(coalesce(new.email,'')),'') is not null then$new$);

  -- At completion the Auth transaction has committed, so require its final
  -- confirmation and service-owned marker as well as the linked WeChat identity.
  definition:=pg_get_functiondef('public.miniapp_complete_family(uuid,text,uuid)'::regprocedure);
  anchor:=$old$if r.id is null or public.find_wechat_auth_user(p_subject) is distinct from uid then raise exception 'FORBIDDEN'; end if;$old$;
  if position(anchor in definition)=0 then raise exception 'FAMILY_COMPLETION_CONTRACT_CHANGED'; end if;
  execute replace(definition,anchor,anchor||$new$
  if not exists(select 1 from auth.users u where u.id=uid and u.phone_confirmed_at is not null
    and nullif(btrim(coalesce(u.email,'')),'') is null
    and regexp_replace(u.phone,'[^0-9]','','g')=substring(r.verified_phone from 2)
    and u.raw_app_meta_data->>'miniapp_registration_id'=r.id::text) then raise exception 'FORBIDDEN'; end if;$new$);

  -- Completion uses the service account, before a client session exists. The
  -- private projection can read organization settings without the staff RPC.
  definition:=pg_get_functiondef('public.miniapp_sync_lead_sources(uuid)'::regprocedure);
  anchor:=$old$public.get_organization_timezone_v2()$old$;
  if position(anchor in definition)=0 then raise exception 'LEAD_SOURCE_TIMEZONE_CONTRACT_CHANGED'; end if;
  execute replace(definition,anchor,$new$(select timezone from public.organizations where singleton_key=1)$new$);
end $$;
