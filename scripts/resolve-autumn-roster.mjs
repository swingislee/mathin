import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {parseArgs} from 'node:util';
import {openHistoryLocalTarget} from './lib/history-local-target.mjs';
import {textFileSha256} from './lib/text-hash.mjs';
import {loadFixedAccount} from '../e2e/support/fixed-accounts.ts';

const {values}=parseArgs({options:{run:{type:'string'},mode:{type:'string'}}});
if(!values.run||!['check','apply','verify'].includes(values.mode))throw new Error('Use --run <private-directory> --mode check|apply|verify');
const root=path.resolve(values.run);
if(!root.startsWith(`${path.resolve('.tmp')}${path.sep}`))throw new Error('PRIVATE_RUN_DIRECTORY_REQUIRED');
const read=file=>JSON.parse(fs.readFileSync(path.join(root,file),'utf8'));
const write=(file,data)=>fs.writeFileSync(path.join(root,file),JSON.stringify(data,null,2));
const q=value=>`'${String(value).replaceAll("'","''")}'`;
const list=values=>values.map(q).join(',');
const digest=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const decisions=read('decisions.json'),snapshot=read('target-snapshot.json'),dependencies=read('dependencies.json');
assert.equal(decisions.version,1);
assert.ok(decisions.confirmedBy&&decisions.evidence&&decisions.retirementReason);
assert.ok(decisions.retirements.length&&decisions.confirmations.length);
const uuids=[...decisions.retirements.map(row=>row.studentId),...decisions.confirmations.map(row=>row.studentId)];
assert.equal(new Set(uuids).size,uuids.length);
for(const id of uuids)assert.match(id,/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/u);
for(const file of decisions.sourceFiles)assert.equal(digest(fs.readFileSync(path.resolve(file.path))),file.sha256,'SOURCE_BYTES_CHANGED');
const sources=decisions.confirmations.flatMap(row=>row.sourceIds);
const leadIds=decisions.confirmations.flatMap(row=>row.leadIds);
const enrollmentIds=decisions.confirmations.map(row=>row.enrollmentId);
const retiredIds=decisions.retirements.map(row=>row.membershipId);
const renamed=decisions.confirmations.filter(row=>row.expectedName!==row.canonicalName);
assert.equal(new Set(sources).size,sources.length);
assert.equal(new Set(leadIds).size,leadIds.length);
for(const decision of [...decisions.retirements,...decisions.confirmations]){
  const student=snapshot.students.find(row=>row.row.id===decision.studentId)?.row;
  assert.ok(student&&!student.deleted_at&&!student.user_id&&student.name===decision.expectedName,'STUDENT_SCOPE_CHANGED');
  const membership=snapshot.enrollments.find(row=>row.id===decision.membershipId);
  assert.ok(membership&&membership.student_id===student.id&&membership.classroom_id===decision.classroomId&&membership.status==='active','MEMBERSHIP_SCOPE_CHANGED');
  assert.equal(membership.term_id,snapshot.school_terms[0].id);
}
for(const decision of decisions.confirmations){
  assert.ok(decision.canonicalName&&decision.sourceNames.length&&decision.sourceIds.includes(decision.sourceId));
  const enrollment=dependencies.course_enrollments.find(row=>row.id===decision.enrollmentId);
  assert.ok(enrollment&&enrollment.source_record_id===decision.sourceId&&enrollment.student_id===null&&enrollment.record_state==='current'&&enrollment.status==='active');
  assert.equal(enrollment.registered_on,null);
  for(const sourceId of decision.sourceIds){
    const source=snapshot.history_import_records.find(row=>row.id===sourceId);
    assert.ok(source&&source.student_id===null&&source.lead_id===null&&source.record_data.names.length===1&&decision.sourceNames.includes(source.record_data.names[0]),'SOURCE_IDENTITY_SCOPE_CHANGED');
    assert.ok(!snapshot.history_import_associations.some(row=>row.record_id===sourceId),'SOURCE_ALREADY_ASSOCIATED');
  }
  const primary=snapshot.history_import_records.find(row=>row.id===decision.sourceId);
  assert.equal(primary.record_data.tableName,'2026秋季在读学员表格');
  assert.equal(primary.record_data.cells.find(row=>row.fieldName==='26秋在读')?.text.trim(),'是');
  const dateSource=snapshot.history_import_records.find(row=>row.id===decision.dateSourceId);
  assert.ok(decision.sourceIds.includes(dateSource?.id),'REGISTRATION_DATE_SOURCE_REQUIRED');
  const originalDate=dateSource.record_data.cells.find(row=>row.fieldName==='报名日期')?.text.trim().replaceAll('/','-');
  assert.equal(originalDate,decision.registeredOn);
  for(const leadId of decision.leadIds){
    const lead=snapshot.leads.find(row=>row.id===leadId);
    assert.ok(lead&&lead.student_id===null&&decision.sourceIds.includes(lead.source_record_id)&&decision.sourceNames.includes(lead.provisional_student_name),'LEAD_SCOPE_CHANGED');
  }
}
const target=openHistoryLocalTarget({attestationPath:path.join(root,'write-target.json'),refresh:true,errorFile:path.join(root,'database-error.txt')});
const runtimeFunctions=JSON.parse(target.sql("begin read only;select jsonb_agg(jsonb_build_object('proname',p.proname,'definition',pg_get_functiondef(p.oid)) order by p.proname) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('confirm_history_source','assign_course_enrollment','withdraw_student');commit;"));
assert.deepEqual(runtimeFunctions,snapshot.functions.filter(row=>['confirm_history_source','assign_course_enrollment','withdraw_student'].includes(row.proname)).sort((a,b)=>a.proname.localeCompare(b.proname)),'RUNTIME_FUNCTION_CHANGED');
const account=loadFixedAccount('admin');if(!account)throw new Error('FIXED_ADMIN_REQUIRED');
const actor=target.sql(`begin read only;select p.id from public.profiles p join auth.users u on u.id=p.id where p.role='admin' and p.is_active and p.account_status='active' and u.email=${q(account.email)};commit;`);
assert.match(actor,/^[0-9a-f-]{36}$/u);
const claims=`select set_config('request.jwt.claims',jsonb_build_object('sub',${q(actor)},'role','authenticated')::text,true);`;
const verification=decisions.retirements.map(row=>`if not exists(select 1 from public.enrollments where id=${q(row.membershipId)} and student_id=${q(row.studentId)} and status='withdrawn' and left_at is not null) then raise exception 'OLD_MEMBERSHIP_REMAINS';end if;`)
  .concat(decisions.confirmations.flatMap(row=>[
    `if not exists(select 1 from public.students where id=${q(row.studentId)} and name=${q(row.canonicalName)} and deleted_at is null) then raise exception 'CANONICAL_NAME_MISMATCH';end if;`,
    ...row.sourceIds.map(id=>`if not exists(select 1 from public.history_import_associations where record_id=${q(id)} and student_id=${q(row.studentId)} and version=1) then raise exception 'SOURCE_ASSOCIATION_MISSING';end if;`),
    ...row.leadIds.map(id=>`if not exists(select 1 from public.leads where id=${q(id)} and student_id=${q(row.studentId)} and status='converted' and identity_confirmed_by=${q(actor)}) then raise exception 'LEAD_IDENTITY_MISSING';end if;`),
    `if not exists(select 1 from public.course_enrollments where id=${q(row.enrollmentId)} and student_id=${q(row.studentId)} and term_id=${q(snapshot.school_terms[0].id)} and registered_on=${q(row.registeredOn)}::date and source_record_id=${q(row.sourceId)}) then raise exception 'ENROLLMENT_IDENTITY_MISSING';end if;`,
    `if (select count(*) from public.course_enrollment_assignments where course_enrollment_id=${q(row.enrollmentId)} and status='active')<>1 or not exists(select 1 from public.course_enrollment_assignments where course_enrollment_id=${q(row.enrollmentId)} and classroom_id=${q(row.classroomId)} and classroom_membership_id=${q(row.membershipId)} and status='active') then raise exception 'EXISTING_MEMBERSHIP_NOT_LINKED';end if;`,
  ])).join('\n');
