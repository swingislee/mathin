begin;

create function mathin_internal.valid_miniapp_questions(p jsonb) returns boolean
language plpgsql immutable security definer set search_path=public,pg_temp as $$
declare f jsonb; o jsonb; ids text[]:='{}'; choices text[];
begin
  if jsonb_typeof(p) is distinct from 'array' or jsonb_array_length(p)>20 or octet_length(p::text)>32768 then return false; end if;
  for f in select value from jsonb_array_elements(p) loop
    if jsonb_typeof(f) is distinct from 'object' or not(f ?& array['id','type','label','required'])
      or exists(select 1 from jsonb_object_keys(f) k where k not in ('id','type','label','required','options'))
      or coalesce(f->>'id','') !~ '^[a-z][a-z0-9_-]{0,49}$' or f->>'id' in ('constructor','prototype','__proto__') or f->>'id'=any(ids)
      or coalesce(f->>'type','') not in ('text','phone','textarea','select','multiselect') or jsonb_typeof(f->'required') is distinct from 'boolean'
      or not mathin_internal.miniapp_text_valid(f->'label',160) or length(btrim(f#>>'{label,zh}')) not between 1 and 100 then return false; end if;
    ids:=array_append(ids,f->>'id');
    if f->>'type' in ('select','multiselect') then
      if jsonb_typeof(f->'options') is distinct from 'array' or jsonb_array_length(f->'options') not between 1 and 20 then return false; end if;
      choices:='{}';
      for o in select value from jsonb_array_elements(f->'options') loop
        if jsonb_typeof(o) is distinct from 'object' or not(o ?& array['id','label'])
          or exists(select 1 from jsonb_object_keys(o) k where k not in ('id','label'))
          or coalesce(o->>'id','') !~ '^[a-z][a-z0-9_-]{0,49}$' or o->>'id' in ('constructor','prototype','__proto__') or o->>'id'=any(choices)
          or not mathin_internal.miniapp_text_valid(o->'label',160) or length(btrim(o#>>'{label,zh}')) not between 1 and 100 then return false; end if;
        choices:=array_append(choices,o->>'id');
      end loop;
    elsif f ? 'options' then return false; end if;
  end loop;
  return true;
exception when others then return false;
end $$;

create function mathin_internal.validate_miniapp_answers(p_fields jsonb,p_answers jsonb) returns void
language plpgsql immutable set search_path=public,pg_temp as $$
declare f jsonb; answer jsonb; item jsonb; empty_answer boolean;
begin
  if not mathin_internal.valid_miniapp_questions(p_fields) or jsonb_typeof(p_answers) is distinct from 'object'
    or octet_length(p_answers::text)>20000 or exists(select 1 from jsonb_object_keys(p_answers) k
      where not exists(select 1 from jsonb_array_elements(p_fields) field_item where field_item->>'id'=k)) then raise exception 'VALIDATION'; end if;
  for f in select value from jsonb_array_elements(p_fields) loop
    answer:=p_answers->(f->>'id');
    empty_answer:=answer is null or answer='[]'::jsonb or (jsonb_typeof(answer)='string' and btrim(answer#>>'{}')='');
    if empty_answer then
      if f->'required'='true'::jsonb then raise exception 'VALIDATION'; end if;
      continue;
    end if;
    if f->>'type'='multiselect' then
      if jsonb_typeof(answer) is distinct from 'array' or jsonb_array_length(answer)>20
        or (select count(*)<>count(distinct value) from jsonb_array_elements(answer)) then raise exception 'VALIDATION'; end if;
      for item in select value from jsonb_array_elements(answer) loop
        if not exists(select 1 from jsonb_array_elements(f->'options') o where o->'id'=item) then raise exception 'VALIDATION'; end if;
      end loop;
    else
      if jsonb_typeof(answer) is distinct from 'string' or length(answer#>>'{}')>(case when f->>'type'='textarea' then 2000 else 200 end) then raise exception 'VALIDATION'; end if;
      if f->>'type'='select' and not exists(select 1 from jsonb_array_elements(f->'options') o where o->'id'=answer) then raise exception 'VALIDATION'; end if;
      if f->>'type'='phone' and answer#>>'{}' !~ '^\+?[0-9 ()-]{6,30}$' then raise exception 'VALIDATION'; end if;
    end if;
  end loop;
end $$;
revoke all on function mathin_internal.valid_miniapp_questions(jsonb),mathin_internal.validate_miniapp_answers(jsonb,jsonb) from public,anon,authenticated;
-- Existing RPCs can be owned by the installation's postgres role. This validator reads no stored data.
grant execute on function mathin_internal.valid_miniapp_questions(jsonb) to postgres,service_role,authenticated;

alter table public.miniapp_forms add column questions jsonb not null default '[]'::jsonb check(mathin_internal.valid_miniapp_questions(questions));
alter function public.miniapp_validate_family_form(jsonb) set schema mathin_internal;
alter function mathin_internal.miniapp_validate_family_form(jsonb) rename to validate_family_core_form;
revoke all on function mathin_internal.validate_family_core_form(jsonb) from public,anon,authenticated;
create function public.miniapp_validate_family_form(p_config jsonb) returns void
language plpgsql set search_path=public,pg_temp as $$
begin
  perform mathin_internal.validate_family_core_form(p_config-'questions');
  if not mathin_internal.valid_miniapp_questions(coalesce(p_config->'questions','[]'::jsonb)) then raise exception 'VALIDATION'; end if;
end $$;
revoke all on function public.miniapp_validate_family_form(jsonb) from public,anon,authenticated;
grant execute on function public.miniapp_validate_family_form(jsonb) to postgres,service_role;

create function mathin_internal.validate_family_extra_answers() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if new.intake_kind in ('family','family_update') then
    perform mathin_internal.validate_miniapp_answers(coalesce(new.form_snapshot->'questions','[]'::jsonb),coalesce(new.answers->'extraAnswers','{}'::jsonb));
    -- Save the display dictionary alongside this submission, without changing stable grade numbers.
    new.form_snapshot:=new.form_snapshot||jsonb_build_object('stages',(select published->'stages' from miniapp_settings where singleton));
  end if;
  return new;
end $$;
revoke all on function mathin_internal.validate_family_extra_answers() from public,anon,authenticated;
create trigger miniapp_family_extra_answers before insert on public.miniapp_intakes for each row execute function mathin_internal.validate_family_extra_answers();

create table public.miniapp_family_form_drafts (
  slug text primary key references public.miniapp_forms(slug), config jsonb not null,
  revision integer not null check(revision>0), updated_at timestamptz not null default now(), updated_by uuid references public.profiles(id)
);
create table public.miniapp_family_form_history (
  slug text not null references public.miniapp_forms(slug), version integer not null check(version>0), config jsonb not null,
  published_at timestamptz not null default now(), published_by uuid references public.profiles(id), primary key(slug,version)
);
alter table public.miniapp_family_form_drafts enable row level security;
alter table public.miniapp_family_form_history enable row level security;
revoke all on public.miniapp_family_form_drafts,public.miniapp_family_form_history from public,anon,authenticated;
insert into miniapp_family_form_history(slug,version,config,published_at)
  select slug,version,jsonb_build_object('title',title,'description',description,'fields',fields,'questions',questions),updated_at
  from miniapp_forms where purpose in ('family','promotion');

create function mathin_internal.capture_family_form() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare config jsonb;
begin
  if new.purpose in ('family','promotion') then
    config:=jsonb_build_object('title',new.title,'description',new.description,'fields',new.fields,'questions',new.questions);
    perform public.miniapp_validate_family_form(config);
    insert into miniapp_family_form_history(slug,version,config,published_by) values(new.slug,new.version,config,auth.uid());
  end if;
  return new;
end $$;
revoke all on function mathin_internal.capture_family_form() from public,anon,authenticated;
create trigger miniapp_family_form_history after insert or update on public.miniapp_forms for each row execute function mathin_internal.capture_family_form();

create or replace function public.miniapp_read_family_form(p_scene text default null) returns jsonb
language plpgsql security definer stable set search_path=public,pg_temp as $$
declare f public.miniapp_forms;
begin
  if not coalesce(public.has_perm(auth.uid(),'registration.invite.manage'),false) then raise exception 'FORBIDDEN'; end if;
  select * into f from miniapp_forms where slug=coalesce(p_scene,'family-onboarding') and purpose in ('family','promotion');
  if f.slug is null then raise exception 'NOT_FOUND'; end if;
  return jsonb_build_object('slug',f.slug,'version',f.version,'title',f.title,'description',f.description,'fields',f.fields,'questions',f.questions);
end $$;
create or replace function public.miniapp_save_family_form(p_scene text,p_version integer,p_config jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare result text;
begin
  if not coalesce(public.has_perm(auth.uid(),'registration.invite.manage'),false) then raise exception 'FORBIDDEN'; end if;
  perform public.miniapp_validate_family_form(p_config);
  update miniapp_forms set title=p_config->'title',description=p_config->'description',fields=p_config->'fields',questions=coalesce(p_config->'questions',questions)
    where slug=coalesce(p_scene,'family-onboarding') and purpose in ('family','promotion') and version=p_version returning slug into result;
  if result is null then raise exception 'FORM_CHANGED'; end if;
  return public.miniapp_read_family_form(p_scene);
end $$;

create function public.miniapp_family_form_workbench(p_scene text default null) returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare published jsonb:=public.miniapp_read_family_form(p_scene); d public.miniapp_family_form_drafts;
begin
  select * into d from miniapp_family_form_drafts where slug=published->>'slug';
  return coalesce(d.config,published-'slug'-'version')||jsonb_build_object('slug',published->>'slug','version',published->'version',
    'editorRevision',coalesce(d.revision,0),'pending',d.config is not null and d.config is distinct from published-'slug'-'version',
    'history',coalesce((select jsonb_agg(jsonb_build_object('version',h.version,'publishedAt',h.published_at) order by h.version desc)
      from (select version,published_at from miniapp_family_form_history where slug=published->>'slug' order by version desc limit 50) h),'[]'::jsonb));
end $$;
create function public.save_miniapp_family_form_draft(p_scene text,p_version integer,p_revision integer,p_config jsonb,p_publish boolean) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare f public.miniapp_forms; r integer; slug_value text:=coalesce(p_scene,'family-onboarding');
begin
  if not coalesce(public.has_perm(auth.uid(),'registration.invite.manage'),false) then raise exception 'FORBIDDEN'; end if;
  perform public.miniapp_validate_family_form(p_config);
  if p_publish is null or p_revision is null or p_revision<0 then raise exception 'VALIDATION'; end if;
  perform pg_advisory_xact_lock(hashtextextended('miniapp-family-form:'||slug_value,915));
  select * into f from miniapp_forms where slug=slug_value and purpose in ('family','promotion') for update;
  if f.slug is null then raise exception 'NOT_FOUND'; end if;
  select revision into r from miniapp_family_form_drafts where slug=slug_value for update;
  if f.version is distinct from p_version or coalesce(r,0) is distinct from p_revision then raise exception 'FORM_CHANGED'; end if;
  if p_publish then perform public.miniapp_save_family_form(p_scene,p_version,p_config); end if;
  insert into miniapp_family_form_drafts(slug,config,revision,updated_by) values(slug_value,p_config,1,auth.uid())
    on conflict(slug) do update set config=p_config,revision=miniapp_family_form_drafts.revision+1,updated_at=now(),updated_by=auth.uid();
  return public.miniapp_family_form_workbench(p_scene);
end $$;
create function public.restore_miniapp_family_form(p_scene text,p_source_version integer,p_version integer,p_revision integer) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare config jsonb;
begin
  if not coalesce(public.has_perm(auth.uid(),'registration.invite.manage'),false) then raise exception 'FORBIDDEN'; end if;
  select h.config into config from miniapp_family_form_history h where slug=coalesce(p_scene,'family-onboarding') and version=p_source_version;
  if config is null then raise exception 'NOT_FOUND'; end if;
  return public.save_miniapp_family_form_draft(p_scene,p_version,p_revision,config,false);
end $$;

-- A new promotion starts with the published questions of the default form.
create function mathin_internal.copy_promotion_questions() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if new.purpose='promotion' then new.questions:=coalesce((select questions from miniapp_forms where slug='family-onboarding'),'[]'::jsonb); end if;
  return new;
end $$;
revoke all on function mathin_internal.copy_promotion_questions() from public,anon,authenticated;
create trigger miniapp_copy_promotion_questions before insert on public.miniapp_forms for each row execute function mathin_internal.copy_promotion_questions();

revoke all on function public.miniapp_family_form_workbench(text),public.save_miniapp_family_form_draft(text,integer,integer,jsonb,boolean),
  public.restore_miniapp_family_form(text,integer,integer,integer) from public,anon,authenticated;
grant execute on function public.miniapp_family_form_workbench(text),public.save_miniapp_family_form_draft(text,integer,integer,jsonb,boolean),
  public.restore_miniapp_family_form(text,integer,integer,integer) to authenticated;

-- Extend only the already-scoped staff projections; their row access checks stay in place.
do $$ declare definition text; signature text; source_snapshot text; source_answers text; anchor text:='''interestOptions'',';
begin
  for signature,source_snapshot,source_answers in values
    ('public.miniapp_promotion_dashboard(text,integer)','coalesce(r.form_snapshot,i.form_snapshot)','coalesce(r.answers,i.answers)'),
    ('public.miniapp_family_for_subject(uuid,uuid)','r.form_snapshot','r.answers')
  loop
    definition:=pg_get_functiondef(signature::regprocedure);
    if position(anchor in definition)=0 then raise exception 'FAMILY_PROJECTION_CONTRACT_CHANGED'; end if;
    execute replace(definition,anchor,'''questions'',coalesce('||source_snapshot||'->''questions'',''[]''::jsonb),''extraAnswers'',coalesce('||source_answers||'->''extraAnswers'',''{}''::jsonb),'||anchor);
  end loop;
end $$;
notify pgrst,'reload schema';
commit;
