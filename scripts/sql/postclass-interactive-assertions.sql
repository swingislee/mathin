-- 复用本机固定身份与外层事务，所有题目、分组和资源登记随事务回滚。
do $$
declare cid uuid; sid uuid:=gen_random_uuid();
begin
  select classroom_id into cid from public.class_sessions where id=current_setting('teaching.test.session')::uuid;
  insert into public.class_sessions(id,classroom_id,title,scheduled_at) values(sid,cid,'Interactive group assertion','2040-01-15Z');
  perform set_config('interactive.test.session',sid::text,true);
  insert into public.homework_assets(binding_key,scope,target_id,sha256,kind,created_by) values
    (repeat('a',64),'lecture',current_setting('homework.test.lecture')::uuid,repeat('a',64),'image',current_setting('teaching.test.admin')::uuid),
    (repeat('b',64),'assignment',gen_random_uuid(),repeat('b',64),'image',current_setting('teaching.test.admin')::uuid),
    (repeat('c',64),'lecture',current_setting('homework.test.lecture')::uuid,repeat('c',64),'h5',current_setting('teaching.test.admin')::uuid);
end $$;
set local role authenticated;
do $$
declare mid uuid; page_id uuid; page2 uuid; group_id uuid:=gen_random_uuid(); state jsonb; groups jsonb; doc jsonb; question jsonb;
  lid uuid:=current_setting('homework.test.lecture')::uuid; aid uuid; saved jsonb; student uuid; qid uuid;
