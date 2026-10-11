begin;

-- Public discovery describes these offerings as activities. Their native class
-- identities and registration targets remain unchanged.
alter table public.miniapp_short_course_publications
  alter column tags set default array['活动']::text[];

commit;
