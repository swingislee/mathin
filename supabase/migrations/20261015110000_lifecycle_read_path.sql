-- 名单读取直接使用阶段表：一页明细一次批量读取，月份带年份，期次到期在读取时即按停课呈现。
-- 现在与过去只看日期：业务记录不再区分 current／historical，historical 判定、视图过滤与恢复触发器全部停用。

alter table public.school_subject_lifecycle add column expired_status text;
comment on column public.school_subject_lifecycle.expired_status is 'expires_on 到期后的停课小状态；读取时 expires_on<=今天即按已停课呈现，无需后台任务。';

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
    select s.key, l.id, l.owner_id, l.status, l.created_at as lead_created_at from subj s join public.leads l on l.id = s.lead_id
    union
    select s.key, l.id, l.owner_id, l.status, l.created_at from subj s join public.leads l on l.student_id = s.student_id where s.student_id is not null
  ), ev as materialized (
    select s.key, e.* from subj s join public.school_lifecycle_evidence e on e.student_id = s.student_id where s.student_id is not null
    union all
    select r.key, e.* from lref r join public.school_lifecycle_evidence e on e.lead_id = r.id and e.student_id is null
  ), contacts as materialized (
    -- 来源联系已按备注语义判定；原生联系按老师所选结果，低意向视为暂无需求。
    select e.key, e.occurred_on as on_date, e.outcome,
      coalesce((e.facts->>'wechat')::boolean, false) as wechat, coalesce((e.facts->>'visit')::boolean, false) as visit,
      e.facts->>'interest' as interest, e.excerpt,
      case e.phase when 'confirm' then 1 when 'followup' then 2 when 'talk' then 3 else 0 end as phase_rank,
      -- 同日或未写日期的来源联系按表内登记先后排序。
      (e.facts->>'registeredAt')::timestamptz as registered_at, e.logical_key as tie_key
      from ev e where e.kind = 'contact'
    union all
    select r.key, coalesce(c.occurred_on, (c.occurred_at at time zone zone)::date),
      case c.outcome when 'invalid_number' then 'invalid' when 'unreachable' then 'unreachable'
        when 'connected' then case when c.interest_level = 'C' then 'declined' else 'connected' end
        when 'declined' then 'connected' else coalesce(c.outcome, 'attempted') end,
      coalesce(c.wechat_added, false), coalesce(c.visit_committed, false), c.interest_level, left(coalesce(c.note, ''), 200), 4,
      c.occurred_at, c.id::text
      from lref r join public.lead_communications c on c.lead_id = r.id
      where c.source_record_id is null
  ), contact_rank as materialized (
    select c.*, (c.outcome in ('connected','declined') or c.wechat or c.visit) as effective,
      row_number() over (partition by c.key order by c.on_date desc nulls last, c.registered_at desc nulls last, c.phase_rank desc, c.tie_key desc) as recency
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
      max(c.on_date) filter (where c.phase_rank in (2,3,4)) as followed_on
      from contact_rank c group by c.key
  ), acquisition as (
    select e.key, max(e.occurred_on) as acquired_on,
      (array_agg(e.facts->>'wechatNow' order by e.occurred_on desc nulls last, (e.facts->>'registeredAt')::timestamptz desc nulls last, e.logical_key desc)
        filter (where e.facts ? 'wechatNow'))[1] as wechat_now,
      bool_or(coalesce((e.facts->>'promisedClaim')::boolean, false)) as promised,
      (array_agg(e.facts->>'intent' order by e.occurred_on desc nulls last, (e.facts->>'registeredAt')::timestamptz desc nulls last, e.logical_key desc)
        filter (where e.facts->>'intent' in ('A','B','C')))[1] as intent
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
      -- 只有可识别的等级算“有等级”；分数、备注等原文留在证据里。
      (array_agg(v.band order by v.on_date desc nulls last, v.band) filter (where v.tested and public.student_learning_band(v.band) is not null))[1] as band,
      (array_agg(v.outcome order by v.on_date desc nulls last, case v.outcome when 'arrived' then 0 when 'no_show' then 1 else 2 end))[1] as last_outcome,
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
    select e.key, e.outcome, e.occurred_on, e.active_through, e.period_label, e.facts->>'mode' as mode, false as placed, 4 as src_rank
      from ev e where e.kind = 'enrollment'
    union all
    -- 正式学期报名、长期班在班关系、原生报名机会按学期结束日判断是否仍在读。
    select coalesce('student:'||ce.student_id, o.key), case ce.status when 'active' then 'enrolled' when 'cancelled' then 'withdrawn' else ce.status end,
      coalesce(ce.registered_on, (ce.confirmed_at at time zone zone)::date), t.ends_on, coalesce(t.name, ce.period_label, ''), null, false, 2
      from public.course_enrollments ce join public.school_terms t on t.id = ce.term_id
      left join lateral (select coalesce('student:'||op.student_id, (select r.key from lref r where r.id = op.lead_id limit 1)) as key
        from public.course_opportunities op where op.id = ce.opportunity_id) o on true
      where coalesce('student:'||ce.student_id, o.key) in (select key from subj)
    union all
    select 'student:'||m.student_id, case when m.status = 'active' and m.left_at is null then 'enrolled' else 'withdrawn' end,
      (m.joined_at at time zone zone)::date, coalesce(t.ends_on, ct.ends_on), c.name, null, m.status = 'active' and m.left_at is null, 1
      from subj s join public.enrollments m on m.student_id = s.student_id join public.classrooms c on c.id = m.classroom_id
      left join public.school_terms t on t.id = m.term_id left join public.school_terms ct on ct.id = c.term_id
      where c.offering_type = 'long_term_formal' and c.purpose <> 'test'
    union all
    select coalesce('student:'||o.student_id, (select r.key from lref r where r.id = o.lead_id limit 1)), 'enrolled',
      (o.updated_at at time zone zone)::date, t.ends_on, t.name, null, false, 3
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
      -- 同一结束日：课程结束优先于退课，班级／正式报名的名称优先于来源表期次，再按报名先后与名称排定。
      (array_agg(f.outcome order by coalesce(f.active_through, f.occurred_on) desc nulls last, (f.outcome = 'enrolled') desc, f.src_rank,
        f.occurred_on desc nulls last, f.period_label))[1] as last_outcome,
      (array_agg(f.period_label order by coalesce(f.active_through, f.occurred_on) desc nulls last, (f.outcome = 'enrolled') desc, f.src_rank,
        f.occurred_on desc nulls last, f.period_label) filter (where f.period_label <> ''))[1] as last_period,
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
      c.last_effective_outcome, c.interest, c.confirmed_on, c.followed_on,
      -- 没有来源获客行的主体（原生线索、小地推、扫码）以首次建档时间作为获取日期。
      coalesce(a.acquired_on, case when a.key is null then (least(s.created_at, (select min(r.lead_created_at) from lref r where r.key = s.key)) at time zone zone)::date end) as acquired_on,
      a.wechat_now, a.promised as promised_claim, a.intent,
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
    insert into public.school_subject_lifecycle as t (subject_key, student_id, lead_id, owner_id, created_at, stage, status, expires_on, expired_status,
      wechat, interest, contact_attempts, last_contact_on, last_contact_outcome, last_contact_excerpt, last_visit_on, assessed_on, assessment_band,
      enrolled_through, last_period_label, acquired_on, followed_on, confirmed_on, arrived_on, enrolled_on,
      logical_key, placement_kind, group_label, subgroup_label, group_rank, source_rank, markers, refreshed_at)
    select f.key, f.student_id, f.lead_id, f.owner_id, f.created_at, f.stage, f.status,
      case when f.stage = 'awaiting_renewal' then f.active_through + 1 end,
      case when f.stage = 'awaiting_renewal' then case when f.last_enrollment_outcome = 'withdrawn' then 'withdrawn' else 'ended' end end,
      case when f.wechat_now = '已加V' or coalesce(f.effective, false) and exists (select 1 from contact_rank r where r.key = f.key and r.wechat) then 'yes'
        when f.wechat_now = '未加V' then 'no' end,
      coalesce(f.interest, f.intent), coalesce(f.attempts, 0)::integer, f.last_on, f.last_outcome, coalesce(f.last_excerpt, ''),
      f.last_visit_on, f.assessed_on, f.band, f.enrolled_through, coalesce(f.last_period, ''),
      f.acquired_on, f.followed_on, f.confirmed_on, f.last_visit_any, f.enrolled_on,
      f.logical_key, f.placement_kind, coalesce(f.group_label, ''), coalesce(f.subgroup_label, ''), f.group_rank, f.source_rank, coalesce(f.markers, '[]'::jsonb), now()
      from final f
    on conflict (subject_key) do update set
      student_id = excluded.student_id, lead_id = excluded.lead_id, owner_id = excluded.owner_id, created_at = excluded.created_at,
      stage = excluded.stage, status = excluded.status, expires_on = excluded.expires_on, expired_status = excluded.expired_status, wechat = excluded.wechat, interest = excluded.interest,
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


create or replace function public.student_record_index_for_population(p_scope text, p_search text, p_enrollments business_course_enrollment_subjects[], p_students_only boolean)
 returns table(student_id uuid, lead_id uuid, key text, stage text, detail text, created_at timestamp with time zone)
 language plpgsql
 stable security definer
 set search_path to 'public', 'pg_temp'
 set plan_cache_mode to 'force_custom_plan'
as $function$
#variable_conflict use_variable
declare actor uuid:=auth.uid(); view_all boolean; view_followup boolean;
  today date:=(now() at time zone public.get_organization_timezone_v2())::date;
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
  -- 期次结束日已过的在读行直接按停课读取，不等后台刷新。
  select s.student_id,coalesce(s.lead_id,lo.id),s.key,
    case when c.expires_on<=today then 'former_student' else coalesce(c.stage,'awaiting_first_contact') end,
    case when c.expires_on<=today then coalesce(c.expired_status,'ended') else coalesce(c.status,'not_contacted') end,s.created_at
    from subjects s left join public.school_subject_lifecycle c on c.subject_key=s.key
    left join lead_of lo on lo.student_id=s.student_id;
end;
$function$;


-- 业务记录统一为当前事实；时间由各自的日期字段表达。
update public.activities set record_state='current' where record_state<>'current';
update public.activity_registrations set record_state='current' where record_state<>'current';
update public.assessment_results set record_state='current' where record_state<>'current';
update public.course_opportunities set record_state='current' where record_state<>'current';
update public.course_enrollments set record_state='current' where record_state<>'current';
update public.course_enrollment_assignments set record_state='current' where record_state<>'current';
update public.student_follow_ups set record_state='current' where record_state<>'current';

-- “恢复历史工作范围”触发器属于 historical 机制，无登录身份时还会阻断写入。
drop trigger if exists resume_history_workflow_subject on public.lead_communications;
drop trigger if exists resume_history_workflow_subject on public.activity_registrations;
drop trigger if exists resume_history_workflow_subject on public.course_enrollments;
drop trigger if exists resume_history_workflow_subject on public.course_opportunities;
drop trigger if exists resume_history_workflow_subject on public.student_follow_ups;
drop trigger if exists resume_history_workflow_subject on public.lead_next_actions;
drop trigger if exists resume_history_workflow_subject on public.enrollments;
drop function if exists public.resume_history_workflow_subject();

-- 业务视图直接给出记录本身，不再按来源版本或工作范围改写为 historical 或隐藏。
create or replace view public.business_activities with (security_invoker = true) as
SELECT r.id,
    r.kind,
    r.title,
    r.scheduled_at,
    r.duration_min,
    r.location,
    r.capacity,
    r.remark,
    r.created_by,
    r.created_at,
    r.deleted_at,
    r.term_id,
    r.source_invitation_id,
    r.public_class_print_background_path,
    r.target_grades,
        r.record_state,
    r.history_key,
    r.history_batch_id,
    r.source_record_id,
    r.source_field_ids,
    r.source_payload_sha256,
    r.history_imported_at,
    r.occurred_on,
    r.history_revision,
    r.rescheduled_at,
    r.tags
   FROM activities r;

create or replace view public.business_activity_registrations with (security_invoker = true) as
SELECT r.id,
    r.activity_id,
    r.student_id,
    r.status,
    r.outcome,
    r.operated_by,
    r.created_at,
    r.updated_at,
    r.lead_id,
    r.assessment_paper_version_id,
    r.assessment_started_at,
    r.assessment_completed_at,
        r.record_state,
    r.history_key,
    r.history_batch_id,
    r.source_record_id,
    r.source_field_ids,
    r.source_payload_sha256,
    r.history_imported_at,
    r.registered_on,
    r.reported_result,
    r.result_link_status,
    r.result_source_record_id,
    r.result_field_ids,
    r.history_revision,
    r.source_enrollment_facts,
    r.source_metric_facts,
    r.overview_contact_v2
   FROM activity_registrations r;

create or replace view public.business_assessment_results with (security_invoker = true) as
SELECT r.id,
    r.activity_registration_id,
    r.student_id,
    r.overall_level,
    r.score,
    r.strengths,
    r.focus_areas,
    r.teacher_recommendation,
    r.assessed_by,
    r.created_at,
    r.updated_at,
    r.assessment_band,
    r.parent_concerns,
    r.recommended_class,
    r.lead_id,
    r.teacher_observation,
        r.record_state,
    r.history_key,
    r.history_batch_id,
    r.source_record_id,
    r.source_field_ids,
    r.source_payload_sha256,
    r.history_imported_at,
    r.assessed_on,
    r.history_revision,
    r.result_source,
    r.result_finalized_at,
    r.score_max
   FROM assessment_results r;

create or replace view public.business_course_enrollments with (security_invoker = true) as
SELECT r.id,
    r.opportunity_id,
    r.student_id,
    r.course_id,
    r.term_id,
    r.status,
    r.note,
    r.confirmed_by,
    r.confirmed_at,
    r.cancelled_by,
    r.cancelled_at,
    r.created_at,
    r.updated_at,
        r.record_state,
    r.history_key,
    r.history_batch_id,
    r.source_record_id,
    r.source_field_ids,
    r.source_payload_sha256,
    r.history_imported_at,
    r.registered_on,
    r.period_label,
    r.amount,
    r.amount_original,
    r.history_revision,
    r.source_enrollment_facts,
    r.source_metric_facts
   FROM course_enrollments r;

create or replace view public.business_course_opportunities with (security_invoker = true) as
SELECT r.id,
    r.source_activity_route_id,
    r.student_id,
    r.lead_id,
    r.origin_lead_id,
    r.opportunity_type,
    r.course_id,
    r.term_id,
    r.stage,
    r.owner_id,
    r.next_action,
    r.next_action_at,
    r.note,
    r.created_by,
    r.updated_by,
    r.created_at,
    r.updated_at,
        r.record_state,
    r.history_key,
    r.history_batch_id,
    r.source_record_id,
    r.source_field_ids,
    r.source_payload_sha256,
    r.history_imported_at,
    r.period_year,
    r.period_key,
    r.term_label,
    r.class_label,
    r.teacher_label,
    r.history_revision
   FROM course_opportunities r;

create or replace view public.business_student_follow_ups with (security_invoker = true) as
SELECT r.id,
    r.student_id,
    r.author_id,
    r.content,
    r.kind,
    r.next_follow_up_at,
    r.status_after,
    r.created_at,
        r.record_state,
    r.history_key,
    r.history_batch_id,
    r.source_record_id,
    r.source_field_ids,
    r.source_payload_sha256,
    r.history_imported_at,
    r.occurred_on,
    r.context_kind,
    r.author_label,
    r.date_basis,
    r.history_revision,
    r.context_source_record_id
   FROM student_follow_ups r;

create or replace view public.business_lead_communications as
SELECT lead_communications.id,
    lead_communications.lead_id,
    lead_communications.channel,
    lead_communications.outcome,
    lead_communications.note,
    lead_communications.wechat_added,
    lead_communications.visit_committed,
    lead_communications.interest_level,
    lead_communications.recorded_by,
    lead_communications.owner_id_at_contact,
    lead_communications.occurred_at,
    lead_communications.source_record_id,
    lead_communications.source_key,
    lead_communications.occurred_on,
    lead_communications.source_metric_facts,
    lead_communications.overview_contact_v2
   FROM lead_communications
  WHERE NOT COALESCE((lead_communications.source_metric_facts -> 'supersededProjection'::text) = 'true'::jsonb, false);

create or replace view public.assessment_reference_dates with (security_invoker = true) as
SELECT r.id AS registration_id,
    COALESCE(ar.assessed_on, a.occurred_on,
        CASE
            WHEN r.source_record_id IS NULL AND a.source_record_id IS NULL THEN (COALESCE(r.assessment_completed_at, ar.result_finalized_at, a.scheduled_at) AT TIME ZONE 'Asia/Shanghai'::text)::date
            ELSE NULL::date
        END) AS assessed_on
   FROM business_activity_registrations r
     JOIN business_activities a ON a.id = r.activity_id
     LEFT JOIN business_assessment_results ar ON ar.activity_registration_id = r.id
  WHERE a.deleted_at IS NULL;

-- 名单一页的明细一次读完：阶段与小状态取调用方传入（来自阶段表），其余背景按整页批量读取，不再逐行调用单人读取。
create or replace function public.student_record_list_rows(p_subjects jsonb, p_enrollments business_course_enrollment_subjects[])
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public', 'pg_temp'
 set plan_cache_mode to 'force_custom_plan'
as $function$
declare actor uuid:=auth.uid(); view_followup boolean:=public.has_perm(auth.uid(),'followup.view');
  write_followup boolean:=public.has_perm(auth.uid(),'followup.write'); view_all boolean:=public.has_perm(auth.uid(),'student.view.all');
  zone text:=public.get_organization_timezone_v2(); today date; result jsonb;
begin
  if actor is null or not public.is_staff(actor) then raise exception 'FORBIDDEN'; end if;
  today:=(now() at time zone zone)::date;
  with subjects as materialized (select * from jsonb_to_recordset(p_subjects)
    as s(student_id uuid,lead_id uuid,key text,stage text,detail text,created_at timestamptz)),
  evidence as materialized (
    select e.* from public.school_record_read_context(p_subjects) e
  ),
  life as materialized (select c.* from public.school_subject_lifecycle c join subjects s on s.key=c.subject_key),
  lead_refs as materialized (select l.id,s.key from public.leads l join subjects s on
    l.id=s.lead_id or s.student_id is not null and l.student_id=s.student_id
    where view_followup and case when view_all or l.owner_id is null or l.owner_id=actor then true else public.can_view_school_lead(l.id,actor) end),
  contacts as materialized (select ref.key,c.id,c.source_record_id,c.occurred_at,coalesce(r.effective_patch->>'note',c.note) as note,
      coalesce(c.occurred_at,c.occurred_on::timestamp at time zone zone) as sort_at,coalesce(to_jsonb(c.occurred_at)#>>'{}',c.occurred_on::text) as at_text,
      public.school_contact_sort_key(c.occurred_at,c.occurred_on,c.source_metric_facts,c.source_key) as contact_order
    from public.business_lead_communications c join lead_refs ref on ref.id=c.lead_id
    left join lateral (select effective_patch from public.communication_record_revisions r
      where r.source='contact' and r.event_id=c.id order by r.revision_no desc limit 1) r on true),
  recent_contact as (select distinct on(key) key,source_record_id from contacts order by key,occurred_at desc nulls last,contact_order desc,id),
  source_refs as materialized (
    select s.key,h.id from subjects s join public.history_import_records h on h.student_id=s.student_id
    union select l.key,h.id from lead_refs l join public.history_import_records h on h.lead_id=l.id
    union select s.key,a.record_id from subjects s join public.history_import_associations a on a.student_id=s.student_id
    union select ref.key,l.source_record_id from lead_refs ref join public.leads l on l.id=ref.id where l.source_record_id is not null
    union select ref.key,c.source_record_id from lead_refs ref join public.lead_communications c on c.lead_id=ref.id where c.source_record_id is not null
    union select s.key,r.source_record_id from subjects s join public.activity_registrations r on r.student_id=s.student_id where r.source_record_id is not null
    union select ref.key,r.source_record_id from lead_refs ref join public.activity_registrations r on r.lead_id=ref.id where r.source_record_id is not null
    union select s.key,a.source_record_id from subjects s join public.assessment_results a on a.student_id=s.student_id where a.source_record_id is not null
    union select ref.key,a.source_record_id from lead_refs ref join public.assessment_results a on a.lead_id=ref.id where a.source_record_id is not null
    union select s.key,e.source_record_id from subjects s join public.course_enrollments e on e.student_id=s.student_id where e.source_record_id is not null
  ),
  registration_refs as materialized (
    select s.key,r.id from subjects s join public.activity_registrations r on r.student_id=s.student_id
    union select ref.key,r.id from lead_refs ref join public.activity_registrations r on r.lead_id=ref.id
    union select ref.key,r.id from source_refs ref join public.activity_registrations r on r.source_record_id=ref.id
    union select s.key,a.activity_registration_id from subjects s join public.assessment_results a on a.student_id=s.student_id
    union select ref.key,a.activity_registration_id from lead_refs ref join public.assessment_results a on a.lead_id=ref.id
    union select ref.key,a.activity_registration_id from source_refs ref join public.assessment_results a on a.source_record_id=ref.id
  ),
  -- 完成的测评按测评日期取最近一次；空记录和未到场不算完成。
  latest_assessment as (
    select distinct on(x.key) x.* from (
      select ref.key,a.id,a.score,a.assessment_band,a.assessed_by,a.updated_at,a.source_record_id,r.id as registration_id,
        coalesce(a.assessed_on,(coalesce(r.assessment_completed_at,a.result_finalized_at) at time zone zone)::date,
          act.occurred_on,(act.scheduled_at at time zone zone)::date) as assessed_on,
        nullif(substring(a.strengths from '(?:^|[\r\n])学习力测评等级：([^\r\n]+)'),'') as learning_band
      from registration_refs ref join public.business_activity_registrations r on r.id=ref.id
        join public.business_assessment_results a on a.activity_registration_id=r.id
        join public.business_activities act on act.id=r.activity_id and act.deleted_at is null
      where public.student_assessment_is_complete(r.status,r.assessment_completed_at,a.result_finalized_at,
        a.result_source,a.score,a.assessment_band,a.strengths,
        concat_ws(E'\n',a.strengths,a.focus_areas,a.parent_concerns,a.teacher_recommendation,a.teacher_observation))
    ) x order by x.key,x.assessed_on desc nulls last,x.updated_at desc,x.id
  ),
  -- 来源中的学服、授课老师与班型；同一来源行有多个版本时按快照日期取最新。
  sources as materialized (
    select ref.key,h.id,h.record_data->>'tableName' as table_name,h.source_snapshot_date as snapshot,f.fields
    from source_refs ref join public.history_import_records h on h.id=ref.id
    cross join lateral (select jsonb_object_agg(c->>'fieldName',btrim(c->>'text')) as fields from jsonb_array_elements(h.record_data->'cells') c
      where c->>'fieldName' in ('报名服务老师','学服老师','确认人员','授课学科老师','学科老师','班型') and nullif(btrim(c->>'text'),'') is not null) f
    where h.source_data->>'format'='feishu-base' and f.fields is not null
  ),
  source_owner as (
    select distinct on(x.key) x.key,coalesce(x.fields->>'报名服务老师',x.fields->>'学服老师',x.fields->>'确认人员') as name
    from sources x join subjects s on s.key=x.key left join recent_contact c on c.key=x.key left join latest_assessment la on la.key=x.key
    where coalesce(x.fields->>'报名服务老师',x.fields->>'学服老师',x.fields->>'确认人员') is not null
    order by x.key,(s.stage='awaiting_renewal' and x.table_name='2026秋季在读学员表格') desc,
      (s.stage='awaiting_assessment' and c.source_record_id=x.id) desc,(s.stage<>'awaiting_assessment' and la.source_record_id=x.id) desc,
      x.snapshot desc nulls last,x.id
  ),
  source_teacher as (
    select distinct on(x.key) x.key,coalesce(x.fields->>'授课学科老师',x.fields->>'学科老师') as name
    from sources x join subjects s on s.key=x.key left join recent_contact c on c.key=x.key left join latest_assessment la on la.key=x.key
    where coalesce(x.fields->>'授课学科老师',x.fields->>'学科老师') is not null
    order by x.key,(s.stage='awaiting_renewal' and x.table_name='2026秋季在读学员表格') desc,
      (s.stage='awaiting_assessment' and c.source_record_id=x.id) desc,(s.stage<>'awaiting_assessment' and la.source_record_id=x.id) desc,
      x.snapshot desc nulls last,x.id
  ),
  source_class_band as (
    select distinct on(x.key) x.key,x.fields->>'班型' as band from sources x
    where x.table_name='2026秋季在读学员表格' and x.fields?'班型' order by x.key,x.snapshot desc nulls last,x.id
  ),
  -- 在读班级提供任课老师、学服与实际班型。
  class_facts as materialized (
    select s.key,
      string_agg(distinct p.display_name,'、' order by p.display_name) filter(where a.responsibility='primary_teacher') as teacher_name,
      string_agg(distinct p.display_name,'、' order by p.display_name) filter(where a.responsibility='learning_support') as owner_name,
      string_agg(distinct (regexp_match(c.name,'(?:春季|暑期|暑假|秋季|寒假)(X[+＋]|G[+＋]|A[+＋]?|S|C|培优|基础)(?:[|｜班]|$)'))[1],'、') as class_band
    from subjects s join public.enrollments e on e.student_id=s.student_id join public.classrooms c on c.id=e.classroom_id
      left join public.school_terms t on t.id=c.term_id
      left join public.classroom_staff_assignments a on a.classroom_id=c.id
      left join public.profiles p on p.id=a.user_id
    where e.status='active' and e.left_at is null and c.archived_at is null and c.trashed_at is null and (t.ends_on is null or t.ends_on>=today)
    group by s.key
  ),
  candidates as (
    select s.key,count(distinct h.id)::integer as n
    from subjects s join public.history_import_identity_candidates ic on ic.student_id=s.student_id
      join public.history_import_records h on h.id=ic.record_id and h.source_data->>'format'='feishu-base'
    where not exists(select 1 from source_refs ref where ref.key=s.key and ref.id=h.id)
      and exists(select 1 from public.business_assessment_results a join public.business_activity_registrations r on r.id=a.activity_registration_id
        where a.source_record_id=h.id and public.student_assessment_is_complete(r.status,r.assessment_completed_at,a.result_finalized_at,
          a.result_source,a.score,a.assessment_band,a.strengths,
          concat_ws(E'\n',a.strengths,a.focus_areas,a.parent_concerns,a.teacher_recommendation,a.teacher_observation)))
    group by s.key
  ),
  inferred as (
    select ref.key,jsonb_agg(distinct a.record_id) as ids from source_refs ref
      join public.history_import_associations a on a.record_id=ref.id and a.match_state='inferred' group by ref.key
  ),
  enrollment_facts as materialized (select * from unnest(p_enrollments)),
  enrollment as (
    select distinct on(x.key) x.key,x.course_id,x.term_id,c.title,t.name as term_name
    from (select s.key,e.* from subjects s join enrollment_facts e on e.subject_key=s.key
      union all select ref.key,e.* from source_refs ref join enrollment_facts e on e.source_record_id=ref.id) x
      left join public.courses c on c.id=x.course_id left join public.school_terms t on t.id=x.term_id
    order by x.key,(x.status='active') desc,x.confirmed_at desc nulls last,x.id
  ),
  opportunity as (
    select distinct on(x.key) x.key,x.course_id,x.term_id,c.title,t.name as term_name
    from (select s.key,o.id,o.course_id,o.term_id,o.updated_at from subjects s join public.business_course_opportunities o on o.student_id=s.student_id
      union all select ref.key,o.id,o.course_id,o.term_id,o.updated_at from lead_refs ref join public.business_course_opportunities o on o.lead_id=ref.id) x
      left join public.courses c on c.id=x.course_id left join public.school_terms t on t.id=x.term_id
    order by x.key,x.updated_at desc,x.id
  ),
  invitation as (
    select distinct on(s.key) s.key,i.* from subjects s join public.lead_invitation_threads i on i.lead_id=s.lead_id
    where view_followup and i.state not in ('completed','cancelled') order by s.key,i.updated_at desc,i.id
  ),
  -- 只有日期的来源沟通按当天参与排序，显示时保留原日期。
  notes as (select s.key,f.id,f.content,f.created_at as sort_at,to_jsonb(f.created_at)#>>'{}' as occurred_at,1 as priority,null::text as contact_order
      from public.business_student_follow_ups f join subjects s on s.student_id=f.student_id where view_followup
    union all select key,id,note,sort_at,at_text,0,contact_order from contacts),
  recent_note as (select distinct on(key) key,content,occurred_at from notes where nullif(btrim(content),'') is not null
    order by key,sort_at desc nulls last,priority desc,contact_order desc nulls last,id),
  reminders as (select ref.key,min(a.due_at) as due_at from public.lead_next_actions a join lead_refs ref on ref.id=a.lead_id
    where a.status='open' and a.kind<>'initial_contact' group by ref.key),
  row_facts as (
    select s.*,st.id as st_id,st.name as st_name,st.parent_phone,st.phone as st_phone,st.grade,st.assigned_to,st.next_follow_up_at,
      l.id as l_id,l.provisional_student_name,l.phone as l_phone,l.grade_hint,l.grade_text,l.owner_id,l.status as lead_status,
      p.display_name as owner_profile,cf.teacher_name as class_teacher,cf.owner_name as class_owner,cf.class_band,
      so.name as source_owner,stt.name as source_teacher,scb.band as source_band,assessor.display_name as assessor_name,
      la.id as assessment_id,la.score,la.assessment_band,la.assessed_on,la.registration_id,la.learning_band,
      lc.assessed_on as life_assessed_on,lc.assessment_band as life_band,lc.last_period_label,
      lc.wechat as life_wechat,lc.interest as life_interest,lc.last_visit_on as life_visit_on,lc.status as life_status,
      n.content as note,n.occurred_at as note_at,a.due_at,e.facts,cand.n as candidate_count,inf.ids as inferred_ids,
      en.course_id as en_course,en.term_id as en_term,en.title as en_title,en.term_name as en_term_name,
      op.course_id as op_course,op.term_id as op_term,op.title as op_title,op.term_name as op_term_name,
      case when inv.id is not null then to_jsonb(inv) end as inv
    from subjects s left join public.students st on st.id=s.student_id left join public.leads l on l.id=s.lead_id
    left join public.profiles p on p.id=coalesce(st.assigned_to,l.owner_id)
    left join class_facts cf on cf.key=s.key left join source_owner so on so.key=s.key left join source_teacher stt on stt.key=s.key
    left join source_class_band scb on scb.key=s.key left join latest_assessment la on la.key=s.key
    left join public.profiles assessor on assessor.id=la.assessed_by
    left join life lc on lc.subject_key=s.key left join recent_note n on n.key=s.key left join reminders a on a.key=s.key
    left join evidence e on e.key=s.key left join candidates cand on cand.key=s.key left join inferred inf on inf.key=s.key
    left join enrollment en on en.key=s.key left join opportunity op on op.key=s.key left join invitation inv on inv.key=s.key
  ),
  shaped as (
    select r.*,coalesce(case when r.stage='awaiting_renewal' then r.class_teacher end,r.source_teacher,r.assessor_name) as teacher,
      case when r.assessment_id is null and r.stage='awaiting_renewal' then coalesce(r.class_band,r.source_band) end as renewal_band
    from row_facts r
  ),
  teacher_ids as (
    select x.key,(array_agg(p.id))[1] as id from shaped x join public.profiles p on p.display_name=x.teacher and p.is_active and p.role in ('staff','admin')
    group by x.key having count(*)=1
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'statusEvidence',case when view_followup then coalesce(r.facts,'[]'::jsonb) else '[]'::jsonb end,
      -- 微信、意向、到访图标与小状态同取阶段表；证据只用于点开后查看原文。
      'lifecycle',case when view_followup then jsonb_build_object('wechat',r.life_wechat,'interest',r.life_interest,'visitOn',r.life_visit_on,'band',public.student_learning_band(r.life_band),
        'visit',case when r.life_visit_on is not null or r.life_status='visited_untested' then 'arrived' when r.life_status in ('promised','booked','no_show') then 'promised' end) end,
      'key',r.key,'studentId',r.student_id,'leadId',r.lead_id,'name',coalesce(r.st_name,r.provisional_student_name),
      'phone',coalesce(nullif(r.parent_phone,''),nullif(r.st_phone,''),r.l_phone,''),'grade',coalesce(r.grade,r.grade_hint),'gradeText',coalesce(r.grade_text,''),
      'ownerId',coalesce(r.assigned_to,r.owner_id),'ownerName',coalesce(r.owner_profile,r.class_owner,r.source_owner,''),
      'teacherName',coalesce(r.teacher,''),'teacherId',t.id,
      'stage',r.stage,'detail',r.detail,
      'note',case when view_followup then coalesce(r.note,'') else '' end,
      'lastContactAt',case when view_followup then r.note_at end,
      'nextContactAt',case when view_followup then least(r.next_follow_up_at,r.due_at) end,
      'score',r.score,
      -- 测评记录优先；续报学生没有测评记录时用在读班型；其余用阶段表里来源登记的测评等级与日期。
      'assessmentBand',case when r.assessment_id is not null then public.student_learning_band(r.assessment_band)
        when r.renewal_band is not null then public.student_learning_band(r.renewal_band) else public.student_learning_band(r.life_band) end,
      'assessmentAt',case when r.assessment_id is not null then r.assessed_on when r.renewal_band is null then r.life_assessed_on end,
      'assessmentSource',case when r.assessment_id is not null then 'assessment' when r.renewal_band is not null then 'class_band'
        when r.life_assessed_on is not null or r.life_band is not null then 'assessment' end,
      'assessmentRecordId',r.assessment_id,
      'learningBand',case when r.learning_band='未达A' then 'X+' else r.learning_band end,
      'classBandLabel',coalesce(r.renewal_band,''),
      'assessmentCandidateCount',coalesce(r.candidate_count,0),'inferredSourceIds',coalesce(r.inferred_ids,'[]'::jsonb),
      'registrationId',r.registration_id,
      'courseTitle',coalesce(r.en_title,r.op_title,''),'termName',coalesce(r.en_term_name,r.op_term_name,nullif(r.last_period_label,''),''),
      'courseId',coalesce(r.en_course,r.op_course),'termId',coalesce(r.en_term,r.op_term),'createdAt',r.created_at,
      'canWrite',write_followup and ((r.student_id is not null and case when view_all then true else public.can_access_student(r.student_id,actor) end)
        or (r.l_id is not null and case when view_all or r.owner_id=actor then true else public.can_edit_school_lead(r.l_id,actor) end)),
      'canContact',write_followup and ((r.l_id is not null and r.lead_status not in ('invalid','converted') and case when view_all or r.owner_id=actor then true else public.can_edit_school_lead(r.l_id,actor) end)
        or (r.l_id is null and r.st_id is not null and case when view_all then true else public.can_access_student(r.st_id,actor) end)),
      'invitation',case when r.inv is not null then jsonb_build_object(
        'id',r.inv->'id','leadId',r.inv->'lead_id','kind',r.inv->'kind','state',r.inv->'state',
        'assessmentSlotId',r.inv->'assessment_slot_id','activityId',r.inv->'activity_id','assessorId',r.inv->'assessor_id','parentTimeOptions',r.inv->'parent_time_options',
        'assessorTimeOptions',r.inv->'assessor_time_options','scheduledAt',r.inv->'scheduled_at',
        'locationText',r.inv->'location_text','nextContactAt',least(r.next_follow_up_at,r.due_at),'updatedAt',r.inv->'updated_at') end)
    order by r.created_at desc,r.key),'[]'::jsonb) into result
    from shaped r left join teacher_ids t on t.key=r.key;
  result:=public.school_apply_current_grades(result);
  return (
    with subjects as materialized (
      select coalesce(jsonb_agg(jsonb_build_object('key',v->>'key','student_id',v->>'studentId','lead_id',v->>'leadId')),'[]'::jsonb) as payload
      from jsonb_array_elements(result) v
    ), summaries as materialized (
      select s.* from subjects x cross join lateral public.school_record_communication_summaries(x.payload) s
    ) select coalesce(jsonb_agg(public.school_list_apply_collaboration(r.value,c.projection)
        ||case when s.summary is not null then jsonb_build_object('communication',s.summary) else '{}'::jsonb end order by r.ordinal),'[]'::jsonb)
      from jsonb_array_elements(result) with ordinality r(value,ordinal)
      cross join subjects x
      join public.school_list_collaboration(x.payload,actor) c on c.key=r.value->>'key'
      left join summaries s on s.key=r.value->>'key'
  );
