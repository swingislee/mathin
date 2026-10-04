-- 只读策略在账号状态变化后立即沿用原授权结果；固定开发身份变更在 savepoint 中回滚。
savepoint dashboard_account_state;
do $states$
declare actor uuid; state_key text; old_lead text; new_lead text; old_enrollment text; new_enrollment text;
  original_active boolean; original_password boolean; mismatch boolean;
begin
  select qual into strict old_lead from dashboard_policy_before where name='leads_select_pool_scope';
  select qual into strict old_enrollment from dashboard_policy_before where name='course_enrollments_select_scope';
  select pg_get_expr(polqual,polrelid) into strict new_lead from pg_policy
    where polrelid='public.leads'::regclass and polname='leads_select_pool_scope';
  select pg_get_expr(polqual,polrelid) into strict new_enrollment from pg_policy
    where polrelid='public.course_enrollments'::regclass and polname='course_enrollments_select_scope';
  for actor in select id from auth.users where email in ('test-admin@mathin.local','test-teacher@mathin.local') loop
    select is_active,password_change_required into original_active,original_password from public.profiles where id=actor;
    foreach state_key in array array['inactive','password_change_required'] loop
      perform set_config('request.jwt.claims','{}',true);
      update public.profiles set is_active=(state_key<>'inactive'),
        password_change_required=(state_key='password_change_required'),
        initial_password_set_at=coalesce(initial_password_set_at,now()),password_changed_at=null where id=actor;
      perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
      execute format('select exists(select 1 from public.leads where (%s) is distinct from (%s))',old_lead,new_lead) into mismatch;
      if mismatch then raise exception 'ACCOUNT_STATE_LEAD_SCOPE_CHANGED'; end if;
      execute format('select exists(select 1 from dashboard_read_students where (%s) is distinct from (%s))',old_enrollment,new_enrollment) into mismatch;
      if mismatch then raise exception 'ACCOUNT_STATE_ENROLLMENT_SCOPE_CHANGED'; end if;
    end loop;
    perform set_config('request.jwt.claims','{}',true);
    update public.profiles set is_active=original_active,password_change_required=original_password where id=actor;
  end loop;
end;
$states$;
rollback to savepoint dashboard_account_state;
