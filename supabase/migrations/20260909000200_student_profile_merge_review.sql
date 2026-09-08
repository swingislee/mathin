-- 学生档案合并：只读预览、版本化确认、完整原记录审计；碰撞事实保持原样等待核对。
create table public.student_merge_audits (
 id uuid primary key default gen_random_uuid(), kept_id uuid not null references public.students(id),
 merged_id uuid not null references public.students(id), actor_id uuid not null references public.profiles(id),
 transaction_id bigint not null default txid_current(), reason text not null check(length(reason) between 1 and 2000),
 field_choices jsonb not null, before_snapshot jsonb not null, after_snapshot jsonb,
 created_at timestamptz not null default clock_timestamp(), applied_at timestamptz,
 check(kept_id<>merged_id), unique(merged_id)
);
alter table public.student_merge_audits enable row level security;
revoke all on public.student_merge_audits from public,anon,authenticated,service_role;
create policy student_merge_audit_scope on public.student_merge_audits for select to authenticated using
  (public.has_perm(auth.uid(),'student.edit') and public.can_access_student(kept_id,auth.uid()));

create function mathin_internal.student_merge_relations()
returns table(table_name text,column_name text,category text,mode text,ordinal integer)
language sql immutable security definer set search_path=public,pg_temp as $$
 values ('account_ledger','student_id','finance','move',100),
 ('activity_registrations','student_id','assessment','move',101),
 ('activity_routes','student_id','assessment','move',102),
 ('assessment_results','student_id','assessment','move',103),
 ('classroom_student_seat_order','student_id','teaching','move',104),
 ('class_support_task_recipients','student_id','work','move',105),
 ('class_support_tasks','student_id','work','move',106),
 ('consent_records','student_id','family','archive',107),
 ('coupon_grants','student_id','finance','move',108),
 ('course_enrollments','student_id','enrollment','move',109),
 ('course_opportunities','student_id','enrollment','move',110),
 ('enrollments','student_id','enrollment','move',111),
 ('family_students','student_id','family','dedupe',112),
 ('guardian_bind_invitations','student_id','family','move',113),
 ('guardian_consents','student_id','family','move',114),
 ('history_import_associations','student_id','source','move',10),
 ('history_import_identity_candidates','student_id','source','archive',116),
 ('history_import_records','student_id','source','archive',117),
 ('history_workflow_scopes','student_id','source','move',118),
 ('lead_identity_conversions','student_id','source','archive',119),
 ('lead_import_row_reviews','suggested_student_id','communication','move',120),
 ('leads','student_id','communication','move',20),
 ('leads','suggested_student_id','communication','move',122),
 ('learning_result_heads','student_id','teaching','move',123),
 ('lesson_ledger','student_id','finance','move',124),
 ('orders','student_id','finance','move',125),
 ('sales_opportunities','student_id','assessment','move',126),
 ('scholarships','student_id','finance','move',127),
 ('school_support_change_log','student_id','work','archive',128),
 ('school_support_work_items','student_id','work','move',129),
 ('session_attendance','student_id','teaching','move',130),
 ('session_changes','student_id','teaching','move',131),
 ('session_learning_check_results','student_id','teaching','move',132),
 ('session_leave_requests','student_id','teaching','move',133),
 ('session_reviews','student_id','teaching','move',134),
 ('session_roster_entries','student_id','teaching','archive',135),
 ('session_videos','student_id','teaching','move',136),
 ('student_accounts','student_id','finance','account',137),
 ('student_contacts','student_id','family','dedupe',138),
 ('student_follow_ups','student_id','communication','move',139),
 ('student_grade_history','student_id','source','dedupe',140),
 ('student_guardians','student_id','family','dedupe',141),
 ('student_merges','merged_id','source','archive',142),
 ('student_merges','kept_id','source','archive',143),
 ('student_referrals','referrer_student_id','teaching','move',144),
 ('student_school_year_grades','student_id','teaching','dedupe',145),
 ('teacher_professional_signals','student_id','teaching','move',146),
 ('student_merge_audits','kept_id','source','ignore',1000),
 ('student_merge_audits','merged_id','source','ignore',1001)
