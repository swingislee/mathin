-- 学生五个主阶段改为按主体存储：来源证据每个来源行只保留一份，阶段与小状态在写入时算好，读取直接取列。
-- 现在与过去只按日期区分：historical 隐藏机制停用，期次结束日写入 expires_on，到期后只刷新到期的行。

create table public.school_lifecycle_evidence (
  id uuid primary key default gen_random_uuid(),
  logical_key text not null,
  source_record_id text references public.history_import_records(id) on delete set null,
  student_id uuid references public.students(id) on delete cascade,
  lead_id uuid references public.leads(id) on delete cascade,
  kind text not null check (kind in ('acquisition','contact','visit','enrollment')),
  phase text not null default '',
  occurred_on date,
  active_through date,
  period_label text not null default '',
  outcome text not null default '',
  facts jsonb not null default '{}'::jsonb,
  excerpt text not null default '',
  source_label text not null default '',
  imported_at timestamptz not null default now(),
  constraint school_lifecycle_evidence_subject check (student_id is not null or lead_id is not null),
  constraint school_lifecycle_evidence_unique unique (logical_key, kind, phase)
);
create index school_lifecycle_evidence_student on public.school_lifecycle_evidence(student_id) where student_id is not null;
create index school_lifecycle_evidence_lead on public.school_lifecycle_evidence(lead_id) where lead_id is not null;
comment on table public.school_lifecycle_evidence is '来源表与前系统提取的联系、到访／测评、报名事实；同一来源行同类事实只有一行，重新导入原位替换。';

create table public.school_subject_lifecycle (
  subject_key text primary key,
  student_id uuid,
  lead_id uuid,
  owner_id uuid,
  created_at timestamptz not null,
  stage text not null check (stage in ('awaiting_first_contact','awaiting_assessment','awaiting_enrollment','awaiting_renewal','former_student')),
  status text not null,
  expires_on date,
  wechat text,
  interest text,
  contact_attempts integer not null default 0,
  last_contact_on date,
  last_contact_outcome text,
  last_contact_excerpt text not null default '',
  last_visit_on date,
  assessed_on date,
  assessment_band text,
  enrolled_through date,
  last_period_label text not null default '',
  acquired_on date,
  followed_on date,
  confirmed_on date,
  arrived_on date,
  enrolled_on date,
  logical_key text,
  placement_kind text,
  group_label text not null default '',
  subgroup_label text not null default '',
  group_rank integer,
  source_rank integer,
  markers jsonb not null default '[]'::jsonb,
  refreshed_at timestamptz not null default now()
);
create index school_subject_lifecycle_stage on public.school_subject_lifecycle(stage, status);
create index school_subject_lifecycle_owner on public.school_subject_lifecycle(owner_id);
create index school_subject_lifecycle_expires on public.school_subject_lifecycle(expires_on) where expires_on is not null;
create index school_subject_lifecycle_student on public.school_subject_lifecycle(student_id) where student_id is not null;
create index school_subject_lifecycle_lead on public.school_subject_lifecycle(lead_id) where lead_id is not null;
comment on table public.school_subject_lifecycle is '每个学生或未建档线索一行；阶段和小状态写入时计算，名单直接读取。expires_on 到期后由 school_lifecycle_expire 刷新。';

alter table public.school_lifecycle_evidence enable row level security;
alter table public.school_subject_lifecycle enable row level security;
revoke all on public.school_lifecycle_evidence, public.school_subject_lifecycle from anon, authenticated;

-- 刷新指定主体；p_keys 为空时刷新全部。只在写入、导入和到期时调用。
create or replace function public.school_refresh_subject_lifecycle(p_keys text[] default null)
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  zone text := coalesce((select timezone from public.organizations where singleton_key = 1), 'Asia/Shanghai');
  today date := (now() at time zone zone)::date;
  changed integer;
