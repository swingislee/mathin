-- 线索、沟通和来源提交分别经过同一 Lead RLS；协作可见范围按查询计算一次。
create function public.current_lead_pool_ids_v2() returns setof uuid
language sql stable security definer set search_path=public,pg_temp as $$
  select substring(v.key from 6)::uuid from public.school_list_visibility(auth.uid()) v
    where v.key like 'lead:%' and v.can_view;
$$;
revoke all on function public.current_lead_pool_ids_v2() from public,anon,authenticated,service_role;
grant execute on function public.current_lead_pool_ids_v2() to authenticated;

do $migration$
declare item record; current_qual text; expected_qual text:=E'\nCASE\n    WHEN ( SELECT (has_perm(uid(), ''followup.view''::text) OR has_perm(uid(), ''student.import''::text))) THEN\n    CASE\n        WHEN (( SELECT is_staff(uid()) AS is_staff) AND ((( SELECT has_perm(uid(), ''followup.view''::text) AS has_perm) AND ((owner_id IS NULL) OR (owner_id = ( SELECT uid() AS uid)) OR ( SELECT has_perm(uid(), ''student.view.all''::text) AS has_perm))) OR ((created_by = ( SELECT uid() AS uid)) AND ( SELECT has_perm(uid(), ''student.import''::text) AS has_perm)))) THEN true\n        ELSE can_view_school_lead(id, ( SELECT uid() AS uid))\n    END\n    ELSE false\nEND';
begin
  for item in select * from (values
    ('can_view_school_lead(uuid,uuid)','be9b8572b0fce994372574a3851c322a'),
    ('can_edit_school_lead(uuid,uuid)','c33b368dee46a10557f195ba5731eeb1'),
    ('can_access_student(uuid,uuid)','2e40802d3656104cdb2efdf0235300d0'),
    ('school_list_scope_keys(uuid,text)','b9077fb2005df20622843446601039b5')
  ) expected(signature,hash) loop
    if (select md5(replace(prosrc,chr(13),'')) from pg_proc where oid=('public.'||item.signature)::regprocedure) is distinct from item.hash
      then raise exception 'OVERVIEW_POOL_DEPENDENCY_CHANGED: %',item.signature;end if;
  end loop;
  if (select md5(replace(prosrc,chr(13),'')) from pg_proc where oid='public.school_list_visibility(uuid)'::regprocedure)
    is distinct from 'dc59a4911936bc9234abde9b7bef3fd4' then raise exception 'OVERVIEW_POOL_VISIBILITY_CHANGED';end if;
  select replace(replace(pg_get_expr(polqual,polrelid),'public.',''),'auth.','') into current_qual from pg_policy
    where polrelid='public.leads'::regclass and polname='leads_select_pool_scope' and polcmd='r' and polpermissive
      and polroles=array['authenticated'::regrole::oid] and polwithcheck is null;
  if current_qual is distinct from expected_qual then raise exception 'OVERVIEW_POOL_POLICY_CHANGED';end if;
  execute format('alter function public.current_lead_pool_ids_v2() owner to %I',
    (select pg_get_userbyid(proowner) from pg_proc where oid='public.school_list_visibility(uuid)'::regprocedure));
  current_qual:=replace(current_qual,'can_view_school_lead(id, ( SELECT uid() AS uid))','(id in (select public.current_lead_pool_ids_v2()))');
  current_qual:=replace(current_qual,'uid()','auth.uid()');
  execute format('alter policy leads_select_pool_scope on public.leads using (%s)',current_qual);
end;
$migration$;