$$;

create function mathin_internal.student_merge_running(p_old uuid,p_new uuid)
returns boolean language sql volatile security definer set search_path=public,pg_temp as $$
 select exists(select 1 from public.student_merge_audits where merged_id=p_old and kept_id=p_new and actor_id=auth.uid()
   and transaction_id=txid_current() and applied_at is null)
$$;

create function mathin_internal.student_merge_display(p jsonb)
returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
 select jsonb_build_object('id',p->'id','owner',coalesce((select display_name from profiles where id=(p->>'assigned_to')::uuid),''),
  'createdAt',p->'created_at','values',jsonb_build_object('name',p->'name','grade',p->'grade','phone',p->'phone',
  'parentPhone',p->'parent_phone','parentName',p->'parent_name','school',p->'school','wechat',p->'wechat',
  'region',p->'region','source',p->'source','remark',p->'remark','status',p->'status'))
$$;

create function mathin_internal.student_merge_snapshot(p_kept uuid,p_merged uuid,p_lock boolean default false,p_users uuid[] default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare relation record; rows jsonb; result jsonb; targets uuid[]:=array[p_kept,p_merged]; users uuid[];
begin
 select coalesce(p_users,array_agg(user_id) filter(where user_id is not null)) into users from public.students where id=any(targets);
 result:=jsonb_build_object('kept',(select to_jsonb(s) from public.students s where id=p_kept),
   'merged',(select to_jsonb(s) from public.students s where id=p_merged),'users',to_jsonb(coalesce(users,'{}'::uuid[])),'relations','{}'::jsonb);
 for relation in select * from mathin_internal.student_merge_relations() where mode<>'ignore' order by ordinal loop
   if p_lock then execute format('select 1 from public.%I where %I=any($1) for update',relation.table_name,relation.column_name) using targets; end if;
   execute format($query$select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) from public.%I t where %I=any($1)$query$,relation.table_name,relation.column_name) into rows using targets;
   result:=jsonb_set(result,array['relations',relation.table_name||'.'||relation.column_name],rows);
 end loop;
 if p_lock then perform 1 from public.classroom_members where user_id=any(users) for update; end if;
 result:=result||jsonb_build_object('classroomMembers',(select coalesce(jsonb_agg(to_jsonb(m) order by to_jsonb(m)::text),'[]'::jsonb) from public.classroom_members m where user_id=any(users)));
 return result;
end $$;

create function mathin_internal.student_merge_same_metadata(p_left jsonb,p_right jsonb,p_column text)
returns boolean language sql immutable set search_path=public,pg_temp as $$
 select (p_left-array[p_column,'created_at','updated_at','recorded_at','recorded_by'])
   = (p_right-array[p_column,'created_at','updated_at','recorded_at','recorded_by'])
$$;

