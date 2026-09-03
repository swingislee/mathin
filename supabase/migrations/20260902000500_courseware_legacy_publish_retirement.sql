-- Step 7B: publication must follow a passed cw_review_cycle. The direct track
-- publisher and the retired 4:3 batch publisher belonged to the unpublished
-- Studio workflow and must no longer be callable application APIs.
-- Historical releases, review cycles and adaptation audit rows are preserved.

begin;

drop function if exists public.publish_cw_adapt_releases(uuid[], text);
drop function if exists public.publish_cw_adapt_releases_pre_sml0_impl(uuid[], text);
drop function if exists public.publish_cw_track_release(uuid, text, text);
drop function if exists public.publish_cw_track_release_pre_sml0_impl(uuid, text, text);

comment on function public.publish_cw_review_cycle(uuid, text, text) is
  'Canonical courseware publication entry: publishes only a passed active review cycle.';

commit;