const resultSql=`select jsonb_build_object('verified',true,'retiredMemberships',${retiredIds.length},'linkedStudents',${decisions.confirmations.length},'sourceAssociations',${sources.length},'linkedLeads',${leadIds.length},'renamedStudents',${renamed.length},'activeRoster',(select count(*) from public.enrollments e join public.classrooms c on c.id=e.classroom_id where e.status='active' and c.purpose='production' and c.term_id=${q(snapshot.school_terms[0].id)}));`;
if(values.mode==='verify'){
  const result=JSON.parse(target.sql(`begin read only;do $verify$ begin ${verification} end $verify$;${resultSql}commit;`));
  write('postflight.json',{...result,verifiedAt:new Date().toISOString(),target:target.observed});console.log(JSON.stringify(result));process.exit(0);
}
if(fs.existsSync(path.join(root,'applied.json')))throw new Error('BATCH_ALREADY_APPLIED_USE_VERIFY');
const checkKey={decisions:textFileSha256(path.join(root,'decisions.json')),snapshot:textFileSha256(path.join(root,'target-snapshot.json')),dependencies:textFileSha256(path.join(root,'dependencies.json')),runner:textFileSha256('scripts/resolve-autumn-roster.mjs')};
if(values.mode==='apply')assert.deepEqual(read('check.json').checkKey,checkKey,'CHECK_REQUIRED_FOR_EXACT_INPUT');
const changed=new Map([
  ['students',renamed.map(row=>row.studentId)],['enrollments',retiredIds],['leads',leadIds],['course_enrollments',enrollmentIds],
  ...['activity_registrations','assessment_results','course_opportunities','activity_routes'].map(table=>[table,(dependencies[table]??[]).filter(row=>sources.includes(row.source_record_id)||leadIds.includes(row.lead_id)).map(row=>row.id)]),
]);
const immutableTables=['profiles','classrooms','class_sessions','session_attendance','session_roster_entries','classroom_members','student_guardians','student_follow_ups','student_grade_history','student_school_year_grades','activities','lead_communications','lead_source_records','history_import_records','history_import_files','families','contacts','student_accounts','orders','lesson_ledger','assessment_reports','assessment_workflow_states','assessment_quick_entries','student_profile_review_items','student_profile_review_responses'];
const filtered=[...changed].map(([table,ids])=>[table,ids.length?`where id not in (${list(ids)})`:'']);
const appended=[['history_import_associations',`where record_id not in (${list(sources)})`],['history_import_association_events',`where record_id not in (${list(sources)})`],['course_enrollment_events',`where course_enrollment_id not in (${list(enrollmentIds)})`],['domain_events',`where entity_id not in (${list(enrollmentIds)})`]];
const fingerprint=[...immutableTables.map(name=>[name,'']),...filtered,...appended,['auth.users','']].map(([table,filter])=>`select ${q(table)} relation,count(*) n,md5(coalesce(string_agg(md5(to_jsonb(r)::text),'' order by md5(to_jsonb(r)::text)),'')) digest from ${table==='auth.users'?table:`public.${table}`} r ${filter}`).join(' union all ');
const rowCheck=(table,id,before)=>`select 1 from public.${table} where id=${q(id)} for update;do $before$ begin if (select to_jsonb(r) from public.${table} r where id=${q(id)}) is distinct from ${q(JSON.stringify(before))}::jsonb then raise exception 'EXPECTED_ROW_CHANGED:${table}';end if;end $before$;`;
const locks=snapshot.students.map(row=>`select 1 from public.students where id=${q(row.row.id)} for update;do $student$ begin if (select md5(to_jsonb(r)::text) from public.students r where id=${q(row.row.id)})<>${q(row.digest)} then raise exception 'EXPECTED_STUDENT_CHANGED';end if;end $student$;`)
  .concat(snapshot.enrollments.map(row=>rowCheck('enrollments',row.id,row)))
  .concat([...changed].filter(([table])=>!['students','enrollments'].includes(table)).flatMap(([table,ids])=>ids.map(id=>rowCheck(table,id,(table==='leads'?snapshot.leads:dependencies[table]).find(row=>row.id===id)))))
  .concat(sources.map(id=>{const source=snapshot.history_import_records.find(row=>row.id===id);return `select 1 from public.history_import_records where id=${q(id)} for update;do $source$ begin if not exists(select 1 from public.history_import_records where id=${q(id)} and payload_sha256=${q(source.payload_sha256)} and student_id is null and lead_id is null) or exists(select 1 from public.history_import_associations where record_id=${q(id)}) then raise exception 'EXPECTED_SOURCE_CHANGED';end if;end $source$;`;})).join('\n');