create function mathin_internal.student_merge_review(p_kept uuid,p_merged uuid,p_snapshot jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare relation record; idx record; refs record; other_keys text; clause text; skip_equal text; collision boolean; rows jsonb;
 blockers jsonb:='[]'; counts jsonb:='{}'; keep_count integer; source_count integer; category_counts jsonb; att smallint;
 accounts jsonb; can_finance boolean:=public.has_perm(auth.uid(),'finance.account.adjust'); financial_rows boolean:=false;
begin
 if p_snapshot->'kept'->>'user_id' is not null and p_snapshot->'merged'->>'user_id' is not null
   and p_snapshot->'kept'->>'user_id'<>p_snapshot->'merged'->>'user_id' then blockers:=blockers||jsonb_build_array(jsonb_build_object('kind','accounts','category','family')); end if;
 for relation in select * from mathin_internal.student_merge_relations() where mode<>'ignore' order by ordinal loop
   rows:=p_snapshot->'relations'->(relation.table_name||'.'||relation.column_name);
   select count(*) filter(where r->>relation.column_name=p_kept::text),count(*) filter(where r->>relation.column_name=p_merged::text) into keep_count,source_count from jsonb_array_elements(rows) r;
   if relation.category='finance' and source_count>0 and relation.mode<>'account' then financial_rows:=true; end if;
   category_counts:=coalesce(counts->relation.category,jsonb_build_object('kept',0,'merged',0,'preserved',0));
   counts:=jsonb_set(counts,array[relation.category],jsonb_build_object('kept',(category_counts->>'kept')::integer+keep_count,
     'merged',(category_counts->>'merged')::integer+source_count,'preserved',(category_counts->>'preserved')::integer+case when relation.mode='archive' then source_count else 0 end));
   if relation.mode in ('archive','account') or source_count=0 then continue; end if;
   select attnum into att from pg_attribute where attrelid=format('public.%I',relation.table_name)::regclass and attname=relation.column_name;
   skip_equal:=case when relation.mode='dedupe' then format(' and not exists(select 1 from public.%I same where same.%I=$1 and mathin_internal.student_merge_same_metadata(to_jsonb(a),to_jsonb(same),%L))',relation.table_name,relation.column_name,relation.column_name) else '' end;
   for idx in select i.*,pg_get_expr(i.indpred,i.indrelid) predicate from pg_index i where i.indrelid=format('public.%I',relation.table_name)::regclass and i.indisunique and att=any(i.indkey) loop
     select string_agg(format('a.%I %s b.%I',a.attname,case when idx.indnullsnotdistinct then 'is not distinct from' else '=' end,a.attname),' and ') into other_keys
       from unnest(idx.indkey::smallint[]) with ordinality k(n,o) join pg_attribute a on a.attrelid=idx.indrelid and a.attnum=k.n where k.o<=idx.indnkeyatts and k.n<>att;
     clause:=format('with eligible as(select * from public.%I where %s) select exists(select 1 from eligible a join eligible b on %s where a.%I=$2 and b.%I=$1%s)',
       relation.table_name,coalesce(idx.predicate,'true'),coalesce(other_keys,'true'),relation.column_name,relation.column_name,skip_equal);
     execute clause into collision using p_kept,p_merged;
     if collision then blockers:=blockers||jsonb_build_array(jsonb_build_object('kind','overlap','category',relation.category,'recordType',relation.table_name)); exit; end if;
   end loop;
 end loop;
 select jsonb_object_agg(side,jsonb_build_object('balance',coalesce((account->>'balance')::numeric,0),'lessons',coalesce((account->>'lesson_balance')::numeric,0))) into accounts from (
   select side,(select r from jsonb_array_elements(p_snapshot->'relations'->'student_accounts.student_id') r
     where r->>'student_id'=case when side='kept' then p_kept else p_merged end::text limit 1) account
   from unnest(array['kept','merged']) side
 ) balances;
 if not can_finance and (financial_rows or (accounts->'merged'->>'balance')::numeric<>0 or (accounts->'merged'->>'lessons')::numeric<>0) then
   blockers:=blockers||jsonb_build_array(jsonb_build_object('kind','finance','category','finance'));
 end if;
 -- 新增学生外键有实际记录时先补齐合并合同，避免新模块被漏挂。
 for refs in select c.conrelid::regclass rel,a.attname col from pg_constraint c join pg_attribute a on a.attrelid=c.conrelid and a.attnum=any(c.conkey)
   where c.contype='f' and c.confrelid='public.students'::regclass and not exists(select 1 from mathin_internal.student_merge_relations() r
     where format('public.%I',r.table_name)::regclass=c.conrelid and r.column_name=a.attname) loop
   execute format('select exists(select 1 from %s where %I=$1)',refs.rel,refs.col) into collision using p_merged;
   if collision then blockers:=blockers||jsonb_build_array(jsonb_build_object('kind','unsupported','category','source')); end if;
 end loop;
 return jsonb_build_object('kept',mathin_internal.student_merge_display(p_snapshot->'kept'),'merged',mathin_internal.student_merge_display(p_snapshot->'merged'),
   'token',md5(p_snapshot::text),'counts',counts,'blockers',blockers,'accounts',case when can_finance then accounts else null end);
end $$;

create function public.preview_student_merge(p_kept_id uuid,p_merged_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare snapshot jsonb;
begin
 if auth.uid() is null or not public.is_staff(auth.uid()) or not public.has_perm(auth.uid(),'student.edit') then raise exception 'FORBIDDEN'; end if;
 if p_kept_id=p_merged_id then raise exception 'SAME_STUDENT'; end if;
 if not public.can_access_student(p_kept_id,auth.uid()) or not public.can_access_student(p_merged_id,auth.uid()) then raise exception 'FORBIDDEN_SCOPE'; end if;
 if (select count(*) from public.students where id in(p_kept_id,p_merged_id) and deleted_at is null)<>2 then raise exception 'STUDENT_DELETED'; end if;
 if exists(select 1 from public.student_merges where merged_id in(p_kept_id,p_merged_id)) then raise exception 'ALREADY_MERGED'; end if;
 snapshot:=mathin_internal.student_merge_snapshot(p_kept_id,p_merged_id);
 return mathin_internal.student_merge_review(p_kept_id,p_merged_id,snapshot);
end $$;

create function public.confirm_student_merge(p_kept_id uuid,p_merged_id uuid,p_expected_token text,p_choices jsonb,p_reason text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare before_data jsonb; reviewed jsonb; relation record; entry record; target_values jsonb:='{}'; selected jsonb;
  audit_id uuid:=gen_random_uuid(); field text; column_name text; skip_equal text; users uuid[];
  source_account public.student_accounts%rowtype; kept_user uuid; source_user uuid; completed public.student_merge_audits%rowtype;
  mapping jsonb:='{"name":"name","grade":"grade","phone":"phone","parentPhone":"parent_phone","parentName":"parent_name","school":"school","wechat":"wechat","region":"region","source":"source","remark":"remark","status":"status"}';
begin
 if auth.uid() is null or not public.is_staff(auth.uid()) or not public.has_perm(auth.uid(),'student.edit') then raise exception 'FORBIDDEN'; end if;
 if p_kept_id=p_merged_id then raise exception 'SAME_STUDENT'; end if;
 select * into completed from public.student_merge_audits where kept_id=p_kept_id and merged_id=p_merged_id and actor_id=auth.uid() and applied_at is not null;
 if found and public.can_access_student(p_kept_id,auth.uid()) and p_expected_token=md5(completed.before_snapshot::text)
   and p_choices=completed.field_choices and btrim(p_reason)=completed.reason then
   return jsonb_build_object('keptId',p_kept_id,'mergedId',p_merged_id,'mergeId',completed.id);
 end if;
 if not public.can_access_student(p_kept_id,auth.uid()) or not public.can_access_student(p_merged_id,auth.uid()) then raise exception 'FORBIDDEN_SCOPE'; end if;
 if p_expected_token is null or length(p_expected_token)<>32 or p_reason is null or length(btrim(p_reason)) not between 1 and 2000
   or jsonb_typeof(p_choices) is distinct from 'object' or p_choices-array(select jsonb_object_keys(mapping))<>'{}'::jsonb
   or exists(select 1 from jsonb_each_text(p_choices) c where c.value not in ('kept','merged')) then raise exception 'VALIDATION'; end if;
 perform 1 from public.students where id in(p_kept_id,p_merged_id) order by id for update;
 if (select count(*) from public.students where id in(p_kept_id,p_merged_id) and deleted_at is null)<>2 then raise exception 'STUDENT_DELETED'; end if;
 if exists(select 1 from public.student_merges where merged_id in(p_kept_id,p_merged_id)) then raise exception 'ALREADY_MERGED'; end if;
 before_data:=mathin_internal.student_merge_snapshot(p_kept_id,p_merged_id,true);
 if md5(before_data::text)<>p_expected_token then raise exception 'MERGE_CHANGED'; end if;
 reviewed:=mathin_internal.student_merge_review(p_kept_id,p_merged_id,before_data);
 if jsonb_array_length(reviewed->'blockers')>0 then raise exception 'MERGE_CONFLICT'; end if;
 insert into public.student_merge_audits(id,kept_id,merged_id,actor_id,reason,field_choices,before_snapshot)
   values(audit_id,p_kept_id,p_merged_id,auth.uid(),btrim(p_reason),p_choices,before_data);
 select array_agg(value::uuid) into users from jsonb_array_elements_text(before_data->'users');
 kept_user:=(before_data->'kept'->>'user_id')::uuid; source_user:=(before_data->'merged'->>'user_id')::uuid;
 for field,column_name in select key,value from jsonb_each_text(mapping) loop
   selected:=case when coalesce(p_choices->>field,case when nullif(before_data->'kept'->>column_name,'') is null then 'merged' else 'kept' end)='merged'
     then before_data->'merged'->column_name else before_data->'kept'->column_name end;
   target_values:=target_values||jsonb_build_object(column_name,selected);
 end loop;
 if nullif(btrim(target_values->>'name'),'') is null then raise exception 'VALIDATION'; end if;
 if source_user is not null then update public.students set user_id=null where id=p_merged_id; end if;
 update public.students set name=target_values->>'name',grade=(target_values->>'grade')::smallint,
   phone=target_values->>'phone',parent_phone=target_values->>'parent_phone',parent_name=target_values->>'parent_name',
   school=target_values->>'school',wechat=target_values->>'wechat',region=target_values->>'region',source=target_values->>'source',
   remark=target_values->>'remark',status=target_values->>'status',user_id=coalesce(kept_user,source_user) where id=p_kept_id;

 -- 原始导入凭据保持原样；当前归属由带版本的关联与独立合并审计说明。
 for entry in select h.id,to_jsonb(a) previous from public.history_import_records h
   left join public.history_import_associations a on a.record_id=h.id
   where coalesce(a.student_id,h.student_id)=p_merged_id order by h.id loop
   insert into public.history_import_associations(record_id,student_id,version,context,confirmed_by)
     values(entry.id,p_kept_id,coalesce((entry.previous->>'version')::integer,0)+1,'student_profile',auth.uid())
     on conflict(record_id) do update set student_id=excluded.student_id,version=excluded.version,context=excluded.context,
       confirmed_by=excluded.confirmed_by,confirmed_at=clock_timestamp();
   insert into public.history_import_association_events(record_id,before_data,after_data,recorded_by)
     values(entry.id,coalesce(entry.previous,'{}'::jsonb),(select to_jsonb(a) from public.history_import_associations a where a.record_id=entry.id),auth.uid());
 end loop;
 for relation in select * from mathin_internal.student_merge_relations() where mode in ('move','dedupe') order by ordinal loop
   skip_equal:=case when relation.mode='dedupe' then format(' and not exists(select 1 from public.%I same where same.%I=$1 and mathin_internal.student_merge_same_metadata(to_jsonb(t),to_jsonb(same),%L))',relation.table_name,relation.column_name,relation.column_name) else '' end;
   execute format('update public.%I t set %I=$1 where t.%I=$2%s',relation.table_name,relation.column_name,relation.column_name,skip_equal) using p_kept_id,p_merged_id;
 end loop;
 -- 余额是账本投影。原账目全部保留，源投影归零并保存前后快照。
 select * into source_account from public.student_accounts where student_id=p_merged_id;
 if source_account.student_id is not null then
   insert into public.student_accounts(student_id,balance,lesson_balance)
     values(p_kept_id,source_account.balance,source_account.lesson_balance)
     on conflict(student_id) do update set balance=public.student_accounts.balance+excluded.balance,
       lesson_balance=public.student_accounts.lesson_balance+excluded.lesson_balance,updated_at=clock_timestamp();
   update public.student_accounts set balance=0,lesson_balance=0,updated_at=clock_timestamp() where student_id=p_merged_id;
 end if;
 update public.students set deleted_at=clock_timestamp() where id=p_merged_id;
 insert into public.student_merges(id,kept_id,merged_id,operated_by) values(audit_id,p_kept_id,p_merged_id,auth.uid());
 perform public.emit_domain_event('student.merged','student',p_kept_id,jsonb_build_object('mergedId',p_merged_id,'mergeId',audit_id),null,null);
 update public.student_merge_audits set after_snapshot=mathin_internal.student_merge_snapshot(p_kept_id,p_merged_id,false,users),
   applied_at=clock_timestamp() where id=audit_id;
 return jsonb_build_object('keptId',p_kept_id,'mergedId',p_merged_id,'mergeId',audit_id);
exception when unique_violation then raise exception 'MERGE_CONFLICT';
end $$;

create function public.search_student_merge_candidates(p_student_id uuid,p_query text)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare q text:=btrim(coalesce(p_query,'')); pattern text;
begin
 if auth.uid() is null or not public.is_staff(auth.uid()) or not public.has_perm(auth.uid(),'student.edit') then raise exception 'FORBIDDEN'; end if;
 if not public.can_access_student(p_student_id,auth.uid()) then raise exception 'FORBIDDEN_SCOPE'; end if;
 if length(q)>100 then raise exception 'VALIDATION'; end if;
 if q='' then return '[]'; end if;
 pattern:='%'||replace(replace(replace(q,'\','\\'),'%','\%'),'_','\_')||'%';
 return coalesce((select jsonb_agg(item) from (select mathin_internal.student_merge_display(to_jsonb(s)) item from public.students s
   left join public.profiles owner on owner.id=s.assigned_to
   where s.id<>p_student_id and s.deleted_at is null and public.can_access_student(s.id,auth.uid())
     and (concat_ws(' ',s.name,s.phone,s.parent_phone,s.parent_name,s.wechat,s.school,owner.display_name) ilike pattern or s.id::text=q)
   order by (s.name=q) desc,s.created_at desc,s.id limit 25) candidates),'[]');
end $$;

create function public.get_student_merge_history(p_student_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
 if auth.uid() is null or not public.is_staff(auth.uid()) or not public.has_perm(auth.uid(),'student.edit') then raise exception 'FORBIDDEN'; end if;
 if not public.can_access_student(p_student_id,auth.uid()) then raise exception 'FORBIDDEN_SCOPE'; end if;
 return coalesce((with recursive aliases(id) as (
   select p_student_id union select m.merged_id from public.student_merges m join aliases a on a.id=m.kept_id
 ) select jsonb_agg(item order by at desc) from (
   select a.applied_at at,jsonb_build_object('id',a.id,'keptId',a.kept_id,'mergedId',a.merged_id,'reason',a.reason,
     'at',a.applied_at,'actor',coalesce(p.display_name,''),'original',mathin_internal.student_merge_display(a.before_snapshot->'merged')) item
   from public.student_merge_audits a left join public.profiles p on p.id=a.actor_id
   where a.kept_id in(select id from aliases) and a.applied_at is not null order by a.applied_at desc limit 50
 ) rows),'[]');
end $$;

-- 旧的两参数入口不具备预览版本；统一由新的确认事务执行。
create or replace function public.merge_students(p_kept_id uuid,p_merged_id uuid)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin raise exception 'MERGE_PREVIEW_REQUIRED'; end $$;
CREATE OR REPLACE FUNCTION public.session_attendance_set_marker()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  if tg_op='UPDATE' then
    if old.student_id is distinct from new.student_id and (to_jsonb(new)-'student_id')=(to_jsonb(old)-'student_id') then
      if mathin_internal.student_merge_running(old.student_id,new.student_id) then return new; end if;
    end if;
  end if;
  new.marked_by := auth.uid();
  new.marked_at := now();
  return new;
end;
$function$;
CREATE OR REPLACE FUNCTION public.guard_finalized_assessment_workflow()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_row jsonb:=case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end; v_id uuid; v_finalized timestamptz;
begin
  if tg_op='UPDATE' and tg_table_name in ('assessment_results','activity_registrations') then
    if (to_jsonb(old)->>'student_id') is distinct from (to_jsonb(new)->>'student_id')
      and (to_jsonb(new)-'student_id'-'lead_id'-'updated_at'-'history_revision')=(to_jsonb(old)-'student_id'-'lead_id'-'updated_at'-'history_revision') then
      if mathin_internal.student_merge_running((to_jsonb(old)->>'student_id')::uuid,(to_jsonb(new)->>'student_id')::uuid) then return new; end if;
    end if;
  end if;
  if tg_table_name='public_class_participant_records'
    and nullif(btrim(v_row->>'assessment_summary'),'') is null
    and (tg_op<>'UPDATE' or nullif(btrim(to_jsonb(old)->>'assessment_summary'),'') is null)
    and not exists(select 1 from public.public_class_segments where id=(v_row->>'segment_id')::uuid and kind='group_assessment') then
    if tg_op='DELETE' then return old; end if;
    return new;
  end if;
  v_id:=coalesce(v_row->>'registration_id',v_row->>'activity_registration_id',case when tg_table_name='activity_registrations' then v_row->>'id' end)::uuid;
  if tg_table_name='lead_invitation_threads' then
    select r.id into v_id from public.activities a join public.activity_registrations r on r.activity_id=a.id
      where a.source_invitation_id=(v_row->>'id')::uuid and a.deleted_at is null limit 1;
  end if;
  select finalized_at into v_finalized from public.assessment_workflow_states where registration_id=v_id for update;
  if v_finalized is not null then raise exception 'ASSESSMENT_WORKFLOW_FINALIZED'; end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end $function$;
CREATE OR REPLACE FUNCTION public.bind_confirmed_source_business()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if tg_op='UPDATE' and old.student_id is distinct from new.student_id and not mathin_internal.student_merge_running(old.student_id,new.student_id) and (
    exists(select 1 from public.course_enrollment_assignments a join public.course_enrollments e on e.id=a.course_enrollment_id where e.source_record_id=new.record_id and a.classroom_id is not null)
    or exists(select 1 from public.assessment_reports report join public.activity_registrations r on r.id=report.registration_id where r.source_record_id=new.record_id)
  ) then raise exception 'SOURCE_IN_USE';end if;
  update public.activity_registrations set student_id=new.student_id,lead_id=null
    where source_record_id=new.record_id and student_id is distinct from new.student_id;
  update public.assessment_results set student_id=new.student_id,lead_id=null
    where source_record_id=new.record_id and student_id is distinct from new.student_id;
  update public.course_opportunities set student_id=new.student_id,lead_id=null
    where source_record_id=new.record_id and student_id is distinct from new.student_id;
  update public.course_enrollments set student_id=new.student_id
    where source_record_id=new.record_id and student_id is distinct from new.student_id;
  return new;
end;
$function$;
revoke all on function mathin_internal.student_merge_same_metadata(jsonb,jsonb,text),mathin_internal.student_merge_relations(),mathin_internal.student_merge_running(uuid,uuid),mathin_internal.student_merge_display(jsonb),
 mathin_internal.student_merge_snapshot(uuid,uuid,boolean,uuid[]),mathin_internal.student_merge_review(uuid,uuid,jsonb) from public,anon,authenticated,service_role;
-- 已有冻结校验函数由受信任的 postgres 角色持有；保留其 owner 与原有 ACL。
grant execute on function mathin_internal.student_merge_running(uuid,uuid) to postgres;
revoke all on function public.preview_student_merge(uuid,uuid),public.confirm_student_merge(uuid,uuid,text,jsonb,text),
 public.search_student_merge_candidates(uuid,text),public.get_student_merge_history(uuid) from public,anon,authenticated,service_role;
grant execute on function public.preview_student_merge(uuid,uuid),public.confirm_student_merge(uuid,uuid,text,jsonb,text),
 public.search_student_merge_candidates(uuid,text),public.get_student_merge_history(uuid) to authenticated;
notify pgrst,'reload schema';