end;
$function$;

-- 单人读取与名单同源：阶段与小状态取阶段表，明细由同一批量函数生成。
create or replace function public.read_student_record_with_context(p_student_id uuid, p_lead_id uuid, p_enrollments business_course_enrollment_subjects[], p_read_context jsonb)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare actor uuid:=auth.uid(); v_student uuid:=p_student_id; v_lead uuid:=p_lead_id; lead_student uuid; created timestamptz; stage_row record;
  today date:=(now() at time zone public.get_organization_timezone_v2())::date;
begin
  if actor is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.is_staff(actor) then raise exception 'FORBIDDEN'; end if;
  if v_lead is not null then
    select l.student_id,l.created_at into lead_student,created from public.leads l where l.id=v_lead;
    if not found then raise exception 'NOT_FOUND'; end if;
    if v_student is not null and lead_student is distinct from v_student then raise exception 'SUBJECT_MISMATCH'; end if;
    if not (public.has_perm(actor,'followup.view') and public.can_view_school_lead(v_lead,actor)) then raise exception 'FORBIDDEN_SCOPE'; end if;
    v_student:=coalesce(v_student,lead_student);
  end if;
  if v_student is not null then
    select s.created_at into created from public.students s where s.id=v_student and s.deleted_at is null;
    if not found or not public.can_view_school_student(v_student,actor) then raise exception 'FORBIDDEN_SCOPE'; end if;
    if v_lead is null and public.has_perm(actor,'followup.view') then
      select l.id into v_lead from public.leads l where l.student_id=v_student and public.can_view_school_lead(l.id,actor)
        order by (l.status not in ('invalid','converted')) desc,l.created_at desc,l.id limit 1;
    end if;
  elsif v_lead is null then raise exception 'NOT_FOUND';
  end if;
  select case when c.expires_on<=today then 'former_student' else c.stage end as stage,
    case when c.expires_on<=today then coalesce(c.expired_status,'ended') else c.status end as status
    into stage_row from public.school_subject_lifecycle c where c.subject_key=coalesce('student:'||v_student,'lead:'||v_lead);
  return public.student_record_list_rows(jsonb_build_array(jsonb_build_object('key',coalesce('student:'||v_student,'lead:'||v_lead),
    'student_id',v_student,'lead_id',v_lead,'stage',coalesce(stage_row.stage,'awaiting_first_contact'),
    'detail',coalesce(stage_row.status,'not_contacted'),'created_at',created)),p_enrollments)->0;
