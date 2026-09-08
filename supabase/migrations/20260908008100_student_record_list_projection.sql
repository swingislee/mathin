-- 筛选和列菜单读取一次全范围摘要，完整登记上下文按打开的学生读取。
create function public.student_record_list_rows(p_subjects jsonb,p_enrollments public.business_course_enrollment_subjects[])
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare actor uuid:=auth.uid(); view_followup boolean:=public.has_perm(auth.uid(),'followup.view');
  write_followup boolean:=public.has_perm(auth.uid(),'followup.write'); view_all boolean:=public.has_perm(auth.uid(),'student.view.all'); result jsonb;
begin
  if actor is null or not public.is_staff(actor) then raise exception 'FORBIDDEN'; end if;
  with subjects as materialized (select * from jsonb_to_recordset(p_subjects)
    as s(student_id uuid,lead_id uuid,key text,stage text,detail text,created_at timestamptz)),
  lead_refs as materialized (select l.id,s.key from public.leads l join subjects s on
    l.id=s.lead_id or s.student_id is not null and l.student_id=s.student_id
    where view_followup and (l.owner_id is null or l.owner_id=actor or view_all)),
  contacts as materialized (select ref.key,c.id,c.source_record_id,c.occurred_at,coalesce(r.effective_patch->>'note',c.note) as note
    from public.business_lead_communications c join lead_refs ref on ref.id=c.lead_id
    left join lateral (select effective_patch from public.communication_record_revisions r
      where r.source='contact' and r.event_id=c.id order by r.revision_no desc limit 1) r on true),
  recent_contact as (select distinct on(key) key,source_record_id,occurred_at from contacts order by key,occurred_at desc,id),
  source_refs as materialized (
    select s.key,h.id from subjects s join public.history_import_records h on h.student_id=s.student_id
    union select l.key,h.id from lead_refs l join public.history_import_records h on h.lead_id=l.id
    union select s.key,a.record_id from subjects s join public.history_import_associations a on a.student_id=s.student_id
    union select ref.key,l.source_record_id from lead_refs ref join public.leads l on l.id=ref.id
    union select ref.key,c.source_record_id from lead_refs ref join public.lead_communications c on c.lead_id=ref.id
    union select s.key,r.source_record_id from subjects s join public.activity_registrations r on r.student_id=s.student_id
    union select ref.key,r.source_record_id from lead_refs ref join public.activity_registrations r on r.lead_id=ref.id
    union select s.key,a.source_record_id from subjects s join public.assessment_results a on a.student_id=s.student_id
    union select ref.key,a.source_record_id from lead_refs ref join public.assessment_results a on a.lead_id=ref.id
    union select s.key,e.source_record_id from subjects s join public.course_enrollments e on e.student_id=s.student_id
  ), source_names as materialized (
    select h.id,public.business_source_is_current(h.id) as current_source,
      coalesce(f.fields->>'报名服务老师',f.fields->>'学服老师',f.fields->>'确认人员') as owner_name
    from public.history_import_records h cross join lateral (
      select jsonb_object_agg(c->>'fieldName',btrim(c->>'text')) as fields from jsonb_array_elements(h.record_data->'cells') c
      where c->>'fieldName' in ('报名服务老师','学服老师','确认人员') and nullif(btrim(c->>'text'),'') is not null
    ) f where h.source_data->>'format'='feishu-base' and exists(select 1 from source_refs ref where ref.id=h.id)
  ), source_owners as (
    select distinct on(ref.key) ref.key,n.owner_name from source_refs ref join source_names n on n.id=ref.id
      join subjects s on s.key=ref.key left join recent_contact c on c.key=ref.key where n.owner_name is not null
      order by ref.key,case when s.stage='awaiting_assessment' and c.source_record_id=ref.id then 1 when n.current_source then 2 else 3 end,ref.id
  ),
  notes as (select s.key,f.id,f.content,f.created_at as occurred_at,1 as priority
      from public.business_student_follow_ups f join subjects s on s.student_id=f.student_id where view_followup
    union all select key,id,note,occurred_at,0 from contacts),
  recent_note as (select distinct on(key) key,content,occurred_at from notes where nullif(btrim(content),'') is not null
    order by key,occurred_at desc,priority desc,id),
  reminders as (select ref.key,min(a.due_at) as due_at from public.lead_next_actions a join lead_refs ref on ref.id=a.lead_id
    where a.status='open' and a.kind<>'initial_contact' group by ref.key)
  select coalesce(jsonb_agg(case when s.stage not in ('awaiting_first_contact','awaiting_assessment') then
      public.read_student_record_with_enrollments(s.student_id,s.lead_id,p_enrollments)
    else jsonb_build_object(
      'key',s.key,'studentId',s.student_id,'leadId',s.lead_id,'name',coalesce(st.name,l.provisional_student_name),
      'phone',coalesce(nullif(st.parent_phone,''),nullif(st.phone,''),l.phone,''),'grade',coalesce(st.grade,l.grade_hint),'gradeText',coalesce(l.grade_text,''),
      'ownerId',coalesce(st.assigned_to,l.owner_id),'ownerName',coalesce(p.display_name,so.owner_name,''),'stage',s.stage,'detail',s.detail,
      'note',coalesce(n.content,''),'lastContactAt',coalesce(n.occurred_at,c.occurred_at),
      'nextContactAt',case when view_followup then least(st.next_follow_up_at,a.due_at) else null end,
      'score',null,'assessmentBand',null,'assessmentAt',null,'registrationId',null,
      'courseTitle','','termName','','courseId',null,'termId',null,'createdAt',s.created_at,
      'canWrite',write_followup and ((s.student_id is not null and public.can_access_student(s.student_id,actor))
        or (l.owner_id is not null and (l.owner_id=actor or view_all))),
      'canContact',write_followup and ((l.id is not null and l.owner_id is not null and l.status not in ('invalid','converted') and (l.owner_id=actor or view_all))
        or (l.id is null and st.id is not null and (st.assigned_to=actor or view_all))),
      'invitation',null)
    end order by s.created_at desc,s.key),'[]'::jsonb) into result
    from subjects s left join public.students st on st.id=s.student_id left join public.leads l on l.id=s.lead_id
    left join public.profiles p on p.id=coalesce(st.assigned_to,l.owner_id)
    left join recent_note n on n.key=s.key left join recent_contact c on c.key=s.key left join reminders a on a.key=s.key
    left join source_owners so on so.key=s.key;
  return result;