begin
  perform set_config('request.jwt.claim.sub',current_setting('teaching.test.admin'),true);
  perform public.set_feature_flag('teaching.teacher_microcourses_v1',null,true,now(),'Interactive question assertion');
  perform set_config('request.jwt.claim.sub',current_setting('teaching.test.teacher'),true);
  mid:=public.create_teacher_microcourse_variant(current_setting('interactive.test.session')::uuid,'Group draft','Group questions','',3::smallint,null::smallint,'','logic-strategy','{}');
  page_id:=public.create_teacher_microcourse_composition_page(mid,null,'First question',null,null,null);
  page2:=public.create_teacher_microcourse_composition_page(mid,page_id,'Second question',null,null,null);
  state:=public.get_teacher_microcourse_question_groups(mid);
  groups:=jsonb_build_array(jsonb_build_object('id',group_id,'name','基础过关','questionIds',jsonb_build_array(page2,page_id)),jsonb_build_object('id',gen_random_uuid(),'name','能力提升','questionIds','[]'::jsonb));
  saved:=public.save_teacher_microcourse_question_groups(mid,0,groups);
  if saved->>'version'<>'1' or saved#>>'{groups,1,name}'<>'能力提升' or public.get_teacher_microcourse_editor(mid)#>>'{pages,0,pageDocId}'<>page2::text then raise exception 'GROUP_ORDER_NOT_SAVED'; end if;
  begin perform public.save_teacher_microcourse_question_groups(mid,0,groups); raise exception 'STALE_GROUP_ALLOWED'; exception when others then if sqlerrm<>'CONFLICT' then raise; end if; end;
  begin perform public.save_teacher_microcourse_question_groups(mid,1,jsonb_set(groups,'{0,questionIds}',jsonb_build_array(gen_random_uuid()))); raise exception 'FOREIGN_PAGE_ALLOWED'; exception when others then if sqlerrm<>'VALIDATION' then raise; end if; end;
  begin perform public.save_teacher_microcourse_question_groups(mid,1,jsonb_set(groups,'{0,questionIds}',jsonb_build_array(page_id,page_id))); raise exception 'DUPLICATE_PAGE_ALLOWED'; exception when others then if sqlerrm<>'VALIDATION' then raise; end if; end;
  doc:=public.get_teacher_microcourse_editor(mid)#>'{pages,0,doc}';
  perform set_config('request.jwt.claim.sub',current_setting('teaching.test.admin'),true);
  state:=public.get_homework_document('lecture',lid);
  qid:=gen_random_uuid();
  question:=jsonb_build_object('id',qid,'label','1','group','基础','content','交互题干','answer','交互解析','composition',doc,'answerComposition',doc,'sourceQuestionId',null);
  saved:=public.save_homework_document('lecture',lid,state->>'revision',(state->'document')||jsonb_build_object('questions',jsonb_build_array(question),'groups',jsonb_build_array('基础','能力提升')));
  if saved#>'{document,questions,0,composition}' is distinct from doc or saved#>'{document,questions,0,answerComposition}' is distinct from doc or saved#>>'{document,groups,1}'<>'能力提升' then raise exception 'INTERACTIVE_CONTENT_LOST'; end if;
  begin perform public.save_homework_document('lecture',lid,saved->>'revision',jsonb_set(saved->'document','{questions,0,composition}',jsonb_build_object('docVersion','bad'))); raise exception 'BAD_DOC_ALLOWED'; exception when others then if sqlerrm<>'VALIDATION' then raise; end if; end;
  perform set_config('request.jwt.claim.sub',current_setting('teaching.test.teacher'),true);
  aid:=public.publish_session_template_assignment(current_setting('teaching.test.session')::uuid,'Interactive homework','',null);
  state:=public.get_homework_document('assignment',aid);
  if state#>'{document,questions,0,composition}' is distinct from doc or state#>'{document,questions,0,answerComposition}' is distinct from doc then raise exception 'PUBLISHED_COPY_LOST'; end if;
  student:=(state#>>'{students,0,id}')::uuid;
  saved:=public.save_homework_document('assignment',aid,state->>'revision',(state->'document')||jsonb_build_object('overrides',jsonb_build_array(jsonb_build_object('studentId',student,'questionId',state#>>'{document,questions,0,id}','content','个性化交互题','composition',doc))));
  if saved#>'{document,overrides,0,composition}' is distinct from doc then raise exception 'PERSONALIZED_DOC_LOST'; end if;
  if not public.can_read_homework_asset(repeat('a',64),auth.uid()) or public.can_read_homework_asset(repeat('b',64),auth.uid()) then raise exception 'ASSET_SCOPE_WRONG'; end if;
  perform set_config('interactive.test.microcourse',mid::text,true);
  perform set_config('interactive.test.doc',doc::text,true);
  perform set_config('request.jwt.claim.sub',current_setting('teaching.test.outsider'),true);
  begin perform public.get_teacher_microcourse_question_groups(mid); raise exception 'OUTSIDER_GROUP_READ'; exception when others then if sqlerrm<>'FORBIDDEN' then raise; end if; end;
  begin perform public.save_teacher_microcourse_question_groups(mid,1,groups); raise exception 'OUTSIDER_GROUP_WRITE'; exception when others then if sqlerrm<>'FORBIDDEN' then raise; end if; end;
  if exists(select 1 from public.teacher_microcourse_question_groups) or exists(select 1 from public.homework_assets) then raise exception 'INTERACTIVE_RLS_LEAK'; end if;
end $$;
reset role;

set local role authenticated;
do $$
declare fixture record; state jsonb; saved jsonb; question jsonb; aid uuid;
  lid uuid:=current_setting('homework.test.lecture')::uuid; qid uuid:=gen_random_uuid();
begin
  for fixture in select key,value from jsonb_each(current_setting('interactive.test.fixtures')::jsonb) loop
    perform set_config('request.jwt.claim.sub',current_setting('teaching.test.admin'),true);
    state:=public.get_homework_document('lecture',lid);
    question:=jsonb_build_object('id',qid,'label','1','group','基础','content',fixture.key,'answer','','composition',fixture.value,'answerComposition',fixture.value,'sourceQuestionId',null);
    saved:=public.save_homework_document('lecture',lid,state->>'revision',(state->'document')||jsonb_build_object('questions',jsonb_build_array(question)));
    if saved#>'{document,questions,0,composition}' is distinct from fixture.value then raise exception 'COMPONENT_ROUNDTRIP_FAILED: %',fixture.key; end if;
    perform set_config('request.jwt.claim.sub',current_setting('teaching.test.teacher'),true);
    aid:=public.publish_session_template_assignment(current_setting('teaching.test.session')::uuid,'Component copy','',null);
    state:=public.get_homework_document('assignment',aid);
    if state#>'{document,questions,0,composition}' is distinct from fixture.value then raise exception 'COMPONENT_COPY_FAILED: %',fixture.key; end if;
    if fixture.key='image' then
      begin
        perform public.save_homework_document('assignment',aid,state->>'revision',jsonb_set(state->'document','{questions,0,composition,overlay,nodes,0,resources,0,bindingKey}',to_jsonb(repeat('b',64))));
        raise exception 'UNREADABLE_ASSET_ALLOWED';
      exception when others then if sqlerrm<>'VALIDATION' then raise; end if; end;
    end if;
  end loop;
end $$;
reset role;
