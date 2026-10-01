-- 三端测评报告使用 students.id 选择孩子；同名孩子继续保持独立。
-- 保留原 RPC 的已发送报告与亲子 grades 权限，只扩展 JSON 返回字段。
begin;

create or replace function public.miniapp_assessment_reports() returns jsonb
language sql security definer stable set search_path=public,pg_temp as $$
  select coalesce(jsonb_agg(item order by sent_at desc),'[]') from (
    select w.sent_at,jsonb_build_object('id',p.id,'kind','assessment','title',p.payload->>'activityTitle',
      'participantId',s.id,'participantName',s.name,'date',w.sent_at,'summary',coalesce(p.payload->>'teacherObservation',''),
      'strengths',coalesce(p.payload->>'strengths',''),'focusAreas',coalesce(p.payload->>'focusAreas',''),
      'recommendation',coalesce(p.payload->>'recommendation',''),'score',p.payload->'score','totalScore',p.payload->'totalScore') item
    from public.assessment_workflow_states w join public.assessment_reports p on p.id=w.sent_report_id and p.registration_id=w.registration_id
    join public.activity_registrations r on r.id=w.registration_id join public.students s on s.id=r.student_id
    where w.sent_at is not null and public.miniapp_can_participate(s.id) order by w.sent_at desc limit 100
  ) rows;
$$;

revoke all on function public.miniapp_assessment_reports() from public,anon,authenticated;
grant execute on function public.miniapp_assessment_reports() to authenticated;

commit;
