-- 仅用于已核对的隔离开发库与 P5-DEMO 种子；全部断言处于回滚事务。
begin;
do $$
declare c public.renewal_cycles%rowtype; o uuid; h jsonb; initial_students int; n int;
begin
 select * into c from public.renewal_cycles where name='P5验收 · 暑期衔接→秋季续报';
 perform set_config('request.jwt.claim.sub',c.created_by::text,true);
 select count(*) into initial_students from public.students;
 h:=public.get_renewal_health_facts(array['50500000-0905-4500-8500-000000000001'::uuid]);
 if jsonb_array_length(h)<>1 then raise exception 'HEALTH_SCOPE'; end if;
 o:=public.register_renewal_result(c.id,'50500000-0905-4500-8502-000000000002','considering','transaction test');
 if (select stage from public.course_opportunities where id=o)<>'considering' then raise exception 'CANDIDATE_REGISTER'; end if;
 perform public.register_renewal_result(c.id,'50500000-0905-4500-8502-000000000002','not_enrolled','transaction test');
 perform public.register_renewal_result(c.id,'50500000-0905-4500-8502-000000000002','payment_pending','transaction test');
 begin
   perform public.register_renewal_result(c.id,'50500000-0905-4500-8502-000000000002','enrolled','invalid',0,100);
   raise exception 'INVALID_PAYMENT_ACCEPTED';
 exception when others then if sqlerrm<>'VALIDATION' then raise; end if; end;
 perform public.register_renewal_result(c.id,'50500000-0905-4500-8502-000000000002','enrolled','transaction test',2,3200.50);
 select count(*) into n from public.course_enrollments where opportunity_id=o;
 perform public.register_renewal_result(c.id,'50500000-0905-4500-8502-000000000002','enrolled',repeat('"',2000),3,4800);
 if (select count(*) from public.course_enrollments where opportunity_id=o)<>n then raise exception 'DUPLICATE_ENROLLMENT'; end if;
 if (select period_count from public.renewal_registration_records where opportunity_id=o)<>3 then raise exception 'PAYMENT_UPDATE'; end if;
 if (select length(note) from public.renewal_registration_records where opportunity_id=o)<>2000 then raise exception 'NOTE_TRUNCATED'; end if;
 if (select count(*) from public.students)<>initial_students then raise exception 'IDENTITY_DUPLICATED'; end if;
 perform set_config('request.jwt.claim.sub','',true);
 begin
   perform public.get_renewal_health_facts(array['50500000-0905-4500-8500-000000000001'::uuid]);
   raise exception 'ANON_ALLOWED';
 exception when others then if sqlerrm<>'UNAUTHENTICATED' then raise; end if; end;
 raise notice 'Candidate registration, state transitions, payment validation/amendment, identity and anonymous checks passed';
end $$;
rollback;
