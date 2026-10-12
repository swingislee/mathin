-- Run only in a rollback transaction on the verified isolated development database.
create function pg_temp.expect_document_error(statement text,expected text) returns void language plpgsql as $$
begin
  begin execute statement; exception when others then
    if sqlerrm like '%'||expected||'%' then return; end if;
    raise exception 'EXPECTED_%,GOT_%',expected,sqlerrm;
  end;
  raise exception 'EXPECTED_ERROR_%',expected;
end $$;
do $setup$
declare admin_id uuid; parent_id uuid; original jsonb; state jsonb; content jsonb; next jsonb;
begin
  select p.id into admin_id from public.profiles p join auth.users u on u.id=p.id where u.email='test-admin@mathin.local' and p.purpose='test' and p.role='admin';
  select p.id into parent_id from public.profiles p join auth.users u on u.id=p.id where u.email='test-parent@mathin.local' and p.purpose='test' and p.is_active and p.account_status='active' and not p.password_change_required;
  if admin_id is null or parent_id is null then raise exception 'FIXED_DEVELOPMENT_IDENTITIES_REQUIRED'; end if;
  perform set_config('test.documents.admin',admin_id::text,true); perform set_config('test.documents.parent',parent_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,'role','authenticated','aal','aal2')::text,true);
  original:=public.miniapp_document('privacy'); state:=public.miniapp_document_workbench('privacy'); content:=state->'draft';
  perform set_config('test.documents.original',original::text,true); perform set_config('test.documents.oldrevision',state->>'publishedRevision',true);
  content:=jsonb_set(content,'{body,zh}','"新发布的事务隐私正文"');
  state:=public.save_miniapp_document('privacy',content,(state->>'revision')::integer,false);
  if public.miniapp_document('privacy')<>original then raise exception 'DOCUMENT_DRAFT_LEAK'; end if;
  perform pg_temp.expect_document_error(format('select public.save_miniapp_document(''privacy'',%L,%s,true)',content,(state->>'revision')::integer-1),'FORM_CHANGED');
  perform pg_temp.expect_document_error(format('select public.save_miniapp_document(''privacy'',%L,%s,true)',jsonb_set(content,'{enabled}','false'),state->>'revision'),'VALIDATION');
  state:=public.save_miniapp_document('privacy',content,(state->>'revision')::integer,true);
  next:=public.miniapp_document('privacy');
  if next->>'version'=original->>'version' or next#>>'{body,zh}'<>'新发布的事务隐私正文' then raise exception 'DOCUMENT_PUBLICATION_MISSING'; end if;
  if public.miniapp_document('privacy',original->>'version')<>original then raise exception 'HISTORICAL_POLICY_CHANGED'; end if;
  if public.miniapp_consent_documents()->>'privacyVersion'<>next->>'version'
    or public.miniapp_consent_documents()#>>'{policyText,zh,privacy}'<>next#>>'{body,zh}' then raise exception 'CONSENT_VERSION_BODY_MISMATCH'; end if;
  perform set_config('test.documents.version',next->>'version',true);
  state:=public.restore_miniapp_document('privacy',current_setting('test.documents.oldrevision')::integer,(state->>'revision')::integer);
  if public.miniapp_document('privacy')<>next or state#>>'{draft,body,zh}'<>original#>>'{body,zh}' then raise exception 'RESTORE_PUBLISHED_AUTOMATICALLY'; end if;
  perform public.save_miniapp_document('help-transaction',jsonb_build_object('title',jsonb_build_object('zh','事务帮助','en','Fixture help'),'body',jsonb_build_object('zh','帮助正文','en','Help text'),'enabled',true),0,false);
  if has_table_privilege('anon','public.miniapp_documents','select') or has_table_privilege('authenticated','public.miniapp_document_history','insert,update,delete')
    or has_function_privilege('anon','public.save_miniapp_document(text,jsonb,integer,boolean)','execute') or has_function_privilege('anon','public.miniapp_accept_consent_documents(text,text)','execute') then raise exception 'DOCUMENT_ACL'; end if;
  perform pg_temp.expect_document_error('update public.miniapp_document_history set content=jsonb_set(content,''{body,zh}'',''"changed"'') where document_id=''privacy''','SECURITY_LEDGER_APPEND_ONLY');
  perform pg_temp.expect_document_error('update public.consent_policies set version=''2099-01-01'' where policy_kind=''privacy'' and required','SECURITY_LEDGER_APPEND_ONLY');
