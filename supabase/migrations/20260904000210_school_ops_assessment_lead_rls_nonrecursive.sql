-- Replace the first aggregate-workbench lead policy with the repository's
-- established SECURITY DEFINER predicate pattern. The direct policy crosses
-- into invitation RLS, whose scope also reads leads, and can therefore recurse.

create or replace function public.has_assessment_history_lead_access(
  p_lead_id uuid
) returns boolean
language sql security definer stable
set search_path = public, pg_temp
as $$
  select auth.uid() is not null
     and public.has_perm(auth.uid(), 'review.write')
     and exists (
       select 1
         from public.activities activity
         join public.lead_invitation_threads invitation
           on invitation.id = activity.source_invitation_id
        where invitation.lead_id = p_lead_id
          and invitation.assessor_id = auth.uid()
          and activity.deleted_at is null
     );
$$;

drop policy if exists leads_select_assessment_assessor on public.leads;
create policy leads_select_assessment_assessor on public.leads
  for select to authenticated using (
    public.has_assessment_history_lead_access(id)
  );

revoke all on function public.has_assessment_history_lead_access(uuid)
  from public, anon, authenticated;
grant execute on function public.has_assessment_history_lead_access(uuid)
  to authenticated;

select pg_notify('pgrst', 'reload schema');
