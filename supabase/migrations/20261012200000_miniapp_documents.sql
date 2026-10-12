begin;

create function mathin_internal.valid_miniapp_document(p jsonb) returns boolean
language sql immutable security definer set search_path=public,pg_temp as $$
  select coalesce(jsonb_typeof(p)='object' and p ?& array['title','body','enabled']
    and p-array['title','body','enabled']='{}' and mathin_internal.miniapp_text_valid(p->'title',120)
    and mathin_internal.miniapp_text_valid(p->'body',20000) and jsonb_typeof(p->'enabled')='boolean',false);
$$;
revoke all on function mathin_internal.valid_miniapp_document(jsonb) from public,anon,authenticated;
create table public.miniapp_documents (
  id text primary key check(id ~ '^[a-z][a-z0-9_-]{0,63}$'),
  draft jsonb not null check(mathin_internal.valid_miniapp_document(draft)),
  revision integer not null check(revision>0), published_revision integer,
  updated_at timestamptz not null default now(), updated_by uuid references public.profiles(id)
);
create table public.miniapp_document_history (
  document_id text not null references public.miniapp_documents(id), revision integer not null check(revision>0),
  version text not null, content jsonb not null check(mathin_internal.valid_miniapp_document(content)),
  published_at timestamptz not null default now(), published_by uuid references public.profiles(id),
  primary key(document_id,revision), unique(document_id,version)
);
alter table public.miniapp_documents add foreign key(id,published_revision) references public.miniapp_document_history(document_id,revision);
alter table public.miniapp_documents enable row level security;
alter table public.miniapp_document_history enable row level security;
revoke all on public.miniapp_documents,public.miniapp_document_history from public,anon,authenticated;
create trigger miniapp_document_history_immutable before update or delete on public.miniapp_document_history
  for each row execute function public.reject_immutable_security_row();

-- Only the current-version flag can retire a consent policy. Identity, version,
-- effective date, document path and all consent decisions remain immutable.
create function public.guard_consent_policy_publication() returns trigger
language plpgsql set search_path=public,pg_temp as $$
begin
  if tg_op='UPDATE' and old.required and not new.required and to_jsonb(new)-'required'=to_jsonb(old)-'required' then return new; end if;
  raise exception 'SECURITY_LEDGER_APPEND_ONLY';
end $$;
revoke all on function public.guard_consent_policy_publication() from public,anon,authenticated;
drop trigger consent_policies_immutable on public.consent_policies;
create trigger consent_policies_immutable before update or delete on public.consent_policies
  for each row execute function public.guard_consent_policy_publication();

create function public.miniapp_documents_index() returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
  if not coalesce(public.has_perm(auth.uid(),'organization.profile.manage'),false) then raise exception 'FORBIDDEN'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id',d.id,'title',d.draft->'title','revision',d.revision,
    'publishedRevision',d.published_revision) order by d.id) from public.miniapp_documents d),'[]');
end $$;
create function public.miniapp_document_workbench(p_id text) returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare d public.miniapp_documents;
begin
  if not coalesce(public.has_perm(auth.uid(),'organization.profile.manage'),false) then raise exception 'FORBIDDEN'; end if;
  select * into d from public.miniapp_documents where id=p_id;
  if d.id is null then raise exception 'NOT_FOUND'; end if;
  return jsonb_build_object('id',d.id,'draft',d.draft,'revision',d.revision,'publishedRevision',d.published_revision,
    'history',coalesce((select jsonb_agg(jsonb_build_object('revision',h.revision,'version',h.version,'publishedAt',h.published_at) order by h.revision desc)
      from (select revision,version,published_at from public.miniapp_document_history where document_id=p_id order by revision desc limit 50) h),'[]'));