const operations=decisions.retirements.map(row=>`select public.withdraw_student(${q(row.membershipId)},${q(decisions.retirementReason)});`)
  .concat(decisions.confirmations.flatMap(row=>[
    ...row.sourceIds.map(id=>`select public.confirm_history_source(${q(id)},${q(row.studentId)},0,${q(id===row.sourceId?'enrollment':'student_profile')});`),
    ...row.leadIds.map(id=>`update public.leads set student_id=${q(row.studentId)},status='converted',identity_confirmed_by=${q(actor)},identity_confirmed_at=clock_timestamp() where id=${q(id)};`),
    `update public.course_enrollments set term_id=${q(snapshot.school_terms[0].id)},registered_on=${q(row.registeredOn)}::date,note=concat_ws(E'\n',nullif(note,''),${q(`报名日期沿用已确认同一学生的来源报名日期 ${row.registeredOn}；本次关联沿用已有秋季花名册。`)}) where id=${q(row.enrollmentId)};`,
    `select public.assign_course_enrollment(${q(row.enrollmentId)},${q(row.classroomId)},'按产品负责人确认关联已有秋季花名册。',clock_timestamp());`,
  ]))
  .concat(renamed.map(row=>`update public.students set name=${q(row.canonicalName)},remark=concat_ws(E'\n',nullif(remark,''),${q(`正式姓名由产品负责人确认：${row.canonicalName}（原登记名${row.expectedName}，${decisions.confirmedOn}）。`)}) where id=${q(row.studentId)};`)).join('\n');