begin
  with subj as materialized (
    select 'student:'||s.id as key, s.id as student_id, null::uuid as lead_id, s.assigned_to as owner_id, s.created_at
      from public.students s
      where s.deleted_at is null and s.purpose <> 'test' and (p_keys is null or 'student:'||s.id = any(p_keys))
    union all
    select 'lead:'||l.id, null, l.id, l.owner_id, l.created_at
      from public.leads l
      where l.student_id is null and l.purpose <> 'test' and (p_keys is null or 'lead:'||l.id = any(p_keys))
  ), lref as materialized (
    select s.key, l.id, l.owner_id, l.status from subj s join public.leads l on l.id = s.lead_id
    union
    select s.key, l.id, l.owner_id, l.status from subj s join public.leads l on l.student_id = s.student_id where s.student_id is not null
  ), ev as materialized (
    select s.key, e.* from subj s join public.school_lifecycle_evidence e on e.student_id = s.student_id where s.student_id is not null
    union all
    select r.key, e.* from lref r join public.school_lifecycle_evidence e on e.lead_id = r.id and e.student_id is null
  ), contacts as materialized (
    -- 来源联系已按备注语义判定；原生联系按老师所选结果，低意向视为暂无需求。
    select e.key, e.occurred_on as on_date, e.outcome,
      coalesce((e.facts->>'wechat')::boolean, false) as wechat, coalesce((e.facts->>'visit')::boolean, false) as visit,
      e.facts->>'interest' as interest, e.excerpt,
      case e.phase when 'confirm' then 1 when 'followup' then 2 when 'talk' then 3 else 0 end as phase_rank
      from ev e where e.kind = 'contact'
    union all
    select r.key, coalesce(c.occurred_on, (c.occurred_at at time zone zone)::date),
      case c.outcome when 'invalid_number' then 'invalid' when 'unreachable' then 'unreachable'
        when 'connected' then case when c.interest_level = 'C' then 'declined' else 'connected' end
        when 'declined' then 'connected' else coalesce(c.outcome, 'attempted') end,
      coalesce(c.wechat_added, false), coalesce(c.visit_committed, false), c.interest_level, left(coalesce(c.note, ''), 200), 4
      from lref r join public.lead_communications c on c.lead_id = r.id
      where c.source_record_id is null
  ), contact_rank as materialized (
    select c.*, (c.outcome in ('connected','declined') or c.wechat or c.visit) as effective,
      row_number() over (partition by c.key order by c.on_date desc nulls last, c.phase_rank desc) as recency
      from contacts c
  ), contact_summary as (
    select c.key,
      bool_or(c.effective) as effective,
      count(*) filter (where c.outcome in ('unreachable','callback','invalid','attempted')) as attempts,
      bool_or(c.outcome = 'invalid') as invalid, bool_or(c.outcome = 'callback') as callback,
      bool_or(c.outcome = 'unreachable') as unreachable, bool_or(c.visit) as visit,
      max(c.on_date) as last_on,
      (array_agg(c.outcome order by c.recency))[1] as last_outcome,
      (array_agg(c.excerpt order by c.recency))[1] as last_excerpt,
      (array_agg(c.outcome order by c.recency) filter (where c.effective))[1] as last_effective_outcome,
      (array_agg(c.interest order by c.recency) filter (where c.interest in ('A','B','C')))[1] as interest,
      max(c.on_date) filter (where c.phase_rank = 1) as confirmed_on,
      max(c.on_date) filter (where c.phase_rank in (2,3)) as followed_on
      from contact_rank c group by c.key
  ), acquisition as (
    select e.key, max(e.occurred_on) as acquired_on,
      (array_agg(e.facts->>'wechatNow' order by e.occurred_on desc nulls last) filter (where e.facts ? 'wechatNow'))[1] as wechat_now,
      bool_or(coalesce((e.facts->>'promisedClaim')::boolean, false)) as promised,
      (array_agg(e.facts->>'intent' order by e.occurred_on desc nulls last) filter (where e.facts->>'intent' in ('A','B','C')))[1] as intent
      from ev e where e.kind = 'acquisition' group by e.key
  ), regs as materialized (
    select s.key, r.* from subj s join public.activity_registrations r on r.student_id = s.student_id where s.student_id is not null
    union
    select l.key, r.* from lref l join public.activity_registrations r on r.lead_id = l.id
  ), visits as materialized (
    select e.key, e.occurred_on as on_date, e.outcome, coalesce((e.facts->>'tested')::boolean, false) as tested, nullif(e.facts->>'band', '') as band
      from ev e where e.kind = 'visit'
    union all
    -- 原生登记的到访与测评；来源导入的登记已由证据表承接。
    select r.key, coalesce(a.occurred_on, (a.scheduled_at at time zone zone)::date, (r.assessment_completed_at at time zone zone)::date),
      case r.status when 'attended' then 'arrived' when 'no_show' then 'no_show' when 'booked' then 'booked' else r.status end,
      public.student_assessment_is_complete(r.status, r.assessment_completed_at, x.result_finalized_at, x.result_source, x.score, x.assessment_band, x.strengths,
        concat_ws(E'\n', x.strengths, x.focus_areas, x.parent_concerns, x.teacher_recommendation, x.teacher_observation)),
      x.assessment_band
      from regs r join public.activities a on a.id = r.activity_id and a.deleted_at is null
      left join lateral (select * from public.assessment_results x where x.activity_registration_id = r.id order by x.updated_at desc limit 1) x on true
      where r.source_record_id is null and r.status in ('attended','no_show','booked')
    union all
    select r.key, coalesce(x.assessed_on, (x.result_finalized_at at time zone zone)::date), 'arrived', true, x.assessment_band
      from regs r join public.assessment_results x on x.activity_registration_id = r.id
      where r.source_record_id is not null and x.source_record_id is null
        and public.student_assessment_is_complete('attended', r.assessment_completed_at, x.result_finalized_at, x.result_source, x.score, x.assessment_band, x.strengths,
          concat_ws(E'\n', x.strengths, x.focus_areas, x.parent_concerns, x.teacher_recommendation, x.teacher_observation))
    union all
    -- 短期专题班是到访活动，不算正式报名。
    select 'student:'||m.student_id, coalesce(m.joined_at at time zone zone, m.created_at at time zone zone)::date, 'arrived', false, null
      from subj s join public.enrollments m on m.student_id = s.student_id join public.classrooms c on c.id = m.classroom_id
      where c.offering_type <> 'long_term_formal' and c.purpose <> 'test'
  ), visit_summary as (
    select v.key,
      bool_or(v.tested and v.outcome <> 'no_show') as tested,
      bool_or(v.outcome = 'arrived') as arrived,
      max(v.on_date) filter (where v.outcome = 'arrived') as last_visit_on,
      max(v.on_date) filter (where v.tested and v.outcome <> 'no_show') as assessed_on,
      (array_agg(v.band order by v.on_date desc nulls last) filter (where v.tested and v.band is not null))[1] as band,
      (array_agg(v.outcome order by v.on_date desc nulls last))[1] as last_outcome,
      bool_or(v.outcome = 'booked') as booked,
      max(v.on_date) as last_on,
      count(*) > 0 as has_visit
      from visits v group by v.key
  ), invitations as (
    select distinct on (l.key) l.key, i.kind, i.state
      from lref l join public.lead_invitation_threads i on i.lead_id = l.id
      where i.state not in ('completed','cancelled')
      order by l.key, i.updated_at desc
  ), enrollment_facts as materialized (
    select e.key, e.outcome, e.occurred_on, e.active_through, e.period_label, e.facts->>'mode' as mode, false as placed
      from ev e where e.kind = 'enrollment'
    union all
    -- 正式学期报名、长期班在班关系、原生报名机会按学期结束日判断是否仍在读。
    select coalesce('student:'||ce.student_id, o.key), case ce.status when 'active' then 'enrolled' when 'cancelled' then 'withdrawn' else ce.status end,
      coalesce(ce.registered_on, (ce.confirmed_at at time zone zone)::date), t.ends_on, coalesce(t.name, ce.period_label, ''), null, false
      from public.course_enrollments ce join public.school_terms t on t.id = ce.term_id
      left join lateral (select coalesce('student:'||op.student_id, (select r.key from lref r where r.id = op.lead_id limit 1)) as key
        from public.course_opportunities op where op.id = ce.opportunity_id) o on true
      where coalesce('student:'||ce.student_id, o.key) in (select key from subj)
    union all
    select 'student:'||m.student_id, case when m.status = 'active' and m.left_at is null then 'enrolled' else 'withdrawn' end,
      (m.joined_at at time zone zone)::date, coalesce(t.ends_on, ct.ends_on), c.name, null, m.status = 'active' and m.left_at is null
      from subj s join public.enrollments m on m.student_id = s.student_id join public.classrooms c on c.id = m.classroom_id
      left join public.school_terms t on t.id = m.term_id left join public.school_terms ct on ct.id = c.term_id
      where c.offering_type = 'long_term_formal' and c.purpose <> 'test'
    union all
    select coalesce('student:'||o.student_id, (select r.key from lref r where r.id = o.lead_id limit 1)), 'enrolled',
      (o.updated_at at time zone zone)::date, t.ends_on, t.name, null, false
      from public.course_opportunities o join public.school_terms t on t.id = o.term_id
      where o.source_record_id is null and o.stage = 'enrolled'
        and coalesce('student:'||o.student_id, (select r.key from lref r where r.id = o.lead_id limit 1)) in (select key from subj)
  ), enrollment_summary as (
    select f.key,
      bool_or(f.outcome = 'enrolled' and (f.active_through is null or f.active_through >= today) and f.active_through is not null) as active,
      bool_or(f.outcome in ('enrolled','withdrawn')) as ever,
      bool_or(f.placed and (f.active_through is null or f.active_through >= today)) as placed,
      bool_or(f.mode ~ '秋寒春') as prepaid,
      max(f.active_through) filter (where f.outcome = 'enrolled') as enrolled_through,
      max(f.active_through) filter (where f.outcome = 'enrolled' and f.active_through >= today) as active_through,
      (array_agg(f.outcome order by coalesce(f.active_through, f.occurred_on) desc nulls last))[1] as last_outcome,
      (array_agg(f.period_label order by coalesce(f.active_through, f.occurred_on) desc nulls last) filter (where f.period_label <> ''))[1] as last_period,
      max(f.occurred_on) as enrolled_on
      from enrollment_facts f where f.key is not null group by f.key
  ), opportunities as (
    select distinct on (k.key) k.key, o.opportunity_type, o.stage
      from (select coalesce('student:'||o.student_id, (select r.key from lref r where r.id = o.lead_id limit 1)) as key, o.id from public.course_opportunities o
            where o.source_record_id is null and o.stage <> 'enrolled') k
      join public.course_opportunities o on o.id = k.id
      where k.key in (select key from subj)
      order by k.key, o.updated_at desc
  ), placement as (
    select distinct on (p.key) p.key, p.logical_key, p.kind, p.group_label, p.subgroup_label, p.group_rank, p.source_rank, p.markers
      from (
        select s.key, w.* from subj s join public.school_source_worklist_entries w on w.student_id = s.student_id where s.student_id is not null
        union all
        select l.key, w.* from lref l join public.school_source_worklist_entries w on w.lead_id = l.id and w.student_id is null
      ) p order by p.key, p.kind = 'service' desc, p.kind = 'assessment' desc, p.group_rank, p.source_rank
  ), computed as (
    select s.key, s.student_id, s.lead_id, coalesce(s.owner_id, (select r.owner_id from lref r where r.key = s.key and r.owner_id is not null limit 1)) as owner_id, s.created_at,
      c.effective, c.attempts, c.invalid, c.callback, c.unreachable, c.visit, c.last_on, c.last_outcome, c.last_excerpt,
      c.last_effective_outcome, c.interest, c.confirmed_on, c.followed_on, a.acquired_on, a.wechat_now, a.promised as promised_claim, a.intent,
      v.tested, v.arrived, v.last_visit_on, v.assessed_on, v.band, v.last_outcome as last_visit_outcome, v.booked, v.last_on as last_visit_any, v.has_visit,
      i.kind as invitation_kind, i.state as invitation_state,
      e.active, e.ever, e.placed, e.prepaid, e.enrolled_through, e.active_through, e.last_outcome as last_enrollment_outcome, e.last_period, e.enrolled_on,
      o.opportunity_type, o.stage as opportunity_stage,
      p.logical_key, p.kind as placement_kind, p.group_label, p.subgroup_label, p.group_rank, p.source_rank, p.markers,
      exists (select 1 from lref r where r.key = s.key and r.status = 'invalid') as lead_invalid
      from subj s
      left join contact_summary c on c.key = s.key left join acquisition a on a.key = s.key
      left join visit_summary v on v.key = s.key left join invitations i on i.key = s.key
      left join enrollment_summary e on e.key = s.key left join opportunities o on o.key = s.key
      left join placement p on p.key = s.key
  ), staged as (
    select x.*,
      case when coalesce(x.active, false) then 'awaiting_renewal'
        when coalesce(x.ever, false) then 'former_student'
        when coalesce(x.tested, false) then 'awaiting_enrollment'
        when coalesce(x.effective, false) or coalesce(x.has_visit, false) or x.invitation_state is not null or coalesce(x.promised_claim, false) then 'awaiting_assessment'
        else 'awaiting_first_contact' end as stage
      from computed x
  ), final as (
    select x.*,
      case x.stage
        when 'awaiting_renewal' then case
          when x.opportunity_type = 'renewal' and x.opportunity_stage = 'not_enrolled' then 'not_renewing'
          when x.opportunity_type = 'renewal' and x.opportunity_stage = 'considering' then 'renewal_considering'
          when x.opportunity_type = 'renewal' and x.opportunity_stage = 'committed' then 'renewal_committed'
          when coalesce(x.prepaid, false) then 'prepaid_next'
          when coalesce(x.placed, false) then 'attending' else 'awaiting_class' end
        when 'former_student' then case when x.last_enrollment_outcome = 'withdrawn' then 'withdrawn' else 'ended' end
        when 'awaiting_enrollment' then case x.opportunity_stage
          when 'committed' then 'ready_to_enroll' when 'not_enrolled' then 'not_enrolling' when 'considering' then 'considering'
          when 'payment_pending' then 'payment_pending' when 'nurturing' then 'nurturing'
          else case when x.band is null then 'assessed_no_band' else 'assessed' end end
        when 'awaiting_assessment' then case
          when x.invitation_state is not null then case when x.invitation_kind = 'assessment_1v1' and x.invitation_state = 'confirmed' then 'booked' else 'coordinating' end
          when x.last_visit_outcome = 'booked' then 'booked'
          when coalesce(x.arrived, false) then 'visited_untested'
          when x.last_visit_outcome = 'no_show' then 'no_show'
          when coalesce(x.visit, false) or coalesce(x.promised_claim, false) then 'promised'
          when x.last_effective_outcome = 'declined' then 'declined'
          else 'following' end
        else case
          when x.lead_invalid or coalesce(x.invalid, false) then 'invalid_number'
          when coalesce(x.callback, false) then 'callback'
          when coalesce(x.unreachable, false) then 'unreachable'
          when coalesce(x.attempts, 0) > 0 then 'attempted'
          else 'not_contacted' end
      end as status
      from staged x
  ), upserted as (
    insert into public.school_subject_lifecycle as t (subject_key, student_id, lead_id, owner_id, created_at, stage, status, expires_on,
      wechat, interest, contact_attempts, last_contact_on, last_contact_outcome, last_contact_excerpt, last_visit_on, assessed_on, assessment_band,
      enrolled_through, last_period_label, acquired_on, followed_on, confirmed_on, arrived_on, enrolled_on,
      logical_key, placement_kind, group_label, subgroup_label, group_rank, source_rank, markers, refreshed_at)
    select f.key, f.student_id, f.lead_id, f.owner_id, f.created_at, f.stage, f.status,
      case when f.stage = 'awaiting_renewal' then f.active_through + 1 end,
      case when f.wechat_now = '已加V' or coalesce(f.effective, false) and exists (select 1 from contact_rank r where r.key = f.key and r.wechat) then 'yes'
        when f.wechat_now = '未加V' then 'no' end,
      coalesce(f.interest, f.intent), coalesce(f.attempts, 0)::integer, f.last_on, f.last_outcome, coalesce(f.last_excerpt, ''),
      f.last_visit_on, f.assessed_on, f.band, f.enrolled_through, coalesce(f.last_period, ''),
      f.acquired_on, f.followed_on, f.confirmed_on, f.last_visit_any, f.enrolled_on,
      f.logical_key, f.placement_kind, coalesce(f.group_label, ''), coalesce(f.subgroup_label, ''), f.group_rank, f.source_rank, coalesce(f.markers, '[]'::jsonb), now()
      from final f
    on conflict (subject_key) do update set
      student_id = excluded.student_id, lead_id = excluded.lead_id, owner_id = excluded.owner_id, created_at = excluded.created_at,
      stage = excluded.stage, status = excluded.status, expires_on = excluded.expires_on, wechat = excluded.wechat, interest = excluded.interest,
      contact_attempts = excluded.contact_attempts, last_contact_on = excluded.last_contact_on, last_contact_outcome = excluded.last_contact_outcome,
      last_contact_excerpt = excluded.last_contact_excerpt, last_visit_on = excluded.last_visit_on, assessed_on = excluded.assessed_on,
      assessment_band = excluded.assessment_band, enrolled_through = excluded.enrolled_through, last_period_label = excluded.last_period_label,
      acquired_on = excluded.acquired_on, followed_on = excluded.followed_on, confirmed_on = excluded.confirmed_on, arrived_on = excluded.arrived_on,
      enrolled_on = excluded.enrolled_on, logical_key = excluded.logical_key, placement_kind = excluded.placement_kind, group_label = excluded.group_label,
      subgroup_label = excluded.subgroup_label, group_rank = excluded.group_rank, source_rank = excluded.source_rank, markers = excluded.markers,
      refreshed_at = excluded.refreshed_at
    returning 1
  )
  select count(*) into changed from upserted;

  -- 线索转为学生、学生删除或改为测试后，旧主体行退出名单。
  delete from public.school_subject_lifecycle t
    where (p_keys is null or t.subject_key = any(p_keys))
      and not exists (select 1 from public.students s where t.subject_key = 'student:'||s.id and s.deleted_at is null and s.purpose <> 'test')
      and not exists (select 1 from public.leads l where t.subject_key = 'lead:'||l.id and l.student_id is null and l.purpose <> 'test');
  return changed;
