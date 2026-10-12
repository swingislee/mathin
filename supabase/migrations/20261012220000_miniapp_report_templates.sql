begin;

do $copy$ begin
  execute replace(pg_get_functiondef('mathin_internal.valid_miniapp_settings(jsonb)'::regprocedure),
    'mathin_internal.valid_miniapp_settings(', 'mathin_internal.valid_miniapp_settings_before_reports(');
end $copy$;
create function mathin_internal.valid_miniapp_report_templates(p jsonb) returns boolean
language plpgsql immutable set search_path=public,pg_temp as $$
declare kind text; source text; section jsonb; sources text[]; seen text[];
begin
  if jsonb_typeof(p) is distinct from 'object' or not(p ?& array['assessment','feedback']) or p-array['assessment','feedback']<>'{}' then return false; end if;
  foreach kind in array array['assessment','feedback'] loop
    sources:=case when kind='assessment' then array['summary','score','strengths','focusAreas','recommendation'] else array['summary','score'] end; seen:='{}';
    if jsonb_typeof(p->kind) is distinct from 'array' or jsonb_array_length(p->kind)<>cardinality(sources) then return false; end if;
    for section in select value from jsonb_array_elements(p->kind) loop
      source:=section->>'source';
      if jsonb_typeof(section) is distinct from 'object' or not(section ?& array['source','label','visible']) or section-array['source','label','visible']<>'{}'
        or not coalesce(source=any(sources),false) or source=any(seen) or not mathin_internal.miniapp_text_valid(section->'label',100)
        or btrim(section#>>'{label,zh}')='' or jsonb_typeof(section->'visible') is distinct from 'boolean' then return false; end if;
      seen:=array_append(seen,source);
    end loop;
    if not exists(select 1 from jsonb_array_elements(p->kind) s where s->'visible'='true') then return false; end if;
  end loop;
  return true;
exception when others then return false;
end $$;
create or replace function mathin_internal.valid_miniapp_settings(p jsonb) returns boolean
language sql immutable security definer set search_path=public,pg_temp as $$
  select mathin_internal.valid_miniapp_settings_before_reports(p-'reports')
    and (not(p ? 'reports') or mathin_internal.valid_miniapp_report_templates(p->'reports')) and octet_length(p::text)<=65536;
$$;
create function mathin_internal.default_miniapp_report_sections(p_kind text) returns jsonb
language sql immutable set search_path=public,pg_temp as $$
  select case when p_kind='assessment' then
    '[{"source":"summary","label":{"zh":"老师观察","en":"Teacher observations"},"visible":true},{"source":"score","label":{"zh":"得分","en":"Score"},"visible":true},{"source":"strengths","label":{"zh":"优势","en":"Strengths"},"visible":true},{"source":"focusAreas","label":{"zh":"关注方向","en":"Focus areas"},"visible":true},{"source":"recommendation","label":{"zh":"建议","en":"Recommendations"},"visible":true}]'::jsonb
  else '[{"source":"summary","label":{"zh":"课堂反馈","en":"Session feedback"},"visible":true},{"source":"score","label":{"zh":"得分","en":"Score"},"visible":true}]'::jsonb end;
$$;
create function public.miniapp_report_template(p_kind text) returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare sections jsonb;
begin
  if p_kind not in ('assessment','feedback') or p_kind is null then raise exception 'VALIDATION'; end if;
  select published->'reports'->p_kind into sections from miniapp_settings where singleton;
  sections:=coalesce(sections,mathin_internal.default_miniapp_report_sections(p_kind));
  return jsonb_build_object('version',md5(sections::text),'sections',sections);
end $$;
-- Only new immutable reports receive a template. Existing report versions stay untouched.
alter table public.assessment_reports add column miniapp_report_template jsonb;
alter table public.learning_result_revisions add column miniapp_report_template jsonb;
create function public.snapshot_miniapp_report_template() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if tg_table_name='assessment_reports' then new.miniapp_report_template:=public.miniapp_report_template('assessment');
  elsif exists(select 1 from learning_result_heads where id=new.head_id and kind='session_review') then new.miniapp_report_template:=public.miniapp_report_template('feedback');
  else new.miniapp_report_template:=null; end if;
  return new;
end $$;
create trigger assessment_reports_template_snapshot before insert on public.assessment_reports for each row execute function public.snapshot_miniapp_report_template();
create trigger learning_result_template_snapshot before insert on public.learning_result_revisions for each row execute function public.snapshot_miniapp_report_template();
create or replace function public.miniapp_assessment_reports() returns jsonb
language sql security definer stable set search_path=public,pg_temp as $$
  select coalesce(jsonb_agg(item order by sent_at desc),'[]') from (
    select w.sent_at,jsonb_build_object('id',p.id,'kind','assessment','title',p.payload->>'activityTitle',
      'participantId',s.id,'participantName',s.name,'date',w.sent_at,'summary',coalesce(p.payload->>'teacherObservation',''),
      'strengths',coalesce(p.payload->>'strengths',''),'focusAreas',coalesce(p.payload->>'focusAreas',''),
      'recommendation',coalesce(p.payload->>'recommendation',''),'score',p.payload->'score','totalScore',p.payload->'totalScore',
      'template',p.miniapp_report_template) item
    from public.assessment_workflow_states w join public.assessment_reports p on p.id=w.sent_report_id and p.registration_id=w.registration_id
    join public.activity_registrations r on r.id=w.registration_id join public.students s on s.id=r.student_id
    where w.sent_at is not null and public.miniapp_can_participate(s.id) order by w.sent_at desc limit 100
  ) rows;
$$;
create function public.miniapp_feedback_reports(p_from timestamptz,p_to timestamptz) returns jsonb
language sql stable security definer set search_path=public,pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object('id',r.session_id::text||':'||r.student_id::text,'kind','feedback','title',r.lecture_name,
    'participantId',r.student_id,'participantName',r.student_name,'date',r.scheduled_at,'summary',r.comment,'strengths','','focusAreas','','recommendation','',
    'score',r.exit_score,'totalScore',null,'template',revision.miniapp_report_template) order by r.scheduled_at desc),'[]')
  from (select * from public.get_my_session_reviews(p_from,p_to) order by scheduled_at desc limit 200) r
  join public.learning_result_heads h on h.kind='session_review' and h.session_id=r.session_id and h.student_id=r.student_id and h.status='published'
  join public.learning_result_revisions revision on revision.id=h.published_revision_id;
$$;
revoke all on function mathin_internal.valid_miniapp_settings_before_reports(jsonb),mathin_internal.valid_miniapp_report_templates(jsonb),mathin_internal.default_miniapp_report_sections(text),
  public.miniapp_report_template(text),public.snapshot_miniapp_report_template(),public.miniapp_feedback_reports(timestamptz,timestamptz) from public,anon,authenticated;
grant execute on function public.miniapp_report_template(text),public.miniapp_feedback_reports(timestamptz,timestamptz) to authenticated;
notify pgrst,'reload schema';
commit;
