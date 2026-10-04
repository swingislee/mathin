-- 在已核对的本地数据库中读取固定开发身份；整组检查随事务回滚，不创建业务样例。
do $$
declare actor_role text; scope text; facts public.business_course_enrollment_subjects[]; n integer; hidden uuid;
begin
  select coalesce(array_agg(e),'{}'::public.business_course_enrollment_subjects[]) into facts from public.business_course_enrollment_subjects e;
  foreach actor_role in array array['supervisor','teacher'] loop
    perform set_config('request.jwt.claim.sub',current_setting('directory.test.'||actor_role),true);
    foreach scope in array array['all','mine','group','unassigned'] loop
      select count(*) into n from public.student_record_index_with_enrollments(scope,'',facts) where student_id is not null;
      perform set_config('directory.expected.'||actor_role||'_'||scope,n::text,true);
    end loop;
  end loop;
  select s.id into hidden from public.students s where s.deleted_at is null
    and not public.can_view_school_student(s.id,current_setting('directory.test.teacher')::uuid) limit 1;
  perform set_config('directory.test.hidden',coalesce(hidden::text,''),true);
  if has_function_privilege('anon','public.list_student_directory(text,text,text,text,text,integer,integer,uuid[])','execute')
    or has_function_privilege('service_role','public.list_student_directory(text,text,text,text,text,integer,integer,uuid[])','execute')
    or not has_function_privilege('authenticated','public.list_student_directory(text,text,text,text,text,integer,integer,uuid[])','execute') then
    raise exception 'DIRECTORY_EXECUTE_SCOPE'; end if;
end $$;

set local role authenticated;
do $$
declare actor_role text; scope text; grouping text; data jsonb; filtered jsonb; selected jsonb; rows jsonb; ids uuid[];
  n integer; stage text; group_id text; hidden uuid;
begin
  foreach actor_role in array array['supervisor','teacher'] loop
    perform set_config('request.jwt.claim.sub',current_setting('directory.test.'||actor_role),true);
    foreach scope in array array['all','mine','group','unassigned'] loop
      data:=public.list_student_directory(p_scope=>scope,p_page_size=>20);
      n:=current_setting('directory.expected.'||actor_role||'_'||scope)::integer;
      if (data->>'count')::integer<>n or jsonb_array_length(data->'rows')<>least(n,20) then raise exception 'DIRECTORY_PROFILE_SCOPE'; end if;
      if exists(select 1 from jsonb_array_elements(data->'rows') r where r->>'studentId' is null or jsonb_array_length(r->'directoryGroups')=0)
        or (select count(distinct r->>'studentId') from jsonb_array_elements(data->'rows') r)<>jsonb_array_length(data->'rows') then
        raise exception 'DIRECTORY_IDENTITY_OR_GROUP'; end if;
      if coalesce((select sum(value::integer) from jsonb_each_text(data->'counts')),0)<>n then raise exception 'DIRECTORY_STAGE_COUNTS'; end if;
    end loop;
    data:=public.list_student_directory(p_scope=>'all',p_group_by=>'none',p_page_size=>20);
    rows:=data->'rows';
    if jsonb_array_length(rows)>=2 then
      ids:=array[(rows->1->>'studentId')::uuid,(rows->0->>'studentId')::uuid,(rows->1->>'studentId')::uuid];
      selected:=public.list_student_directory(p_scope=>'all',p_group_by=>'none',p_selected=>ids);
      if (selected->>'count')::integer<>2 or selected->'rows'->0->>'studentId'<>ids[1]::text or selected->'rows'->1->>'studentId'<>ids[2]::text then
        raise exception 'DIRECTORY_SELECTION_ORDER_OR_DEDUP'; end if;
      stage:=rows->0->>'stage';
      filtered:=public.list_student_directory(p_scope=>'all',p_stage=>stage,p_group_by=>'none',p_page_size=>20);
      if filtered->>'count'<>data->'counts'->>stage or exists(select 1 from jsonb_array_elements(filtered->'rows') r where r->>'stage'<>stage) then
        raise exception 'DIRECTORY_STAGE_FILTER'; end if;
    end if;
    filtered:=public.list_student_directory(p_scope=>'all',p_group_by=>'none',p_page=>1000000,p_page_size=>20);
    if filtered->>'page'<>filtered->>'totalPages' or filtered->>'count'<>data->>'count' then raise exception 'DIRECTORY_PAGINATION'; end if;
  end loop;
  hidden:=nullif(current_setting('directory.test.hidden'),'')::uuid;
  if hidden is not null and (public.list_student_directory(p_scope=>'all',p_selected=>array[hidden])->>'count')::integer<>0 then
    raise exception 'DIRECTORY_SELECTION_VISIBILITY'; end if;
  perform set_config('request.jwt.claim.sub',current_setting('directory.test.supervisor'),true);
  foreach grouping in array array['classroom','grade','owner','group','none'] loop
    data:=public.list_student_directory(p_scope=>'all',p_group_by=>grouping,p_page_size=>20);
    if exists(select 1 from jsonb_array_elements(data->'groups') g where g->>'id'<>'unassigned')
      and data->'rows'->0->'directoryGroups'->0->>'id'='unassigned' then raise exception 'DIRECTORY_UNASSIGNED_ORDER'; end if;
    group_id:=data->'groups'->0->>'id';
    if group_id is not null then
      filtered:=public.list_student_directory(p_scope=>'all',p_group_by=>grouping,p_group=>group_id,p_page_size=>20);
      if filtered->>'count'<>data->'groups'->0->>'count' or exists(select 1 from jsonb_array_elements(filtered->'rows') r
        where not exists(select 1 from jsonb_array_elements(r->'directoryGroups') g where g->>'id'=group_id)) then
        raise exception 'DIRECTORY_GROUP_FILTER'; end if;
    end if;
  end loop;
  begin
    perform public.list_student_directory(p_selected=>'{}'::uuid[]); raise exception 'DIRECTORY_EXPECTED_VALIDATION';
  exception when raise_exception then if sqlerrm<>'VALIDATION' then raise; end if; end;
  perform set_config('request.jwt.claim.sub',current_setting('directory.test.outsider'),true);
  begin
    perform public.list_student_directory(); raise exception 'DIRECTORY_EXPECTED_FORBIDDEN';
  exception when raise_exception then if sqlerrm<>'FORBIDDEN' then raise; end if; end;
  perform set_config('request.jwt.claim.sub','',true);
  begin
    perform public.list_student_directory(); raise exception 'DIRECTORY_EXPECTED_UNAUTHENTICATED';
  exception when raise_exception then if sqlerrm<>'UNAUTHENTICATED' then raise; end if; end;
end $$;
reset role;
