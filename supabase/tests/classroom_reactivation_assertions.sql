\set ON_ERROR_STOP on
-- Classroom completion is reversible. All temporary writes are rolled back.
begin;

select id as admin_id from public.profiles where display_name = '测试-管理员' limit 1 \gset
select id as classroom_id
from public.classrooms
where operational_status = 'active' and trashed_at is null
order by created_at desc
limit 1 \gset

\if :{?admin_id}
\else
  \echo classroom reactivation fixture missing: admin
  select 1 / 0;
\endif
\if :{?classroom_id}
\else
  \echo classroom reactivation fixture missing: active classroom
  select 1 / 0;
\endif

set local role authenticated;
select set_config('request.jwt.claim.sub', :'admin_id', true) as jwt_subject_set \gset

select public.transition_classroom_status(:'classroom_id', 'completed');
select operational_status = 'completed' as completed_ok
from public.classrooms where id = :'classroom_id' \gset
\if :completed_ok
\else
  \echo classroom completion transition failed
  select 1 / 0;
\endif

select public.transition_classroom_status(:'classroom_id', 'active');
select operational_status = 'active' as reactivated_ok
from public.classrooms where id = :'classroom_id' \gset
\if :reactivated_ok
\else
  \echo classroom reactivation transition failed
  select 1 / 0;
\endif

reset role;
rollback;