end
$function$;

-- 期次结束等到期变化：只刷新 expires_on 已到的行，名单读取前调用一次索引探测。
create or replace function public.school_lifecycle_expire()
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  today date := (now() at time zone coalesce((select timezone from public.organizations where singleton_key = 1), 'Asia/Shanghai'))::date;
  keys text[];
begin
  select array_agg(subject_key) into keys from public.school_subject_lifecycle where expires_on <= today;
  if keys is not null then perform public.school_refresh_subject_lifecycle(keys); end if;
end
$function$;

-- 写入触发：收集受影响主体，只刷新这些行。导入事务可设置 mathin.lifecycle_deferred=on，末尾统一刷新。
create or replace function public.school_lifecycle_keys(p_table text, p_rows jsonb)
returns text[]
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  with r as (select value as j from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb))),
  ids as (
    select nullif(j->>'student_id', '')::uuid as student_id, nullif(j->>'lead_id', '')::uuid as lead_id from r
      where p_table not in ('students','leads','assessment_results','course_enrollments','course_opportunities')
    union all select (j->>'id')::uuid, null from r where p_table = 'students'
    union all select nullif(j->>'student_id', '')::uuid, (j->>'id')::uuid from r where p_table = 'leads'
    union all select coalesce(nullif(j->>'student_id', '')::uuid, ar.student_id), coalesce(nullif(j->>'lead_id', '')::uuid, ar.lead_id) from r
      left join public.activity_registrations ar on ar.id = nullif(j->>'activity_registration_id', '')::uuid where p_table = 'assessment_results'
    union all select coalesce(nullif(j->>'student_id', '')::uuid, op.student_id), op.lead_id from r
      left join public.course_opportunities op on op.id = nullif(j->>'opportunity_id', '')::uuid where p_table = 'course_enrollments'
    union all select nullif(j->>'student_id', '')::uuid, nullif(j->>'lead_id', '')::uuid from r where p_table = 'course_opportunities'
  )
  select coalesce(array_agg(distinct k) filter (where k is not null), '{}') from (
    select 'student:'||student_id as k from ids where student_id is not null
    union select 'lead:'||lead_id from ids where lead_id is not null
    union select 'student:'||l.student_id from ids join public.leads l on l.id = ids.lead_id where l.student_id is not null
  ) x;
