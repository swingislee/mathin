-- 管理补交保存业务完成时间；真实提交时间继续用于审计与审核。
begin;

alter table public.session_preparation_reviews
  add column completed_at timestamptz check (completed_at is null or isfinite(completed_at));
comment on column public.session_preparation_reviews.completed_at is
  '管理员为当前材料版本登记的实际完成时间；为空时按真实 submitted_at 评估是否如期。';

-- 新版本不能沿用前一次补录的完成时间，审核动作本身保留当前完成时间。
create function public.reset_session_material_completion_time()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if new.revision is distinct from old.revision
     or new.submitted_at is distinct from old.submitted_at
     or new.submitted_by is distinct from old.submitted_by then
    new.completed_at := null;
  end if;
  return new;
end;
$$;
revoke all on function public.reset_session_material_completion_time() from public, anon, authenticated;
create trigger session_preparation_reviews_reset_completion_time
before update of revision, submitted_at, submitted_by on public.session_preparation_reviews
for each row execute function public.reset_session_material_completion_time();

-- 六参数入口复用既有追加事务及作用域；五参数入口继续兼容原客户端。
create function public.supplement_session_preparation_artifact(
  p_session_id uuid, p_kind text, p_files jsonb, p_notes text, p_video_url text,
  p_completed_at timestamptz
)
returns jsonb language plpgsql security definer
set search_path = public, pg_temp as $$
declare
  result jsonb;
  review_row public.session_preparation_reviews%rowtype;
  time_changed boolean;
begin
  if auth.uid() is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.can_supplement_session_materials(p_session_id) then raise exception 'FORBIDDEN'; end if;
  if p_completed_at is null or not isfinite(p_completed_at) or p_completed_at > clock_timestamp() then
    raise exception 'COMPLETION_TIME_INVALID';
  end if;

  result := public.supplement_session_preparation_artifact(p_session_id, p_kind, p_files, p_notes, p_video_url);
  select * into review_row from public.session_preparation_reviews
  where session_id = p_session_id and artifact_kind = p_kind for update;
  if not found then raise exception 'MATERIAL_CONFLICT'; end if;
  time_changed := review_row.completed_at is distinct from p_completed_at;
  if time_changed then
    update public.session_preparation_reviews set completed_at = p_completed_at
    where session_id = p_session_id and artifact_kind = p_kind;
    perform public.emit_domain_event(
      'session.preparation.completion_recorded', 'class_session', p_session_id,
      jsonb_build_object('artifactKind', p_kind, 'revision', review_row.revision,
        'completedAt', p_completed_at, 'previousCompletedAt', review_row.completed_at,
        'submittedAt', review_row.submitted_at),
      null, '/dashboard/sessions/' || p_session_id::text
    );
  end if;
  return result || jsonb_build_object('completedAt', p_completed_at, 'timeChanged', time_changed);
end;
$$;
revoke all on function public.supplement_session_preparation_artifact(uuid,text,jsonb,text,text,timestamptz)
  from public, anon, authenticated;
grant execute on function public.supplement_session_preparation_artifact(uuid,text,jsonb,text,text,timestamptz)
  to authenticated;
comment on function public.supplement_session_preparation_artifact(uuid,text,jsonb,text,text,timestamptz) is
  '管理追加材料并登记当前版本完成时间；保留真实提交和审核时间，事件记录实际操作者与时间更正。';

commit;
