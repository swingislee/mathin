-- P6: 人工发布只接受首次发布或确有未发布草稿的 4:3 讲次，防止稳定 release 被重复发布。

create or replace function public.publish_cw_adapt_releases(
  p_lecture_ids uuid[],
  p_note text default ''
)
returns table (lecture_id uuid, release_id uuid)
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  requested_count integer := coalesce(cardinality(p_lecture_ids), 0);
  requested_lecture_id uuid;
  published_release_id uuid;
begin
  if uid is null or not public.has_perm(uid, 'courseware.release.publish') then raise exception 'FORBIDDEN'; end if;
  if requested_count < 1 or requested_count > 30
    or (select count(distinct item) from unnest(p_lecture_ids) item) <> requested_count then
    raise exception 'INVALID_LECTURE_SELECTION';
  end if;

  foreach requested_lecture_id in array p_lecture_ids loop
    if not exists (
      select 1
      from public.list_cw_adapt_release_queue(
        null::uuid,
        requested_lecture_id,
        'pending',
        0,
        1
      ) queue_row
      where queue_row.lecture_id = requested_lecture_id
        and queue_row.ready
    ) then
      raise exception 'ADAPT_RELEASE_NOT_READY';
    end if;

    published_release_id := public.publish_cw_track_release(
      requested_lecture_id,
      'adapted-4x3',
      left(trim(coalesce(p_note, '')), 1000)
    );
    update public.cw_lecture_workflows
       set stage = 'idle', current_review_round = null, required_review_rounds_snapshot = null,
           active_review_cycle_id = null, internal_due_at = null, updated_by = uid, updated_at = now()
     where cw_lecture_workflows.lecture_id = requested_lecture_id
       and track = 'adapted-4x3'
       and active_review_cycle_id is null;
    lecture_id := requested_lecture_id;
    release_id := published_release_id;
    return next;
  end loop;
end;
$$;

revoke all on function public.publish_cw_adapt_releases(uuid[], text) from public;
grant execute on function public.publish_cw_adapt_releases(uuid[], text) to authenticated;