end $setup$;
set local role anon;
do $public$
begin
  if public.miniapp_document('privacy')->>'version'<>current_setting('test.documents.version') then raise exception 'PUBLIC_DOCUMENT_MISSING'; end if;
  perform pg_temp.expect_document_error('select public.miniapp_document(''help-transaction'')','NOT_FOUND');
  perform pg_temp.expect_document_error('select public.miniapp_document_workbench(''privacy'')','permission denied');
end $public$;
reset role;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.documents.parent'),'role','authenticated')::text,true);
set local role authenticated;
do $consent$
declare original jsonb:=current_setting('test.documents.original')::jsonb; current_docs jsonb:=public.miniapp_consent_documents(); n bigint;
begin
  if public.has_current_required_consents(auth.uid()) then raise exception 'POLICY_ACCEPTED_WITHOUT_ACTION'; end if;
  perform pg_temp.expect_document_error('select public.miniapp_documents_index()','FORBIDDEN');
  perform pg_temp.expect_document_error('select public.miniapp_document_workbench(''privacy'')','FORBIDDEN');
  perform pg_temp.expect_document_error(format('select public.save_miniapp_document(''privacy'',%L,1,true)',jsonb_build_object('title',original->'title','body',original->'body','enabled',true)),'FORBIDDEN');
  perform pg_temp.expect_document_error(format('select public.miniapp_accept_consent_documents(%L,%L)',original->>'version',current_docs->>'childrenPrivacyVersion'),'FORM_CHANGED');
  perform public.miniapp_accept_consent_documents(current_docs->>'privacyVersion',current_docs->>'childrenPrivacyVersion');
  if not public.has_current_required_consents(auth.uid()) then raise exception 'CONSENT_NOT_RECORDED'; end if;
  select count(*) into n from public.consent_records where subject_user_id=auth.uid();
  perform public.miniapp_accept_consent_documents(current_docs->>'privacyVersion',current_docs->>'childrenPrivacyVersion');
  if (select count(*) from public.consent_records where subject_user_id=auth.uid())<>n then raise exception 'CONSENT_RETRY_DUPLICATED'; end if;
end $consent$;
reset role;
do $help$
declare d jsonb;
begin
  perform set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.documents.admin'),'role','authenticated','aal','aal2')::text,true);
  d:=public.miniapp_document_workbench('help-transaction');
  d:=public.save_miniapp_document('help-transaction',d->'draft',(d->>'revision')::integer,true);
  if public.miniapp_document('help-transaction')#>>'{body,zh}'<>'帮助正文' then raise exception 'HELP_NOT_PUBLISHED'; end if;
  perform set_config('test.documents.helpversion',public.miniapp_document('help-transaction')->>'version',true);
  perform public.save_miniapp_document('help-transaction',jsonb_set(d->'draft','{enabled}','false'),(d->>'revision')::integer,true);
  perform set_config('request.jwt.claims','{}',true);
end $help$;
set local role anon;
do $withdrawn$
begin
  perform pg_temp.expect_document_error('select public.miniapp_document(''help-transaction'')','NOT_FOUND');
  perform pg_temp.expect_document_error(format('select public.miniapp_document(''help-transaction'',%L)',current_setting('test.documents.helpversion')),'NOT_FOUND');
  if public.miniapp_document('privacy',current_setting('test.documents.original')::jsonb->>'version')<>current_setting('test.documents.original')::jsonb then raise exception 'LEGAL_HISTORY_NOT_AVAILABLE'; end if;
end $withdrawn$;
reset role;