end;
$function$;


-- 逐行推算阶段的旧读取已由批量读取取代。
drop function if exists public.student_record_row_with_context(uuid, uuid, public.business_course_enrollment_subjects[], jsonb);
drop function if exists public.student_stage_learning_background(uuid, uuid, text, text);
drop function if exists public.school_communication_workbench_page(text,text,text,text,text,integer,integer,text,text,text[],uuid,jsonb,text,jsonb,boolean,boolean);

-- 名单“相关情况”：来源行原有字段、来源渠道、扫码／小地推登记信息、原学服与班序；只为显示或筛选需要的行生成。
create or replace function public.school_worklist_context(p_context jsonb, p_kind text, p_group text, p_subgroup text, p_channel text, p_imported jsonb)
 returns jsonb
 language sql
 immutable
 set search_path to 'public', 'pg_temp'
as $function$
  select (select coalesce(jsonb_agg(case when c->>'label' in ('获取人员','获取人员兼职','推广兼职','确认人员','跟进人员','跟进人') and c->>'value' in ('章润','王晓妹','邱玮','汪婷婷') then c||jsonb_build_object('label','来源学服') else c end),'[]'::jsonb)
      from jsonb_array_elements(coalesce(p_context,'[]'::jsonb)) c)
    ||jsonb_build_array(jsonb_build_object('label','来源渠道','value',p_channel))
    ||case when p_imported is not null then (select coalesce(jsonb_agg(jsonb_build_object('label',label,'value',value)),'[]'::jsonb) from
      (values ('来源批次',p_imported->>'batch_label'),('获取地点',p_imported->>'location_text'),('获取方式',p_imported->>'acquisition_method'),('推广兼职',p_imported->>'promoter'),
        ('来源备注',p_imported->>'remark'),('获取信息',p_imported->>'raw_interest_text'),('微信昵称',p_imported->>'wechat_nickname'),('来源年级',p_imported->>'raw_grade_text')) c(label,value)
      where nullif(btrim(value),'') is not null) else '[]'::jsonb end
    ||case when p_kind='acquisition' and p_subgroup not in ('','未分配','章润','王晓妹','邱玮','汪婷婷') then jsonb_build_array(jsonb_build_object('label','来源经办人','value',p_subgroup)) else '[]'::jsonb end
    ||case when p_kind in ('service','assessment') then jsonb_build_array(jsonb_build_object('label',case when p_kind='service' then '原授课老师' else '原学服老师' end,'value',p_group)) else '[]'::jsonb end
    ||case when p_kind='service' and p_subgroup<>'' then jsonb_build_array(jsonb_build_object('label','原班序','value',p_subgroup)) else '[]'::jsonb end