end;
$$;
revoke all on function public.student_record_list_rows(jsonb,public.business_course_enrollment_subjects[]) from public,anon,authenticated,service_role;

create function public.list_student_record_summaries(p_stage text,p_scope text,p_search text,p_population text)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare actor uuid:=auth.uid(); facts public.business_course_enrollment_subjects[]; subjects jsonb; counts jsonb;
begin
  if actor is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.is_staff(actor) or not (public.has_perm(actor,'student.view.all') or public.has_perm(actor,'student.view.assigned')
    or public.has_perm(actor,'followup.view')) then raise exception 'FORBIDDEN'; end if;
  if p_stage is null or p_stage not in ('awaiting_first_contact','awaiting_assessment','awaiting_enrollment','awaiting_renewal','former_student')
    or p_scope is null or p_scope not in ('mine','all','unassigned') or length(coalesce(p_search,''))>80
    or p_population is null or p_population not in ('work','records') then raise exception 'VALIDATION'; end if;
  select coalesce(array_agg(e),'{}'::public.business_course_enrollment_subjects[]) into facts from public.business_course_enrollment_subjects e;
  with visible as materialized (select * from public.student_record_index_with_enrollments(p_scope,p_search,facts) s
    where p_population='records' or public.business_subject_is_current(s.student_id,s.lead_id))
  select coalesce((select jsonb_agg(to_jsonb(s)) from visible s where coalesce(p_search,'')<>'' or s.stage=p_stage),'[]'::jsonb),
    coalesce((select jsonb_object_agg(stage,n) from (select stage,count(*) as n from visible group by stage) c),'{}'::jsonb)
    into subjects,counts;
  return jsonb_build_object('rows',public.student_record_list_rows(subjects,facts),'counts',counts);
end;
$$;
revoke all on function public.list_student_record_summaries(text,text,text,text) from public,anon,authenticated;
grant execute on function public.list_student_record_summaries(text,text,text,text) to authenticated;
notify pgrst,'reload schema';