$function$;

create or replace function public.school_lifecycle_touch()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare rows jsonb := '[]'::jsonb; part jsonb;
begin
  if coalesce(current_setting('mathin.lifecycle_deferred', true), '') = 'on' then return null; end if;
  if tg_op in ('INSERT','UPDATE') then
    execute 'select coalesce(jsonb_agg(to_jsonb(n)), ''[]'') from new_rows n' into part; rows := rows || part;
  end if;
  if tg_op in ('UPDATE','DELETE') then
    execute 'select coalesce(jsonb_agg(to_jsonb(o)), ''[]'') from old_rows o' into part; rows := rows || part;
  end if;
  perform public.school_refresh_subject_lifecycle(public.school_lifecycle_keys(tg_table_name, rows));
  return null;
end
$function$;

do $$
declare t text;
begin
  foreach t in array array['students','leads','lead_communications','activity_registrations','assessment_results','course_enrollments',
    'course_opportunities','enrollments','lead_invitation_threads','school_lifecycle_evidence'] loop
    execute format('create trigger %I after insert on public.%I referencing new table as new_rows for each statement execute function public.school_lifecycle_touch()', t||'_lifecycle_ins', t);
    execute format('create trigger %I after update on public.%I referencing new table as new_rows old table as old_rows for each statement execute function public.school_lifecycle_touch()', t||'_lifecycle_upd', t);
    execute format('create trigger %I after delete on public.%I referencing old table as old_rows for each statement execute function public.school_lifecycle_touch()', t||'_lifecycle_del', t);
  end loop;
