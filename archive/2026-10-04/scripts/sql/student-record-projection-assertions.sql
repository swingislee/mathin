-- 全范围字段摘要和分页读取保持同一权限、人数、阶段与基本字段。
do $test$
declare actor uuid; summary jsonb; page jsonb; item jsonb; compact jsonb; population text; field text; err text;
begin
  select id into actor from auth.users where email='test-admin@mathin.local';
  if actor is null then raise exception 'FIXED_ADMIN_REQUIRED'; end if;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
  foreach population in array array['work','records'] loop
    summary:=public.list_student_record_summaries('awaiting_first_contact','all','',population);
    page:=public.list_student_record_workspace('awaiting_first_contact','all','',1,20,'',population);
    if summary->'counts'<>page->'counts' or jsonb_array_length(summary->'rows')<>(page->>'count')::integer then raise exception 'LIST_PROJECTION_COUNT_MISMATCH'; end if;
    for item in select value from jsonb_array_elements(page->'rows') loop
      select value into compact from jsonb_array_elements(summary->'rows') where value->>'key'=item->>'key';
      foreach field in array array['key','studentId','leadId','name','phone','grade','gradeText','ownerId','ownerName','stage','detail','note','canWrite','canContact'] loop
        if compact->field is distinct from item->field then raise exception 'LIST_PROJECTION_FIELD_MISMATCH: %',field; end if;
      end loop;
    end loop;
  end loop;
  perform set_config('request.jwt.claims','{}',true);
  begin perform public.list_student_record_summaries('awaiting_first_contact','all','','records'); raise exception 'ANONYMOUS_READ_ALLOWED';
    exception when others then get stacked diagnostics err=message_text; if err<>'UNAUTHENTICATED' then raise; end if; end;
  if has_function_privilege('authenticated','public.student_record_list_rows(jsonb,public.business_course_enrollment_subjects[])','EXECUTE') then raise exception 'PRIVATE_PROJECTION_EXPOSED'; end if;
end;
$test$;