end $$;
create function public.save_miniapp_document(p_id text,p_content jsonb,p_revision integer,p_publish boolean) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare d public.miniapp_documents; v_revision integer; v_version text; v_suffix integer; v_path text;
begin
  if not coalesce(public.has_perm(auth.uid(),'organization.profile.manage'),false) then raise exception 'FORBIDDEN'; end if;
  if p_id is null or p_id !~ '^[a-z][a-z0-9_-]{0,63}$' or p_revision is null or p_revision<0 or p_publish is null
    or not mathin_internal.valid_miniapp_document(p_content) then raise exception 'VALIDATION'; end if;
  if p_publish and (coalesce(btrim(p_content#>>'{title,zh}'),'')='' or coalesce(btrim(p_content#>>'{body,zh}'),'')=''
    or (p_id in ('privacy','children_privacy') and not(p_content->>'enabled')::boolean)) then raise exception 'VALIDATION'; end if;
  perform pg_advisory_xact_lock(hashtextextended('miniapp-document:'||p_id,914));
  select * into d from public.miniapp_documents where id=p_id for update;
  if p_revision is distinct from coalesce(d.revision,0) then raise exception 'FORM_CHANGED'; end if;
  v_revision:=coalesce(d.revision,0)+1;
  insert into public.miniapp_documents(id,draft,revision,updated_by) values(p_id,p_content,v_revision,auth.uid())
    on conflict(id) do update set draft=p_content,revision=v_revision,updated_at=clock_timestamp(),updated_by=auth.uid();
  if p_publish then
    v_version:='v'||v_revision::text;
    if p_id in ('privacy','children_privacy') then
      v_suffix:=v_revision;
      loop
        v_version:=to_char(now() at time zone 'Asia/Shanghai','YYYY-MM-DD')||'.'||v_suffix::text;
        exit when not exists(select 1 from public.consent_policies where policy_kind=p_id and version=v_version);
        v_suffix:=v_suffix+1;
      end loop;
      v_path:=case when p_id='privacy' then '/privacy' else '/children-privacy' end;
      update public.consent_policies set required=false where policy_kind=p_id and required;
      insert into public.consent_policies(policy_kind,version,effective_at,required,document_path)
        values(p_id,v_version,now(),true,v_path);
    end if;
    insert into public.miniapp_document_history(document_id,revision,version,content,published_by)
      values(p_id,v_revision,v_version,p_content,auth.uid());
    update public.miniapp_documents set published_revision=v_revision where id=p_id;
  end if;
  return public.miniapp_document_workbench(p_id);
end $$;
create function public.restore_miniapp_document(p_id text,p_source_revision integer,p_revision integer) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare c jsonb;
begin
  if not coalesce(public.has_perm(auth.uid(),'organization.profile.manage'),false) then raise exception 'FORBIDDEN'; end if;
  select content into c from public.miniapp_document_history where document_id=p_id and revision=p_source_revision;
  if c is null then raise exception 'NOT_FOUND'; end if;
  return public.save_miniapp_document(p_id,c,p_revision,false);
end $$;
create function public.miniapp_document(p_id text,p_version text default null) returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare h public.miniapp_document_history; d public.miniapp_documents;
begin
  select * into d from public.miniapp_documents where id=p_id;
  if d.id is null or d.published_revision is null then raise exception 'NOT_FOUND'; end if;
  if p_id not in ('privacy','children_privacy') and not exists(select 1 from public.miniapp_document_history
    where document_id=p_id and revision=d.published_revision and (content->>'enabled')::boolean) then raise exception 'NOT_FOUND'; end if;
  select * into h from public.miniapp_document_history where document_id=p_id
    and (case when p_version is null then revision=d.published_revision else version=p_version end);
  if h.document_id is null or not(h.content->>'enabled')::boolean then raise exception 'NOT_FOUND'; end if;
  return jsonb_build_object('id',p_id,'version',h.version,'title',h.content->'title','body',h.content->'body');
end $$;
create function public.miniapp_consent_documents() returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare p public.consent_policies; privacy_doc jsonb; children_doc jsonb; privacy_path text; children_path text;
begin
  for p in select * from public.consent_policies where required loop
    if p.policy_kind='privacy' then privacy_doc:=public.miniapp_document('privacy',p.version); privacy_path:=p.document_path;
    elsif p.policy_kind='children_privacy' then children_doc:=public.miniapp_document('children_privacy',p.version); children_path:=p.document_path; end if;
  end loop;
  if privacy_doc is null or children_doc is null then raise exception 'UNAVAILABLE'; end if;
  return jsonb_build_object('privacyVersion',privacy_doc->>'version','childrenPrivacyVersion',children_doc->>'version',
    'privacyPath',privacy_path,'childrenPrivacyPath',children_path,
    'policyText',jsonb_build_object('zh',jsonb_build_object('privacy',privacy_doc#>>'{body,zh}','children',children_doc#>>'{body,zh}'),
      'en',jsonb_build_object('privacy',coalesce(nullif(privacy_doc#>>'{body,en}',''),privacy_doc#>>'{body,zh}'),
        'children',coalesce(nullif(children_doc#>>'{body,en}',''),children_doc#>>'{body,zh}'))));
end $$;
revoke all on function public.miniapp_documents_index(),public.miniapp_document_workbench(text),public.save_miniapp_document(text,jsonb,integer,boolean),
  public.restore_miniapp_document(text,integer,integer),public.miniapp_document(text,text),public.miniapp_consent_documents() from public,anon,authenticated;
grant execute on function public.miniapp_documents_index(),public.miniapp_document_workbench(text),public.save_miniapp_document(text,jsonb,integer,boolean),
  public.restore_miniapp_document(text,integer,integer) to authenticated;
grant execute on function public.miniapp_document(text,text),public.miniapp_consent_documents() to anon,authenticated,service_role;

create function public.miniapp_accept_consent_documents(p_privacy_version text,p_children_version text) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare uid uuid:=auth.uid();
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if not exists(select 1 from public.profiles where id=uid and is_active and account_status='active' and not password_change_required) then raise exception 'ACCOUNT_SECURITY'; end if;
  perform pg_advisory_xact_lock(hashtextextended('miniapp-document:privacy',914));
  perform pg_advisory_xact_lock(hashtextextended('miniapp-document:children_privacy',914));
  if not exists(select 1 from public.consent_policies where policy_kind='privacy' and required and version=p_privacy_version)
    or not exists(select 1 from public.consent_policies where policy_kind='children_privacy' and required and version=p_children_version) then raise exception 'FORM_CHANGED'; end if;
  if not public.has_current_required_consents(uid) then
    perform public.record_account_consent('privacy','granted');
    perform public.record_account_consent('children_privacy','granted');
  end if;
end $$;
revoke all on function public.miniapp_accept_consent_documents(text,text) from public,anon,authenticated;
grant execute on function public.miniapp_accept_consent_documents(text,text) to authenticated;

-- Preserve the current served wording under its actual consent version. No past version is fabricated.
insert into public.miniapp_documents(id,draft,revision) select 'privacy','{"title":{"zh":"隐私政策","en":"Privacy policy"},"body":{"zh":"隐私政策\n\nMathin 仅为提供学习、课堂与学校运营服务处理必要数据，并按角色权限和数据库行级安全限制访问。\n\n你的数据权利\n\n你可以申请访问、更正、导出或删除个人信息。涉及财务审计与法定保存义务的数据会依法保留并限制用途。","en":"Privacy policy\n\nMathin processes only the data needed for learning, classes and school operations, with role permissions and database row-level security restricting access.\n\nYour data rights\n\nYou may request access, correction, export or deletion. Financial audit records subject to retention duties are retained with restricted use."},"enabled":true}'::jsonb,1 from public.consent_policies where policy_kind='privacy' and required;
insert into public.miniapp_document_history(document_id,revision,version,content,published_at)
  select d.id,1,p.version,d.draft,p.effective_at from public.miniapp_documents d join public.consent_policies p on p.policy_kind=d.id and p.required where d.id='privacy';
update public.miniapp_documents set published_revision=1 where id='privacy';
insert into public.miniapp_documents(id,draft,revision) select 'children_privacy','{"title":{"zh":"儿童个人信息保护规则","en":"Children''s personal information rules"},"body":{"zh":"儿童个人信息保护规则\n\n不满十四周岁儿童使用 Mathin 前，应由监护人阅读本规则并完成同意。\n\n单独同意\n\n学习轨迹、课堂评价与视频分别记录监护人同意；监护人可以撤回未完成处理的同意。\n\n课堂视频\n\n课堂视频存储在私有空间，仅学生本人、获授权监护人与负责教师可在短时签名链接有效期内访问。","en":"Children''s personal information rules\n\nA guardian should read and consent to these rules before a child under 14 uses Mathin.\n\nSeparate consent\n\nGuardian consent is recorded separately for learning traces, class reviews and video, and may be withdrawn where processing is incomplete.\n\nClass videos\n\nClass videos are private and available only to the student, authorized guardians and responsible teachers through short-lived signed links."},"enabled":true}'::jsonb,1 from public.consent_policies where policy_kind='children_privacy' and required;
insert into public.miniapp_document_history(document_id,revision,version,content,published_at)
  select d.id,1,p.version,d.draft,p.effective_at from public.miniapp_documents d join public.consent_policies p on p.policy_kind=d.id and p.required where d.id='children_privacy';
update public.miniapp_documents set published_revision=1 where id='children_privacy';

notify pgrst,'reload schema';
commit;
