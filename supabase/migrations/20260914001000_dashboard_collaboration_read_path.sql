-- 协作功能可能晚于首页性能迁移上线；在新的账本项恢复兼容协作的读取路径。
-- 账号级直接可见分支只求值一次，逐条参与和分组判断继续调用现有权限函数。
do $read_path$
declare
  pool_qual text;
  access_body text;
  original_search_path text := current_setting('search_path');
  optimized_qual constant text := $policy$
    CASE
      WHEN (( SELECT is_staff(auth.uid()) AS is_staff) AND
        ((( SELECT has_perm(auth.uid(), 'followup.view'::text) AS has_perm) AND
          ((owner_id IS NULL) OR (owner_id = ( SELECT auth.uid() AS uid))
            OR ( SELECT has_perm(auth.uid(), 'student.view.all'::text) AS has_perm)))
          OR ((created_by = ( SELECT auth.uid() AS uid))
            AND ( SELECT has_perm(auth.uid(), 'student.import'::text) AS has_perm)))) THEN true
      ELSE can_view_school_lead(id, ( SELECT auth.uid() AS uid))
    END
  $policy$;
begin
  perform set_config('search_path','public, pg_temp',true);
  select pg_get_expr(polqual,polrelid) into strict pool_qual from pg_policy
    where polrelid='public.leads'::regclass and polname='leads_select_pool_scope' and polcmd='r';
  if regexp_replace(pool_qual,'\s','','g') not in (
    'can_view_school_lead(id,(SELECTauth.uid()ASuid))',
    regexp_replace(optimized_qual,'\s','','g')
  ) then
    raise exception 'UNRECOGNIZED_LEAD_READ_POLICY';
  end if;

  select regexp_replace(prosrc,'\s','','g') into strict access_body
    from pg_proc where oid='public.can_view_school_lead(uuid,uuid)'::regprocedure;
  if access_body <> 'selectpublic.is_staff(p_uid)andexists(select1frompublic.leadslwherel.id=p_lead_idand((public.has_perm(p_uid,''followup.view'')and(l.owner_idisnullorpublic.can_edit_school_lead(l.id,p_uid)orpublic.school_subject_in_my_groups(l.student_id,l.id,p_uid)))orl.created_by=p_uidandpublic.has_perm(p_uid,''student.import'')));' then
    raise exception 'UNRECOGNIZED_LEAD_VIEW_FUNCTION';
  end if;
  select regexp_replace(prosrc,'\s','','g') into strict access_body
    from pg_proc where oid='public.can_edit_school_lead(uuid,uuid)'::regprocedure;
  if access_body <> 'selectpublic.is_staff(p_uid)andexists(select1frompublic.leadslwherel.id=p_lead_idand(l.owner_id=p_uidorpublic.has_perm(p_uid,''student.view.all'')orpublic.school_subject_is_participant(l.student_id,l.id,p_uid)orl.student_idisnotnullandpublic.can_access_student(l.student_id,p_uid)));' then
    raise exception 'UNRECOGNIZED_LEAD_EDIT_FUNCTION';
  end if;

  execute format('alter policy leads_select_pool_scope on public.leads using (%s)',optimized_qual);
  perform set_config('search_path',original_search_path,true);
end;
$read_path$;
