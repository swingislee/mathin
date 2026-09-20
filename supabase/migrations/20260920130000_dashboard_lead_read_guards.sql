-- 账号权限是三个线索读取分支的必要条件，在单次查询中先求值。
-- 满足前提后继续执行原策略，保留归属、协作、邀请及测评历史范围。
do $read_guards$
declare
  item record;
  actual_body text;
  actual_qual text;
  original_search_path text := current_setting('search_path');
  pool_qual constant text := $pool$
    CASE
      WHEN (( SELECT is_staff(auth.uid()) AS is_staff) AND
        ((( SELECT has_perm(auth.uid(), 'followup.view'::text) AS has_perm) AND
          ((owner_id IS NULL) OR (owner_id = ( SELECT auth.uid() AS uid))
            OR ( SELECT has_perm(auth.uid(), 'student.view.all'::text) AS has_perm)))
          OR ((created_by = ( SELECT auth.uid() AS uid))
            AND ( SELECT has_perm(auth.uid(), 'student.import'::text) AS has_perm)))) THEN true
      ELSE can_view_school_lead(id, ( SELECT auth.uid() AS uid))
    END
  $pool$;
begin
  perform set_config('search_path', 'public, pg_temp', true);

  -- 必要条件来自这些已知函数体；未来授权规则变化时先重新核对，避免收窄新范围。
  for item in select * from (values
    ('public.can_view_school_lead(uuid,uuid)',
      'select public.is_staff(p_uid) and exists(select 1 from public.leads l where l.id=p_lead_id and
        ((public.has_perm(p_uid,''followup.view'') and (l.owner_id is null or public.can_edit_school_lead(l.id,p_uid)
          or public.school_subject_in_my_groups(l.student_id,l.id,p_uid)))
          or l.created_by=p_uid and public.has_perm(p_uid,''student.import'')));'),
    ('public.has_assigned_invitation_lead(uuid,uuid)',
      'select p_uid is not null and public.has_perm(p_uid, ''review.write'') and exists (
        select 1 from public.lead_invitation_threads invitation
        where invitation.lead_id = p_lead_id and invitation.assessor_id = p_uid
          and invitation.state not in (''completed'',''cancelled''));'),
    ('public.has_assessment_history_lead_access(uuid)',
      'select auth.uid() is not null and public.has_perm(auth.uid(), ''review.write'') and exists (
        select 1 from public.activities activity
        join public.lead_invitation_threads invitation on invitation.id = activity.source_invitation_id
        where invitation.lead_id = p_lead_id and invitation.assessor_id = auth.uid()
          and activity.deleted_at is null);')
  ) as known(signature, body) loop
    select prosrc into strict actual_body from pg_proc
      where oid=item.signature::regprocedure and provolatile='s' and prosecdef;
    if regexp_replace(actual_body, '\s', '', 'g') <> regexp_replace(item.body, '\s', '', 'g') then
      raise exception 'LEAD_READ_GUARD_FUNCTION_CHANGED: %', item.signature;
    end if;
  end loop;

  for item in select * from (values
    ('leads_select_pool_scope', pool_qual,
      'SELECT public.has_perm(auth.uid(), ''followup.view'') OR public.has_perm(auth.uid(), ''student.import'')'),
    ('leads_select_assigned_invitation_assessor',
      'has_assigned_invitation_lead(( SELECT auth.uid() AS uid), id)',
      'SELECT public.has_perm(auth.uid(), ''review.write'')'),
    ('leads_select_assessment_assessor', 'has_assessment_history_lead_access(id)',
      'SELECT public.has_perm(auth.uid(), ''review.write'')')
  ) as known(name, qual, prerequisite) loop
    select pg_get_expr(polqual, polrelid) into strict actual_qual from pg_policy
      where polrelid='public.leads'::regclass and polname=item.name and polcmd='r'
        and polpermissive and polroles=array[(select oid from pg_roles where rolname='authenticated')];
    if regexp_replace(actual_qual, '\s', '', 'g') <> regexp_replace(item.qual, '\s', '', 'g') then
      raise exception 'LEAD_READ_GUARD_POLICY_CHANGED: %', item.name;
    end if;
    execute format('ALTER POLICY %I ON public.leads USING (CASE WHEN (%s) THEN (%s) ELSE false END)',
      item.name, item.prerequisite, actual_qual);
  end loop;

  perform set_config('search_path', original_search_path, true);
end;
$read_guards$;