const statement=`begin isolation level repeatable read;set local lock_timeout='5s';set local statement_timeout='90s';
select pg_advisory_xact_lock(hashtextextended('autumn-roster-explicit-resolution',0));
${locks}
create temp table preserved_before on commit drop as ${fingerprint};
create temp table assignment_before on commit drop as select id,md5(to_jsonb(r)::text) digest from public.course_enrollment_assignments r;
create temp table functions_before on commit drop as select p.oid,md5(pg_get_functiondef(p.oid)) digest from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('confirm_history_source','assign_course_enrollment','withdraw_student');
${claims}
do $permission$ begin if not public.has_perm(auth.uid(),'student.edit') or not public.has_perm(auth.uid(),'enrollment.manage') then raise exception 'FORBIDDEN';end if;end $permission$;
${operations}
create temp table preserved_after on commit drop as ${fingerprint};
do $verify$ begin
if exists((select * from preserved_before except select * from preserved_after) union all(select * from preserved_after except select * from preserved_before)) then raise exception 'PRESERVED_DATA_CHANGED';end if;
if exists(select 1 from assignment_before b left join public.course_enrollment_assignments r on r.id=b.id where r.id is null or md5(to_jsonb(r)::text)<>b.digest) then raise exception 'EXISTING_ASSIGNMENTS_CHANGED';end if;
if (select count(*) from public.course_enrollment_assignments where id not in(select id from assignment_before))<>${enrollmentIds.length} then raise exception 'UNEXPECTED_ASSIGNMENT_INSERT';end if;
if exists(select 1 from public.course_enrollment_assignments where id not in(select id from assignment_before) and course_enrollment_id not in (${list(enrollmentIds)})) then raise exception 'OTHER_STUDENT_ASSIGNMENT_INSERT';end if;
if exists(select 1 from functions_before f join pg_proc p on p.oid=f.oid where md5(pg_get_functiondef(p.oid))<>f.digest) then raise exception 'FUNCTION_CHANGED';end if;
${verification}
end $verify$;
${resultSql}
${values.mode==='check'?'rollback;':'commit;'}`;
fs.writeFileSync(path.join(root,`${values.mode}-transaction.sql`),statement,'utf8');
if(values.mode==='check')write('before.json',{capturedAt:new Date().toISOString(),checkKey,students:snapshot.students.map(row=>({row:{...row.row,bind_code:undefined},digest:row.digest})),enrollments:snapshot.enrollments,rows:Object.fromEntries([...changed].filter(([table])=>!['students','enrollments'].includes(table)).map(([table,ids])=>[table,(table==='leads'?snapshot.leads:dependencies[table]??[]).filter(row=>ids.includes(row.id))]))});
const output=target.sql(statement);
const result=JSON.parse(output.split(/\r?\n/u).findLast(line=>line.startsWith('{')));
if(values.mode==='check'){
  target.sql(`begin read only;${snapshot.students.map(row=>`do $rollback$ begin if (select md5(to_jsonb(r)::text) from public.students r where id=${q(row.row.id)})<>${q(row.digest)} then raise exception 'ROLLBACK_STUDENT_CHANGED';end if;end $rollback$;`).join('\n')}${snapshot.enrollments.map(row=>`do $rollback$ begin if (select to_jsonb(r) from public.enrollments r where id=${q(row.id)}) is distinct from ${q(JSON.stringify(row))}::jsonb then raise exception 'ROLLBACK_MEMBERSHIP_CHANGED';end if;end $rollback$;`).join('\n')}do $rollback$ begin if exists(select 1 from public.history_import_associations where record_id in (${list(sources)})) then raise exception 'ROLLBACK_ASSOCIATION_REMAINS';end if;end $rollback$;commit;`);
}
const report={...result,checkKey,mode:values.mode,checkedAt:new Date().toISOString(),target:target.observed,preservedDataUnchanged:true,sourceOriginalsUnchanged:true,rollbackVerified:values.mode==='check'};
write(values.mode==='check'?'check.json':'applied.json',report);console.log(JSON.stringify(report));