$function$;
revoke all on function public.school_worklist_context(jsonb,text,text,text,text,jsonb) from public, anon;

-- 沟通名单：阶段、小状态、月份均取阶段表；月份带年份，已停课按停课月份或报名月份查看。
create or replace function public.school_communication_workbench_page(p_stage text, p_scope text, p_search text, p_group text, p_marker text, p_page integer, p_page_size integer, p_period_field text, p_period text, p_subjects text[], p_batch uuid, p_query jsonb, p_locale text, p_labels jsonb, p_include_facets boolean, p_facets_only boolean, p_interest text, p_channel text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
declare
  actor uuid:=auth.uid(); facts public.business_course_enrollment_subjects[]; result jsonb; period_field text; zone text; item record; kind text; sort_field text; direction text; needs_fields boolean;
  enum_fields text[]:=array['grade','detail','owner','group','scope','sourceReview','sourceArrangement'];
  date_fields text[]:=array['lastContactAt','nextContactAt'];
  text_fields text[]:=array['name','phone','note','context']; allowed text[];
begin
  if actor is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.is_staff(actor) or not public.has_perm(actor,'followup.view') then raise exception 'FORBIDDEN'; end if;
  if p_scope='default' then
    p_scope:=case when public.is_admin(actor) then 'all'
      when exists(select 1 from public.school_group_leader_scope(actor)) then 'group' else 'mine' end;
  end if;
  if p_interest is null or p_interest not in ('','A') or p_channel is null or length(p_channel)>80 then raise exception 'VALIDATION'; end if;
  -- 来源渠道名称去掉“历史”前缀后，记住的旧筛选值继续可用。
  if p_channel in ('历史获客表','历史测评表','历史服务表') then p_channel:=substr(p_channel,3); end if;
  if p_stage is null or p_stage not in ('awaiting_first_contact','awaiting_assessment','awaiting_enrollment','former_student')
    or p_scope is null or p_scope not in ('mine','all','group','unassigned')
    or p_search is null or length(p_search)>80 or p_group is null or length(p_group)>320
    or p_marker is null or length(p_marker)>80 or p_page is null or p_page not between 1 and 1000000
    or p_page_size is null or p_page_size not in (20,50,100)
    or p_period_field is null or p_period_field not in ('','acquired','followed','confirmed','arrived','enrolled','ended')
    or p_period is null or (p_period not in ('','all','unknown') and (length(p_period)>400 or p_period !~ '^(unknown|[0-9]{4}年([1-9]|1[0-2])月)(,(unknown|[0-9]{4}年([1-9]|1[0-2])月)){0,35}$'))
    or (p_subjects is not null and (cardinality(p_subjects)>200 or exists(select 1 from unnest(p_subjects) k where k !~ '^(student|lead):[0-9a-fA-F-]{36}$')))
    then raise exception 'VALIDATION'; end if;
  period_field:=case when p_period_field<>'' then p_period_field when p_stage='former_student' then 'ended'
    when p_stage='awaiting_enrollment' then 'arrived' else 'acquired' end;
  if (p_stage in ('awaiting_first_contact','awaiting_assessment') and period_field not in ('acquired','followed','confirmed'))
    or (p_stage='awaiting_enrollment' and period_field not in ('arrived','confirmed','enrolled'))
    or (p_stage='former_student' and period_field not in ('ended','enrolled')) then raise exception 'VALIDATION'; end if;
  zone:=public.get_organization_timezone_v2();
  allowed:=enum_fields||date_fields||text_fields;
  if p_locale is null or p_locale not in ('zh','en') or p_include_facets is null or p_facets_only is null or p_query is null
    or jsonb_typeof(p_query)<>'object' or p_query->>'version' is distinct from '2'
    or jsonb_typeof(p_query->'filters') is distinct from 'object' or pg_column_size(p_query)>32768
    or p_labels is null or jsonb_typeof(p_labels)<>'object' or pg_column_size(p_labels)>32768 then raise exception 'VALIDATION'; end if;
  for item in select * from jsonb_each(p_query->'filters') loop
    kind:=item.value->>'kind';
    if not item.key=any(allowed) or jsonb_typeof(item.value)<>'object' or kind is null then raise exception 'VALIDATION'; end if;
    if kind='presence' then
      if item.value->>'value' is null or item.value->>'value' not in ('present','missing') then raise exception 'VALIDATION'; end if;
    elsif kind='enum' and item.key=any(enum_fields) then
      if jsonb_typeof(item.value->'values') is distinct from 'array' then raise exception 'VALIDATION'; end if;
      if jsonb_array_length(item.value->'values') not between 1 and 100 or exists(select 1 from jsonb_array_elements(item.value->'values') v
        where jsonb_typeof(v)<>'string' or length(v#>>'{}') not between 1 and 160) then raise exception 'VALIDATION'; end if;
    elsif kind='text' and item.key=any(text_fields) then
      if jsonb_typeof(item.value->'query') is distinct from 'string' or length(item.value->>'query')>160 then raise exception 'VALIDATION'; end if;
    elsif kind='date' and item.key=any(date_fields) then
      if coalesce(item.value->>'from','')!~'^\d{4}-\d{2}-\d{2}$' or coalesce(item.value->>'to','')!~'^\d{4}-\d{2}-\d{2}$'
        or item.value->>'from'>item.value->>'to' then raise exception 'VALIDATION'; end if;
      begin perform (item.value->>'from')::date; perform (item.value->>'to')::date;
        exception when invalid_datetime_format or datetime_field_overflow then raise exception 'VALIDATION'; end;
    else raise exception 'VALIDATION'; end if;
  end loop;
  sort_field:=p_query->'sort'->>'field'; direction:=p_query->'sort'->>'direction';
  if p_query->'sort' is distinct from 'null'::jsonb and p_query->'sort' is not null and
    (sort_field is null or not sort_field=any(allowed) or sort_field in ('note','context','scope','sourceReview','sourceArrangement')
      or direction is null or direction not in ('asc','desc')) then raise exception 'VALIDATION'; end if;
  needs_fields:=p_include_facets or p_query->'filters'<>'{}'::jsonb or sort_field is not null;
  select coalesce(array_agg(e),'{}'::public.business_course_enrollment_subjects[]) into facts
    from public.business_course_enrollment_subjects e;
  with visible as materialized (
    select v.* from public.student_record_index_for_population(p_scope,p_search,facts,false) v where p_subjects is null or v.key=any(p_subjects)
  ), imported as materialized (
    select distinct on(coalesce('student:'||l.student_id,'lead:'||r.lead_id)) r.*,
      coalesce('student:'||l.student_id,'lead:'||r.lead_id) as subject_key
    from public.lead_source_records r join public.leads l on l.id=r.lead_id
    where r.source_system in ('xiaoditui','mathin-miniapp') and exists(select 1 from visible v where v.key=coalesce('student:'||l.student_id,'lead:'||r.lead_id))
    order by coalesce('student:'||l.student_id,'lead:'||r.lead_id),r.created_at desc,r.id
  ), worklist as materialized (
    select w.logical_key,w.kind,w.group_label,w.subgroup_label,w.group_rank,w.source_rank,
      w.markers,w.periods,w.period_defaults,coalesce('student:'||coalesce(l.student_id,w.student_id),'lead:'||w.lead_id) as subject_key,
      case when p_stage='awaiting_first_contact' then intake.completed_at end as intake_at,
      w.source_record_id,case when w.miniapp_intake_id is not null then '微信扫码' when w.kind='service' then '服务表'
        when w.kind='assessment' then '测评表' else '获客表' end as channel
    from public.school_source_worklist_entries w left join public.leads l on l.id=w.lead_id
    left join public.miniapp_intakes intake on intake.id=w.miniapp_intake_id and intake.intake_kind='family'
    union all
    select r.source_system||':'||r.lead_id,'acquisition','未分组',coalesce(r.promoter,''),-2,r.row_no,
      '[]'::jsonb,jsonb_build_object('acquired',case when r.submitted_at is not null then extract(month from r.submitted_at at time zone zone)::integer||'月' end),
      '{}'::jsonb,
      r.subject_key,case when p_stage='awaiting_first_contact' then r.created_at end,null::text,case when r.source_system='mathin-miniapp' then '微信扫码' else '小地推' end
    from imported r where not exists(select 1 from public.school_source_worklist_entries w left join public.leads l on l.id=w.lead_id
      where coalesce('student:'||coalesce(l.student_id,w.student_id),'lead:'||w.lead_id)=r.subject_key)
  ), source_entries as materialized (
    select distinct on(v.key) v.*,coalesce(w.logical_key,v.key) as logical_key,w.kind,
      coalesce(w.group_label,'未分组') as group_label,coalesce(w.subgroup_label,'') as subgroup_label,
      case when w.intake_at is not null then -1 else coalesce(w.group_rank,1000000) end as group_rank,
      coalesce(w.source_rank,1000000) as source_rank,w.intake_at,
      coalesce(w.markers,'[]'::jsonb) as markers,
      coalesce(w.periods,'{}'::jsonb) as periods,coalesce(w.period_defaults,'{}'::jsonb) as period_defaults,
      coalesce(w.group_label,'未分组')||' / '||coalesce(w.subgroup_label,'') as group_key,w.source_record_id,coalesce(w.channel,'手动登记') as channel,
      case period_field when 'acquired' then lc.acquired_on when 'followed' then lc.followed_on when 'confirmed' then lc.confirmed_on
        when 'arrived' then coalesce(lc.arrived_on,lc.assessed_on) when 'enrolled' then lc.enrolled_on when 'ended' then lc.enrolled_through end as period_on
    from visible v left join worklist w on w.subject_key=v.key left join public.school_subject_lifecycle lc on lc.subject_key=v.key
    where v.stage=p_stage and (p_batch is null or exists(select 1 from public.lead_source_records r join public.leads l on l.id=r.lead_id
      where r.batch_id=p_batch and coalesce('student:'||l.student_id,'lead:'||l.id)=v.key))
    order by v.key,
      case when w.kind=case v.stage when 'awaiting_first_contact' then 'acquisition' when 'awaiting_assessment' then 'acquisition' when 'awaiting_enrollment' then 'assessment' else 'service' end then 0 else 1 end,
      w.group_rank,w.source_rank,w.logical_key
  ), business_groups as materialized (
    select b.id,b.name,case b.source_code when '1' then 1 when '2' then 2 when '3' then 3 else 1000000+b.sort_order end as rank
    from public.school_business_groups b where b.archived_at is null and b.kind='group'
  ), subject_groups as materialized (
    select coalesce('student:'||sg.student_id,'student:'||gl.student_id,'lead:'||sg.lead_id) as key,b.name,b.rank
    from public.school_subject_groups sg join business_groups b on b.id=sg.group_id left join public.leads gl on gl.id=sg.lead_id
  ), assigned_groups as materialized (
    select distinct on(e.key) e.key,g.name,g.rank from source_entries e join subject_groups g on g.key=e.key
    order by e.key,case when g.name=e.group_label then 0 else 1 end,g.rank,g.name
  ), acquisition_groups as materialized (
    select distinct on(w.subject_key) w.subject_key,b.name,b.rank from worklist w join business_groups b on b.name=w.group_label
    where w.kind='acquisition' order by w.subject_key,w.group_rank,w.logical_key
  ), source_support as materialized (
    select w.subject_key,case when h.source_format='feishu-base' then (h.school_filter_values).support_name else public.school_worklist_support_name(h.record_data) end as name
    from worklist w join public.history_import_records h on h.id=w.source_record_id
    where exists(select 1 from source_entries e where e.key=w.subject_key)
  ), source_owners as materialized (
    select subject_key,case when count(distinct name)=1 then min(name) end as name
    from source_support where nullif(name,'') is not null group by subject_key
  ), entry_lookups as materialized (
    select (select jsonb_object_agg(g.key,jsonb_build_object('name',g.name,'rank',g.rank)) from assigned_groups g where g.key is not null) as assigned,
      (select jsonb_object_agg(g.subject_key,jsonb_build_object('name',g.name,'rank',g.rank)) from acquisition_groups g where g.subject_key is not null) as acquisition,
      (select jsonb_object_agg(o.subject_key,o.name) from source_owners o where o.subject_key is not null) as owners
  ), entries as materialized (
    select e.student_id,e.lead_id,e.key,e.stage,e.detail,e.created_at,e.logical_key,e.kind,e.period_on,
      e.group_label as source_group,e.subgroup_label as source_subgroup,
      coalesce((lookup.assigned->e.key->>'name'),(lookup.acquisition->e.key->>'name'),'未分组') as group_label,case when p_stage='awaiting_first_contact' then '' else coalesce(nullif(owner.display_name,''),(lookup.owners->>e.key),'学服待核对') end as subgroup_label,
      coalesce((lookup.assigned->e.key->>'rank')::integer,(lookup.acquisition->e.key->>'rank')::integer,1000000) as group_rank,e.source_rank,e.intake_at,e.markers,e.periods,e.period_defaults,
      coalesce((lookup.assigned->e.key->>'name'),(lookup.acquisition->e.key->>'name'),'未分组')||' / '||case when p_stage='awaiting_first_contact' then '' else coalesce(nullif(owner.display_name,''),(lookup.owners->>e.key),'学服待核对') end as group_key,
      coalesce(s.assigned_to,l.owner_id) as owner_id,coalesce(nullif(owner.display_name,''),(lookup.owners->>e.key),'') as owner_name,
      coalesce(case r.source_system when 'xiaoditui' then '小地推' when 'mathin-miniapp' then '微信扫码' end,e.channel) as channel,
      case when p_stage='awaiting_first_contact' and e.kind='service' and exists(select 1 from public.history_import_records h
        cross join lateral jsonb_array_elements(h.record_data->'cells') c where h.id=e.source_record_id
        and c->>'fieldName'='26秋报名模式' and btrim(c->>'text')='待报')
        then '旧服务表记为“26秋待报”，目前没有有效首联记录。请核对原学服、课程安排和联系电话，再补首联。' else '' end as attention
    from source_entries e left join public.students s on s.id=e.student_id left join public.leads l on l.id=e.lead_id
    left join imported r on r.subject_key=e.key
    left join public.profiles owner on owner.id=coalesce(s.assigned_to,l.owner_id)
    cross join entry_lookups lookup
  ), interest_subjects as materialized (
    select e.key,e.student_id,e.lead_id from entries e where p_interest<>'' and (p_channel='' or e.channel=p_channel)
  ), interest_leads as materialized (
    select s.key,l.id from interest_subjects s join public.leads l on l.id=s.lead_id or l.student_id=s.student_id
    where public.can_view_school_lead(l.id,actor)
  ), interest_contacts as materialized (
    select ref.key,c.id,
      case when r.effective_patch?'occurredAt' then r.effective_patch->>'occurredAt' else coalesce(c.occurred_on::text,c.occurred_at::text) end as effective_date,
      case when r.effective_patch?'interestLevel' then coalesce(r.effective_patch->>'interestLevel','unknown') else nullif(c.interest_level,'') end as value
    from interest_leads ref join public.business_lead_communications c on c.lead_id=ref.id
    left join lateral (select effective_patch from public.communication_record_revisions r
      where r.source='contact' and r.event_id=c.id order by revision_no desc limit 1) r on true
    where c.source_record_id is null or r.effective_patch is not null
  ), interest_facts as materialized (
    select v.key,v.fact||jsonb_build_object('sourceId',v.source_id,'recordId',v.source_id) as fact
    from public.school_source_status_facts_for_subjects(array(select s.key from interest_subjects s)) v where v.fact->>'type'='interest'
    union all
    select c.key,jsonb_build_object('type','interest','value',c.value,'field','沟通登记 · 意向','priority',400,'certainty','confirmed',
      'date',c.effective_date,'recordId',c.id::text) from interest_contacts c where c.value is not null
  ), interest_evidence as materialized (
    select f.key,public.school_worklist_interest(jsonb_agg(f.fact)) as interest from interest_facts f group by f.key
  ), task_entries as materialized (
    select e.*,coalesce(to_char(e.period_on,'YYYY"年"FMMM"月"'),'unknown') as period from entries e
    where (p_channel='' or e.channel=p_channel) and (p_interest='' or exists(select 1 from interest_evidence i where i.key=e.key and i.interest=p_interest))
  ), period_totals as materialized (
    -- 近的月份在前，未填日期排最后。
    select period,count(distinct key)::integer as n,coalesce(max(extract(year from period_on)::integer*12+extract(month from period_on)::integer),-1) as rank
    from task_entries group by period
  ), choice as (
    select coalesce(nullif(p_period,''),'all') as period
  ), period_entries as materialized (
    select t.*,pt.rank as period_rank from task_entries t join period_totals pt using(period)
      where (select period from choice)='all' or t.period=any(string_to_array((select period from choice),','))
  ), group_choice as (
    select coalesce(nullif(p_group,''),'all') as label
  ), required_fields as materialized (
    select unnest(enum_fields||date_fields) as id where p_include_facets
    union select jsonb_object_keys(p_query->'filters') union select sort_field where sort_field is not null
  ), compact_subjects as materialized (
    select t.* from task_entries t where needs_fields and p_stage in ('awaiting_first_contact','awaiting_assessment')
  ), compact_payload as materialized (
    select coalesce(jsonb_agg(jsonb_build_object('key',key,'student_id',student_id,'lead_id',lead_id,'studentId',student_id,'leadId',lead_id)),'[]'::jsonb) as items from compact_subjects
  ), compact_collaboration as materialized (
    select c.* from public.school_list_collaboration((select items from compact_payload),actor) c
      where exists(select 1 from required_fields where id in ('group','scope'))
  ), compact_statuses as materialized (
    select s.* from public.school_source_statuses((select items from compact_payload)) s
      where exists(select 1 from required_fields where id in ('sourceReview','sourceArrangement'))
  ), field_payloads as materialized (
    select jsonb_build_object('key',t.key,'ownerId',coalesce(s.assigned_to,l.owner_id),'ownerName',coalesce(p.display_name,''))
      ||coalesce(c.projection,'{}'::jsonb)||coalesce(status.status,'{}'::jsonb) as row_data
    from compact_subjects t left join public.students s on s.id=t.student_id left join public.leads l on l.id=t.lead_id
      left join public.profiles p on p.id=coalesce(s.assigned_to,l.owner_id)
      left join compact_collaboration c using(key) left join compact_statuses status using(key)
    union all
    select f.row_data from public.student_list_query_facts(p_scope,p_search,'records',p_stage,
      coalesce((select jsonb_agg(jsonb_build_object('key',t.key)) from task_entries t where needs_fields and p_stage not in ('awaiting_first_contact','awaiting_assessment')),'[]'::jsonb)) f
      where needs_fields and f.row_data is not null
  ), contact_summaries as materialized (
    select c.* from public.school_record_communication_summaries(coalesce((
      select jsonb_agg(jsonb_build_object('key',t.key,'student_id',t.student_id,'lead_id',t.lead_id)) from task_entries t
      where exists(select 1 from required_fields where id in ('note','lastContactAt'))
    ),'[]'::jsonb)) c
  ), field_grades as materialized (
    select g.* from public.school_current_subject_grades(coalesce((select jsonb_agg(jsonb_build_object('key',t.key,'studentId',t.student_id,'leadId',t.lead_id))
      from task_entries t where exists(select 1 from required_fields where id='grade')),'[]'::jsonb),(now() at time zone zone)::date) g
  ), filter_context as materialized (
    select t.key,public.school_worklist_context(sw.context,t.kind,t.source_group,t.source_subgroup,t.channel,to_jsonb(r)) as context
    from task_entries t left join public.school_source_worklist_entries sw on sw.logical_key=t.logical_key
    left join imported r on r.subject_key=t.key where exists(select 1 from required_fields where id='context')
  ), field_rows as materialized (
    select t.key,(coalesce(f.row_data,'{}'::jsonb)||jsonb_build_object('detail',t.detail,'ownerId',t.owner_id,'ownerName',t.owner_name,
      'name',coalesce(s.name,l.provisional_student_name),'phone',coalesce(nullif(s.parent_phone,''),nullif(s.phone,''),l.phone,''),
      'grade',case when grade.value is not null then (grade.value->>'grade')::integer else coalesce(s.grade,l.grade_hint) end,'gradeText',coalesce(grade.value->>'gradeText',l.grade_text,''),
      'note',coalesce(c.summary->>'latestNote',''),
      'lastContactAt',c.summary->>'latestAt',
      'nextContactAt',least(s.next_follow_up_at,(select min(a.due_at) from public.lead_next_actions a
        where a.lead_id=t.lead_id and a.status='open' and a.kind<>'initial_contact')),
      'context',(select string_agg(c->>'value',E'\n') from jsonb_array_elements(fc.context) c))) as payload
      from task_entries t left join field_payloads f on f.row_data->>'key'=t.key
      left join public.students s on s.id=t.student_id left join public.leads l on l.id=t.lead_id
      left join contact_summaries c on c.key=t.key left join field_grades grade on grade.key=t.key left join filter_context fc on fc.key=t.key where needs_fields
  ), field_values as materialized (
    select r.key,(select coalesce(jsonb_object_agg(f.id,case
      when f.id='context' then public.student_list_field(jsonb_build_object('note',r.payload->>'context'),'note',p_labels,actor,zone)
      when f.id='nextContactAt' then public.student_list_field(jsonb_build_object('lastContactAt',r.payload->>'nextContactAt'),'lastContactAt',p_labels,actor,zone)
      else public.student_list_field(r.payload,f.id,p_labels,actor,zone) end),'{}'::jsonb) from required_fields f) as fields
    from field_rows r
  ), field_lookup as materialized (
    select jsonb_object_agg(f.key,f.fields) as items from field_values f where p_query->'filters'<>'{}'::jsonb or sort_field is not null
  ), filtered as materialized (
    select t.key,f.items->t.key->sort_field as sort_value from period_entries t cross join field_lookup f where ((select label from group_choice)='all' or group_label=(select label from group_choice) or group_key=(select label from group_choice))
      and not exists(select 1 from jsonb_each(p_query->'filters') filter where not public.student_list_field_matches((f.items->t.key)->filter.key,filter.value))
      and (p_marker='' or exists(select 1 from jsonb_array_elements(markers) m where m->>'key'=p_marker))
  ), totals as (select count(*)::integer as n from filtered),
  ordered as materialized (
    select t.*,row_number() over(order by
      case when sort_field is not null then coalesce((f.sort_value->>'sortMissing')::boolean,(f.sort_value->>'missing')::boolean,true) end,
      case when sort_field=any(date_fields) and direction='asc' then (f.sort_value->>'sort')::numeric end asc,
      case when sort_field=any(date_fields) and direction='desc' then (f.sort_value->>'sort')::numeric end desc,
      case when not sort_field=any(date_fields) and direction='asc' and p_locale='zh' then f.sort_value->>'sort' end collate public.student_list_sort_zh asc,
      case when not sort_field=any(date_fields) and direction='desc' and p_locale='zh' then f.sort_value->>'sort' end collate public.student_list_sort_zh desc,
      case when not sort_field=any(date_fields) and direction='asc' and p_locale='en' then f.sort_value->>'sort' end collate public.student_list_sort_en asc,
      case when not sort_field=any(date_fields) and direction='desc' and p_locale='en' then f.sort_value->>'sort' end collate public.student_list_sort_en desc,
      period_rank desc,group_rank,group_label,subgroup_label,intake_at desc nulls last,source_rank,logical_key) as ordinal from filtered f join period_entries t on t.key=f.key
  ), selected as materialized (
    select * from ordered where not p_facets_only order by ordinal
      offset (least(p_page,greatest(1,(select ceil(n::numeric/p_page_size)::integer from totals)))-1)*p_page_size limit p_page_size
  ), page_context as materialized (
    select s.key,coalesce(fc.context,public.school_worklist_context(sw.context,s.kind,s.source_group,s.source_subgroup,s.channel,to_jsonb(r))) as context
    from selected s left join filter_context fc on fc.key=s.key left join public.school_source_worklist_entries sw on sw.logical_key=s.logical_key
    left join imported r on r.subject_key=s.key
  ), page_grades as materialized (
    select g.* from field_grades g join selected s using(key)
    union all
    select g.* from public.school_current_subject_grades(coalesce((select jsonb_agg(jsonb_build_object('key',s.key,'studentId',s.student_id,'leadId',s.lead_id))
      from selected s where not exists(select 1 from field_grades f where f.key=s.key)),'[]'::jsonb),(now() at time zone zone)::date) g
  ), details as materialized (
    select r from jsonb_array_elements(case when p_facets_only then '[]'::jsonb else public.student_record_list_rows(
      coalesce((select jsonb_agg(jsonb_build_object('key',key,'student_id',student_id,'lead_id',lead_id,
        'stage',stage,'detail',detail,'created_at',created_at)) from selected),'[]'::jsonb),facts) end) r
  ) select jsonb_build_object(
    'rows',coalesce((select jsonb_agg(d.r||coalesce(grade.value-'code'-'basisYear','{}'::jsonb)||jsonb_build_object('ownerId',s.owner_id,'ownerName',s.owner_name,'worklist',jsonb_build_object(
      'id',s.logical_key,'kind',s.kind,'channel',s.channel,'attention',s.attention,'groupMode',case when p_stage='awaiting_first_contact' then 'lead' else 'support' end,'group',s.group_label,'subgroup',s.subgroup_label,'groupKey',s.group_key,
      'rank',s.source_rank,'markers',s.markers,'context',coalesce(pc.context,'[]'::jsonb),'period',s.period,'periods',s.periods))
      order by s.ordinal)
      from selected s join details d on d.r->>'key'=s.key left join page_grades grade on grade.key=s.key left join page_context pc on pc.key=s.key),'[]'::jsonb),
    'scope',p_scope,'channels',coalesce((select jsonb_agg(jsonb_build_object('key',channel,'count',n) order by channel) from (select channel,count(*) as n from entries group by channel) c),'[]'::jsonb),
    'count',(select n from totals),'page',least(p_page,greatest(1,(select ceil(n::numeric/p_page_size)::integer from totals))),
    'pageSize',p_page_size,'totalPages',greatest(1,(select ceil(n::numeric/p_page_size)::integer from totals)),
    'periodField',period_field,'period',(select period from choice),'group',(select label from group_choice),
    'periods',coalesce((select jsonb_agg(jsonb_build_object('key',period,'count',n) order by rank desc) from period_totals),'[]'::jsonb),
    'groups',coalesce((select jsonb_agg(jsonb_build_object('key',group_label,'count',n,'subgroups',
      coalesce((select jsonb_agg(jsonb_build_object('key',subgroup_label,'count',n) order by rank) from
        (select subgroup_label,count(distinct key)::integer as n,min(group_rank) as rank from period_entries t where t.group_label=g.group_label group by subgroup_label) sub),'[]'::jsonb)) order by rank) from
      (select group_label,count(distinct key)::integer as n,min(group_rank) as rank from period_entries group by group_label) g),'[]'::jsonb),
    'markers',coalesce((select jsonb_agg(jsonb_build_object('key',key,'label',label,'color',color,'count',n) order by key) from
      (select m->>'key' as key,m->>'label' as label,m->>'color' as color,count(distinct t.key) as n
        from period_entries t cross join lateral jsonb_array_elements(t.markers) m
        where (select label from group_choice)='all' or t.group_label=(select label from group_choice) or t.group_key=(select label from group_choice) group by m->>'key',m->>'label',m->>'color') m),'[]'::jsonb),
    'facets',case when not p_include_facets then '{}'::jsonb else
      (select jsonb_object_agg(f.id,jsonb_build_object('options',case when f.id=any(enum_fields) then
        coalesce((select jsonb_agg(jsonb_build_object('value',o.value,'label',o.label) order by o.label,o.value) from
          (select distinct on(v.value) v.value,coalesce(p_labels->f.id->>v.value,
            case when f.id='group' then (select name from public.school_business_groups where id::text=v.value)
              when f.id in ('owner','teacher') then (select display_name from public.profiles where id::text=v.value) end,
            e.fields->f.id->>'label',v.value) as label
            from field_values e cross join lateral jsonb_array_elements_text(e.fields->f.id->'values') v(value)
            order by v.value,e.key) o),'[]'::jsonb) else '[]'::jsonb end,
        'days',case when f.id=any(date_fields) then coalesce((select jsonb_agg(distinct e.fields->f.id->>'day' order by e.fields->f.id->>'day' desc)
          from field_values e where e.fields->f.id->>'day' is not null),'[]'::jsonb) else '[]'::jsonb end)) from required_fields f where f.id=any(enum_fields||date_fields)) end,
    'batches',coalesce((select jsonb_agg(jsonb_build_object('id',b.id,'label',b.batch_label,'createdAt',b.created_at) order by b.created_at desc)
      from public.data_import_batches b where b.status='completed' and b.import_kind='leads' and exists(
        select 1 from public.lead_source_records r join public.leads l on l.id=r.lead_id join visible v on v.key=coalesce('student:'||l.student_id,'lead:'||l.id) where r.batch_id=b.id)),'[]'::jsonb),
    'counts',jsonb_build_object(
      'awaiting_first_contact',(select count(distinct key) from visible where stage='awaiting_first_contact'),
      'awaiting_assessment',(select count(*) from visible where stage='awaiting_assessment'),
      'awaiting_enrollment',(select count(*) from visible where stage='awaiting_enrollment'),
      'former_student',(select count(*) from visible where stage='former_student'),
      'awaiting_renewal',(select count(*) from visible where stage='awaiting_renewal'))
  ) into result;
  return result;
end;
$function$
;

-- 最近沟通附带来源日期的依据与疑点（年份按登记补全、只记月份、待核对），名单据此提示；老师改过时间的不再提示。
create or replace function public.school_record_communication_summaries(p_subjects jsonb)
 RETURNS TABLE(key text, summary jsonb)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
declare actor uuid:=auth.uid(); view_all boolean; zone text;
begin
  if actor is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.is_staff(actor) or not public.has_perm(actor,'followup.view') then return; end if;
  view_all:=public.has_perm(actor,'student.view.all');
  zone:=public.get_organization_timezone_v2();
  return query
  with subjects as materialized (
    select s.key,coalesce(s.student_id,l.student_id) as student_id,s.lead_id
    from jsonb_to_recordset(p_subjects) s(key text,student_id uuid,lead_id uuid)
    left join public.leads l on l.id=s.lead_id
    where (s.student_id is not null or s.lead_id is not null)
      and (s.student_id is null or s.lead_id is null or s.student_id=l.student_id)
  ), authorized as materialized (
    select s.* from subjects s
    where (s.student_id is null or view_all or public.can_view_school_student(s.student_id,actor))
      and (s.lead_id is null or view_all or public.can_view_school_lead(s.lead_id,actor))
  ), lead_refs as materialized (
    select distinct s.key,l.id from authorized s join public.leads l on l.id=s.lead_id or l.student_id=s.student_id
    where view_all or public.can_view_school_lead(l.id,actor)
  ), authoritative_sources as materialized (
    select h.id from public.history_import_records h where h.source_format='feishu-base'
  ), contacts as materialized (
    select ref.key,c.id,
      coalesce(r.effective_patch->>'note',c.source_metric_facts->>'communicationNote',c.note,'') as note,
      coalesce(r.effective_patch->>'outcome',c.outcome) as outcome,
      coalesce(r.effective_patch->>'occurredAt',c.occurred_at::text,c.occurred_on::text) as occurred_at,
      c.source_metric_facts->>'communicationDate' as source_date_label,
      case when r.effective_patch ? 'occurredAt' then null else c.source_metric_facts->>'dateBasis' end as date_basis,
      case when r.effective_patch ? 'occurredAt' then null else c.source_metric_facts->>'dateReview' end as date_review,
      coalesce(p.display_name,nullif(c.source_metric_facts->'staff'->>'contacts',''),'') as actor_name,
      coalesce(to_char(coalesce((r.effective_patch->>'occurredAt')::timestamptz,c.occurred_at) at time zone zone,'YYYY-MM-DD HH24:MI:SS'),c.occurred_on::text,'')
        ||':'||case when c.source_key like '%:followup' then '3' when c.source_key like '%:project' then '2' else '1' end as sort_key,
      public.school_contact_is_effective(jsonb_build_object('source_metric_facts',c.source_metric_facts,'outcome',c.outcome,'wechat_added',c.wechat_added,'visit_committed',c.visit_committed),r.effective_patch) as effective_contact
    from lead_refs ref join public.lead_communications c on c.lead_id=ref.id
    left join lateral (select cr.effective_patch from public.communication_record_revisions cr
      where cr.source='contact' and cr.event_id=c.id order by cr.revision_no desc limit 1) r on true
    left join public.profiles p on p.id=c.recorded_by
    where (c.source_record_id is null or c.source_record_id in(select id from authoritative_sources))
      and not coalesce(c.source_metric_facts->'supersededProjection'='true'::jsonb,false)
      and (c.source_metric_facts->'contactAttempt' is distinct from 'false'::jsonb or r.effective_patch is not null)
  ), ranked as (
    select c.*,row_number() over(partition by c.key order by c.sort_key desc,c.id desc) as rank,
      count(*) over(partition by c.key) as total,
      count(*) filter(where c.effective_contact) over(partition by c.key) as effective_total from contacts c
  ), summaries as materialized (
    select jsonb_object_agg(r.key,jsonb_build_object(
      'count',r.total,'effectiveCount',r.effective_total,
      'latestNote',coalesce(r.note,''),'latestOutcome',r.outcome,'latestAt',r.occurred_at,
      'latestDateLabel',r.source_date_label,'latestDateBasis',r.date_basis,'latestDateReview',r.date_review,'latestActor',coalesce(r.actor_name,''))) as items
    from ranked r where r.rank=1 and r.key is not null
  ) select s.key,coalesce(m.items->s.key,jsonb_build_object(
      'count',0,'effectiveCount',0,'latestNote','','latestOutcome',null,'latestAt',null,
      'latestDateLabel',null,'latestDateBasis',null,'latestDateReview',null,'latestActor',''))
    from authorized s cross join summaries m;
end;
$function$
;

-- 线索来源时间：原表获取日期只写月日时采用证据中按登记先后补全的日期，并返回依据。
create or replace function public.get_lead_origin_events(p_lead_ids uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare actor uuid:=auth.uid(); zone text:=public.get_organization_timezone_v2(); result jsonb;
begin
  if actor is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.is_staff(actor) then raise exception 'FORBIDDEN'; end if;
  if p_lead_ids is null or cardinality(p_lead_ids)>500 or array_position(p_lead_ids,null) is not null then raise exception 'VALIDATION'; end if;
  if exists(select 1 from unnest(p_lead_ids) id where not public.can_access_communication_row('lead:'||id,false)) then raise exception 'FORBIDDEN_SCOPE'; end if;
  with leads as materialized (select * from public.leads where id=any(p_lead_ids)),
  source_refs as (
    select l.id as lead_id,h.id,h.record_data from leads l join public.history_import_records h on h.id=l.source_record_id
    union select l.id,h.id,h.record_data from leads l join public.history_import_records h on h.lead_id=l.id
  ), dates as (
    select lead_id,public.lead_source_origin_time(record_data,zone) as value,null::text as basis,null::text as label from source_refs
    union all select s.lead_id,to_jsonb(s.submitted_at)#>>'{}',null,null from public.lead_source_records s join leads l on l.id=s.lead_id
    -- 只写“7.20”等月日的获取日期：取阶段证据中按表内登记先后补全的日期，并带上依据供界面提示。
    union all select ref.lead_id,e.occurred_on::text,e.facts->>'dateBasis',
      (select btrim(c->>'text') from jsonb_array_elements(coalesce(ref.record_data->'cells','[]'::jsonb)) c where c->>'fieldName'='获取日期' limit 1)
      from source_refs ref join public.school_lifecycle_evidence e on e.kind='acquisition'
        and e.logical_key=(ref.record_data->>'tableId')||':'||(ref.record_data->>'sourceRecordId')
      where e.occurred_on is not null and public.lead_source_origin_time(ref.record_data,zone) is null
  ), origins as (
    select lead_id,(array_agg(value order by case when length(value)=10 then value::date::timestamp at time zone zone else value::timestamptz end))[1] as occurred_at,
      (array_agg(basis order by case when length(value)=10 then value::date::timestamp at time zone zone else value::timestamptz end))[1] as basis,
      (array_agg(label order by case when length(value)=10 then value::date::timestamp at time zone zone else value::timestamptz end))[1] as label
      from dates where value is not null group by lead_id
  ), named as (
    select distinct on(ref.lead_id) ref.lead_id,btrim(c->>'text') as owner_name from source_refs ref
      cross join lateral jsonb_array_elements(coalesce(ref.record_data->'cells','[]'::jsonb)) c
      where c->>'fieldName' in ('报名服务老师','学服老师','确认人员','跟进人') and nullif(btrim(c->>'text'),'') is not null
      order by ref.lead_id,case c->>'fieldName' when '报名服务老师' then 1 when '学服老师' then 2 when '确认人员' then 3 else 4 end,ref.id
  ) select coalesce(jsonb_agg(jsonb_build_object('leadId',l.id,'occurredAt',coalesce(o.occurred_at,
      case when l.source_record_id is null and not exists(select 1 from source_refs ref where ref.lead_id=l.id)
        and not exists(select 1 from public.lead_source_records s where s.lead_id=l.id) then to_jsonb(l.created_at)#>>'{}' end),
      'dateBasis',o.basis,'dateLabel',o.label,'sourceOwnerName',n.owner_name,'imported',l.source_record_id is not null or exists(select 1 from source_refs ref where ref.lead_id=l.id)) order by l.id),'[]'::jsonb)
    into result from leads l left join origins o on o.lead_id=l.id left join named n on n.lead_id=l.id;
  return result;
end;
$function$
;

select public.school_refresh_subject_lifecycle();