end $$;

revoke all on function public.school_refresh_subject_lifecycle(text[]), public.school_lifecycle_expire(), public.school_lifecycle_keys(text, jsonb), public.school_lifecycle_touch() from public, anon, authenticated;
grant execute on function public.school_lifecycle_expire() to authenticated;

-- 现在／过去按日期区分：来源版本、xlsx 来源与工作范围不再把事实隐藏为 historical。
-- 三个判定改为可内联的常量，名单逐行读取不再为它们查表。
create or replace function public.business_source_is_current(p_record_id text)
returns boolean language sql immutable parallel safe as $function$ select true $function$;
create or replace function public.business_source_is_authoritative(p_record_id text)
returns boolean language sql immutable parallel safe as $function$ select true $function$;
create or replace function public.business_fact_is_current(p_relation text, p_id uuid)
returns boolean language sql immutable parallel safe as $function$ select true $function$;

update public.course_enrollments set record_state = 'current' where record_state = 'historical';

-- 名单索引直接读取存储的阶段；可见范围、搜索与分页逻辑保持原状。
create or replace function public.student_record_index_for_population(p_scope text, p_search text, p_enrollments business_course_enrollment_subjects[], p_students_only boolean)
 returns table(student_id uuid, lead_id uuid, key text, stage text, detail text, created_at timestamp with time zone)
 language plpgsql
 stable security definer
 set search_path to 'public', 'pg_temp'
 set plan_cache_mode to 'force_custom_plan'
