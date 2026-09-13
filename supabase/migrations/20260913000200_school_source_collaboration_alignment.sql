-- 将生产来源提示接入已发布的协作查看范围；旧迁移账本保持原值。
create or replace function public.school_duplicate_record_candidates(p_student_id uuid,p_lead_id uuid)
returns table(student_id uuid,lead_id uuid,name text,phone text,grade integer,school text)
language sql stable security definer set search_path=public,pg_temp as $$
  with subject as materialized (
    select coalesce(p_student_id,l.student_id) sid,p_lead_id lid,
      public.school_identity_name(coalesce(s.name,l.provisional_student_name)) label,
      array_remove(array[public.school_identity_phone(s.phone),public.school_identity_phone(s.parent_phone),public.school_identity_phone(l.phone)],'') phones
    from (select 1) seed left join public.leads l on l.id=p_lead_id
      left join public.students s on s.id=coalesce(p_student_id,l.student_id)
  ), candidates as (
    select s.id,null::uuid,s.name,coalesce(nullif(s.phone,''),s.parent_phone,''),s.grade,coalesce(s.school,'')
      from subject x cross join lateral unnest(x.phones) tel(value) join public.students s
        on public.school_identity_name(s.name)=x.label and public.school_identity_phone(s.phone)=tel.value
      where x.label<>'' and s.deleted_at is null and s.id is distinct from x.sid and public.can_view_school_student(s.id,auth.uid())
    union select s.id,null::uuid,s.name,coalesce(nullif(s.phone,''),s.parent_phone,''),s.grade,coalesce(s.school,'')
      from subject x cross join lateral unnest(x.phones) tel(value) join public.students s
        on public.school_identity_name(s.name)=x.label and public.school_identity_phone(s.parent_phone)=tel.value
      where x.label<>'' and s.deleted_at is null and s.id is distinct from x.sid and public.can_view_school_student(s.id,auth.uid())
    union select null::uuid,l.id,l.provisional_student_name,coalesce(l.phone,''),l.grade_hint,''
      from subject x cross join lateral unnest(x.phones) tel(value) join public.leads l
        on public.school_identity_name(l.provisional_student_name)=x.label and public.school_identity_phone(l.phone)=tel.value
      where x.label<>'' and l.student_id is null and l.id is distinct from x.lid and public.can_view_school_lead(l.id,auth.uid())
  ) select * from candidates;
$$;

-- 归一化助手按已上线权限使用；内部候选函数由受保护读取入口调用。
revoke all on function public.school_identity_name(text),public.school_identity_phone(text),
  public.school_duplicate_record_candidates(uuid,uuid),public.read_school_record_hints(jsonb),
  public.read_school_record_source_context(uuid,uuid,integer) from public,anon,authenticated,service_role;
grant execute on function public.school_identity_name(text),public.school_identity_phone(text),
  public.read_school_record_hints(jsonb),public.read_school_record_source_context(uuid,uuid,integer) to authenticated;

notify pgrst,'reload schema';
