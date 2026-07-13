-- P4E-F §3.2：安全创建/切换学期，历史数据保持原 term_id。
create or replace function public.create_school_term(
 p_year int,p_term smallint,p_name text,p_starts_on date,p_ends_on date
) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare uid uuid:=auth.uid(); tid uuid;
begin
 if uid is null or not public.has_perm(uid,'course.manage') then raise exception 'FORBIDDEN'; end if;
 if p_year<2020 or p_year>2100 or p_term not in(1,2) or p_ends_on<p_starts_on or trim(coalesce(p_name,''))=''
 then raise exception 'INVALID_TERM'; end if;
 insert into public.school_terms(year,term,name,starts_on,ends_on,is_current)
 values(p_year,p_term,left(trim(p_name),100),p_starts_on,p_ends_on,false) returning id into tid;
 perform public.emit_domain_event('school_term.created','school_term',tid,jsonb_build_object('year',p_year,'term',p_term),null,null);
 return tid;
end $$;

create or replace function public.activate_school_term(p_term_id uuid)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare uid uuid:=auth.uid(); target public.school_terms;
begin
 if uid is null or not public.has_perm(uid,'course.manage') then raise exception 'FORBIDDEN'; end if;
 select * into target from public.school_terms where id=p_term_id for update;
 if target.id is null then raise exception 'NOT_FOUND'; end if;
 perform pg_advisory_xact_lock(hashtext('school-term:'||coalesce(target.campus_id::text,'global')));
 update public.school_terms set is_current=false where campus_id is not distinct from target.campus_id and is_current and id<>target.id;
 update public.school_terms set is_current=true where id=target.id;
 insert into public.student_grade_history(student_id,term_id,grade,recorded_by)
 select id,target.id,grade,uid from public.students where deleted_at is null and grade is not null
 on conflict(student_id,term_id) do nothing;
 perform public.emit_domain_event('school_term.activated','school_term',target.id,
   jsonb_build_object('year',target.year,'term',target.term,'name',target.name),null,null);
end $$;
revoke all on function public.create_school_term(int,smallint,text,date,date) from public,anon,authenticated;
revoke all on function public.activate_school_term(uuid) from public,anon,authenticated;
grant execute on function public.create_school_term(int,smallint,text,date,date),public.activate_school_term(uuid) to authenticated;