as $function$
#variable_conflict use_variable
declare actor uuid:=auth.uid(); view_all boolean; view_followup boolean;
begin
  if actor is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.is_staff(actor) then raise exception 'FORBIDDEN'; end if;
  view_all:=public.has_perm(actor,'student.view.all');
  view_followup:=public.has_perm(actor,'followup.view');
  if p_scope in ('mine','group') and not exists(select 1 from public.school_list_scope_keys(actor,p_scope)) then return; end if;
  return query with
  visibility as materialized (select vis.key,vis.can_view from public.school_list_visibility(actor) vis where not view_all),
  scope_keys as materialized (select scoped.key from public.school_list_scope_keys(actor,p_scope) scoped),
  subjects as materialized (
    select s.id as student_id,null::uuid as lead_id,'student:'||s.id as key,s.created_at
      from public.students s where s.deleted_at is null and s.purpose<>'test' and (view_all or exists(select 1 from visibility v where v.key='student:'||s.id and v.can_view))
        and (p_scope='all' or (p_scope='mine' and exists(select 1 from scope_keys k where k.key='student:'||s.id)) or (p_scope='unassigned' and s.assigned_to is null or p_scope='group' and exists(select 1 from scope_keys k where k.key='student:'||s.id)))
        and (coalesce(p_search,'')='' or s.id::text=p_search
          or position(lower(p_search) in lower(s.name||' '||s.school||' '||s.phone||' '||s.parent_phone))>0
          or (length(regexp_replace(p_search,'\D','','g'))>=3 and
            position(regexp_replace(p_search,'\D','','g') in regexp_replace(s.phone||' '||s.parent_phone,'\D','','g'))>0))
    union all
    select null,l.id,'lead:'||l.id,l.created_at from public.leads l
      where not p_students_only and l.student_id is null and l.purpose<>'test' and view_followup and case when view_all or l.owner_id is null or l.owner_id=actor then true else exists(select 1 from visibility v where v.key='lead:'||l.id and v.can_view) end
        and (p_scope='all' or (p_scope='mine' and exists(select 1 from scope_keys k where k.key='lead:'||l.id)) or (p_scope='unassigned' and l.owner_id is null or p_scope='group' and exists(select 1 from scope_keys k where k.key='lead:'||l.id)))
        and (coalesce(p_search,'')='' or l.id::text=p_search
          or position(lower(p_search) in lower(l.provisional_student_name||' '||l.phone))>0
          or (length(regexp_replace(p_search,'\D','','g'))>=3 and position(regexp_replace(p_search,'\D','','g') in l.phone_normalized)>0))
  ), lead_of as (
    select distinct on(l.student_id) l.student_id,l.id from public.leads l
      where l.student_id in (select s.student_id from subjects s where s.student_id is not null)
      order by l.student_id,(l.status not in ('invalid','converted')) desc,l.created_at desc,l.id
  )
  select s.student_id,coalesce(s.lead_id,lo.id),s.key,coalesce(c.stage,'awaiting_first_contact'),coalesce(c.status,'not_contacted'),s.created_at
    from subjects s left join public.school_subject_lifecycle c on c.subject_key=s.key
    left join lead_of lo on lo.student_id=s.student_id;
end;
$function$;
