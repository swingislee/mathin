-- R1-6: mutable autosave layer for stage reports; immutable revisions are appended only on submit.
begin;

create table if not exists public.stage_report_drafts (
  head_id uuid primary key references public.learning_result_heads(id) on delete cascade,
  title text not null default '',
  summary text not null default '',
  teacher_comment text not null default '',
  data_cutoff_at timestamptz not null,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table public.stage_report_drafts enable row level security;
revoke all on table public.stage_report_drafts from public, anon, authenticated;

insert into public.stage_report_drafts(head_id, title, summary, teacher_comment, data_cutoff_at, updated_by, updated_at)
select head_row.id,
       coalesce(revision_row.content ->> 'title', ''),
       coalesce(revision_row.content ->> 'summary', ''),
       coalesce(revision_row.content ->> 'teacherComment', ''),
       coalesce(revision_row.data_cutoff_at, head_row.updated_at),
       coalesce(revision_row.created_by, head_row.created_by),
       greatest(head_row.updated_at, coalesce(revision_row.created_at, head_row.updated_at))
  from public.learning_result_heads head_row
  left join public.learning_result_revisions revision_row on revision_row.id = head_row.current_revision_id
 where head_row.kind = 'stage_report'
on conflict(head_id) do nothing;

create or replace function public.save_stage_report_autodraft(
  p_student_id uuid,
  p_term_id uuid,
  p_period_start date,
  p_period_end date,
  p_title text,
  p_summary text,
  p_teacher_comment text,
  p_data_cutoff_at timestamptz,
  p_head_id uuid default null
)
returns table(result_head_id uuid, result_status text)
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  term_start date; term_end date;
  source_value text;
  head_row public.learning_result_heads%rowtype;
  draft_row public.stage_report_drafts%rowtype;
  next_status text;
  changed boolean := true;
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if p_period_start is null or p_period_end is null or p_period_end < p_period_start
     or p_data_cutoff_at is null or p_data_cutoff_at > now() + interval '5 minutes'
     or char_length(coalesce(p_title, '')) > 200
     or char_length(coalesce(p_summary, '')) > 10000
     or char_length(coalesce(p_teacher_comment, '')) > 5000 then
    raise exception 'VALIDATION';
  end if;
  select term_row.starts_on, term_row.ends_on into term_start, term_end
    from public.school_terms term_row where term_row.id = p_term_id;
  if term_start is null then raise exception 'TERM_NOT_FOUND'; end if;
  if p_period_start < term_start or p_period_end > term_end then raise exception 'PERIOD_OUTSIDE_TERM'; end if;
  if not exists(select 1 from public.students where id = p_student_id and deleted_at is null) then
    raise exception 'STUDENT_NOT_FOUND';
  end if;
  if not public.can_manage_learning_result(p_student_id, p_term_id, uid) then raise exception 'FORBIDDEN'; end if;

  source_value := p_student_id::text || ':' || p_term_id::text || ':' || p_period_start::text || ':' || p_period_end::text;
  if p_head_id is null then
    select * into head_row from public.learning_result_heads
     where kind = 'stage_report' and source_key = source_value for update;
    if not found then
      insert into public.learning_result_heads(
        kind, source_key, student_id, term_id, period_start, period_end,
        status, requires_review, created_by
      ) values (
        'stage_report', source_value, p_student_id, p_term_id, p_period_start, p_period_end,
        'draft', true, uid
      ) returning * into head_row;
    end if;
  else
    select * into head_row from public.learning_result_heads where id = p_head_id for update;
    if not found or head_row.kind <> 'stage_report' or head_row.source_key <> source_value then
      raise exception 'RESULT_SCOPE_MISMATCH';
    end if;
  end if;
  if head_row.status = 'review' then raise exception 'INVALID_STATE'; end if;

  select * into draft_row from public.stage_report_drafts where head_id = head_row.id for update;
  if found then
    changed := draft_row.title <> btrim(coalesce(p_title, ''))
      or draft_row.summary <> btrim(coalesce(p_summary, ''))
      or draft_row.teacher_comment <> btrim(coalesce(p_teacher_comment, ''))
      or draft_row.data_cutoff_at <> p_data_cutoff_at;
  end if;

  if changed then
    insert into public.stage_report_drafts(
      head_id, title, summary, teacher_comment, data_cutoff_at, updated_by, updated_at
    ) values (
      head_row.id, btrim(coalesce(p_title, '')), btrim(coalesce(p_summary, '')),
      btrim(coalesce(p_teacher_comment, '')), p_data_cutoff_at, uid, now()
    ) on conflict(head_id) do update set
      title = excluded.title,
      summary = excluded.summary,
      teacher_comment = excluded.teacher_comment,
      data_cutoff_at = excluded.data_cutoff_at,
      updated_by = excluded.updated_by,
      updated_at = excluded.updated_at;

    next_status := case when head_row.status in ('published', 'withdrawn', 'revised') then 'revised' else 'draft' end;
    update public.learning_result_heads
       set status = next_status, reviewed_by = null, reviewed_at = null, updated_at = now()
     where id = head_row.id;
    if head_row.status in ('published', 'withdrawn') then
      perform public.record_learning_result_transition(
        head_row.id, coalesce(head_row.current_revision_id, head_row.published_revision_id),
        head_row.status, next_status, 'stage report draft changed', uid, true
      );
    end if;
  else
    next_status := head_row.status;
  end if;

  return query select head_row.id, next_status;
end
$$;
revoke all on function public.save_stage_report_autodraft(uuid,uuid,date,date,text,text,text,timestamptz,uuid)
  from public, anon, authenticated;
grant execute on function public.save_stage_report_autodraft(uuid,uuid,date,date,text,text,text,timestamptz,uuid)
  to authenticated;

create or replace function public.list_learning_results_for_staff(
  p_student_id uuid default null, p_kind text default null
) returns table(
  head_id uuid, kind text, student_id uuid, term_id uuid, session_id uuid, video_id uuid,
  period_start date, period_end date, status text, requires_review boolean,
  revision_id uuid, revision_no integer, content jsonb, metric_version text,
  data_cutoff_at timestamptz, timezone text, dataset jsonb, updated_at timestamptz
) language sql security definer stable set search_path = public, pg_temp
as $$
  select head_row.id, head_row.kind, head_row.student_id, head_row.term_id,
         head_row.session_id, head_row.video_id, head_row.period_start, head_row.period_end,
         head_row.status, head_row.requires_review, revision_row.id, revision_row.revision_no,
         case
           when head_row.kind = 'stage_report' and head_row.status in ('draft', 'revised')
             and draft_row.head_id is not null
           then jsonb_build_object(
             'title', draft_row.title,
             'summary', draft_row.summary,
             'teacherComment', draft_row.teacher_comment
           )
           else revision_row.content
         end,
         revision_row.metric_version,
         case
           when head_row.kind = 'stage_report' and head_row.status in ('draft', 'revised')
             and draft_row.head_id is not null then draft_row.data_cutoff_at
           else revision_row.data_cutoff_at
         end,
         revision_row.timezone, revision_row.dataset,
         greatest(head_row.updated_at, coalesce(draft_row.updated_at, head_row.updated_at))
    from public.learning_result_heads head_row
    left join public.learning_result_revisions revision_row on revision_row.id = head_row.current_revision_id
    left join public.stage_report_drafts draft_row on draft_row.head_id = head_row.id
   where (p_student_id is null or head_row.student_id = p_student_id)
     and (p_kind is null or head_row.kind = p_kind)
     and public.can_view_learning_result(head_row.student_id, head_row.term_id, auth.uid())
   order by greatest(head_row.updated_at, coalesce(draft_row.updated_at, head_row.updated_at)) desc, head_row.id
$$;
revoke all on function public.list_learning_results_for_staff(uuid,text) from public, anon, authenticated;
grant execute on function public.list_learning_results_for_staff(uuid,text) to authenticated;

comment on table public.stage_report_drafts
  is 'Mutable autosave layer. Immutable learning_result_revisions are appended only when a stage report is submitted.';
comment on function public.save_stage_report_autodraft(uuid,uuid,date,date,text,text,text,timestamptz,uuid)
  is 'Autosaves partial stage-report fields without appending immutable publication history.';

commit;