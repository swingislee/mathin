import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {openHistoryLocalTarget} from "./lib/history-local-target.mjs";

const output=path.resolve(".tmp/parent-portal");
const {observed}=openHistoryLocalTarget({attestationPath:path.join(output,"preflight.json"),errorFile:path.join(output,"database-error.txt")});
const origin="http://127.0.0.1:3130";
const videoIndex=process.argv.indexOf("--video");
const videoPath=videoIndex>=0?process.argv[videoIndex+1]:null;
if(videoIndex>=0)assert(videoPath&&fs.existsSync(videoPath),"Pass an existing synthetic MP4 after --video");
const password=fs.readFileSync(".claude/test-accounts.local.md","utf8").match(/\*\*统一密码：`([^`]+)`\*\*/)?.[1];
assert(password,"Fixed account password required");
async function api(resource,{method="GET",data,token,headers={}}={}){
  const response=await fetch(origin+"/api/v1/parent/"+resource,{method,headers:{...(data?{"Content-Type":"application/json"}:{}),...(token?{Authorization:`Bearer ${token}`} : {}),...headers},body:data?JSON.stringify(data):undefined});
  const body=await response.json();return {status:response.status,body};
}
async function signIn(email){const result=await api("auth",{method:"POST",data:{action:"login",identifier:email,password}});assert.equal(result.status,200,`Login ${result.status}/${result.body.code}`);return result.body;}
if(process.argv.includes("--reports-only")){
  const reportSession=await signIn("test-parent@mathin.local");
  try{
    const result=await api("portal?resource=reports",{token:reportSession.accessToken});assert.equal(result.status,200);
    const sample=result.body.find(row=>row.id==="a085ac31-7000-4000-8000-000000000008");assert(sample);assert.equal(sample.kind,"assessment");assert(sample.summary.includes("本机验收"));assert(sample.strengths&&sample.focusAreas&&sample.recommendation);
  }finally{assert.equal((await api("auth",{method:"POST",token:reportSession.accessToken,data:{action:"logout"}})).status,200);}
  console.log("PASS: published local feedback is readable through the authenticated parent API.");process.exit(0);
}
const form=await api("portal?resource=form&form=welcome");assert.equal(form.status,200);assert.equal(form.body.fields.length,4);
const requestId=randomUUID();
const intake={action:"intake",form:"welcome",version:form.body.version,requestId,source:"local-http-check",consent:true,answers:{contact_name:"接口联调",phone:"13000000000",interest:["reasoning"]}};
const registered=await api("portal",{method:"POST",data:intake});assert.equal(registered.status,201,registered.body.code);
const retry=await api("portal",{method:"POST",data:intake});assert.equal(retry.body.id,registered.body.id);
assert.equal((await api("portal",{method:"POST",data:{...intake,requestId:randomUUID(),answers:{...intake.answers,interest:["unknown"]}}})).status,400);
const activities=await api("portal?resource=activities");assert.equal(activities.status,200);assert(activities.body.some(row=>row.id==="a085ac31-7000-4000-8000-000000000001"));
assert.equal((await api("portal?resource=reports")).status,401);
let session=await signIn("test-parent@mathin.local");
const outsider=await signIn("test-parent-unbound@mathin.local");
const refreshed=await api("auth",{method:"POST",data:{action:"refresh",refreshToken:session.refreshToken}});assert.equal(refreshed.status,200);session=refreshed.body;
const account=await api("portal?resource=account",{token:session.accessToken});assert.equal(account.status,200);assert(account.body.participants.length>=2);
const student=account.body.participants[0].id;
const [booking,duplicate]=await Promise.all([1,2].map(()=>api("portal",{method:"POST",token:session.accessToken,data:{action:"book",activityId:"a085ac31-7000-4000-8000-000000000001",participantId:student}})));
assert.equal(booking.status,200,booking.body.code);assert.equal(duplicate.body.id,booking.body.id);
const otherBooking=await api("portal",{method:"POST",token:outsider.accessToken,data:{action:"book",activityId:"a085ac31-7000-4000-8000-000000000001",participantId:student}});assert.equal(otherBooking.status,403);
const practices=await api("portal?resource=practices",{token:session.accessToken});assert.equal(practices.status,200);
const practice=practices.body.find(row=>row.id==="a085ac31-7000-4000-8000-000000000002"&&row.participantId===student);assert(practice);
// 标准 1×1 PNG：验证实际 Storage 路径、签名读取与提交持久化，不上传个人照片。
const png=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5n0AAAAASUVORK5CYII=","base64");
const multipart=new FormData();multipart.append("file",new Blob([png],{type:"image/png"}),"local-check.png");
const uploaded=await fetch(origin+"/api/v1/parent/media",{method:"POST",headers:{Authorization:`Bearer ${session.accessToken}`,"x-assignment-id":practice.id,"x-participant-id":student},body:multipart});
const file=await uploaded.json();assert.equal(uploaded.status,201,file.code);
const signed=await api("media?id="+file.id,{token:session.accessToken});assert.equal(signed.status,200);
const content=await fetch(origin+signed.body.url);assert.equal(content.status,200);assert.deepEqual(Buffer.from(await content.arrayBuffer()),png);
assert.equal((await api("media?id="+file.id,{token:outsider.accessToken})).status,404);
const uploadIds=[file.id];
if(videoPath){
  const video=fs.readFileSync(videoPath);
  const videoForm=new FormData();videoForm.append("file",new Blob([video],{type:"video/mp4"}),"local-check.mp4");
  const videoUpload=await fetch(origin+"/api/v1/parent/media",{method:"POST",headers:{Authorization:`Bearer ${session.accessToken}`,"x-assignment-id":practice.id,"x-participant-id":student},body:videoForm});
  const videoFile=await videoUpload.json();assert.equal(videoUpload.status,201,videoFile.code);assert.equal(videoFile.kind,"video");
  const videoSigned=await api("media?id="+videoFile.id,{token:session.accessToken});assert.equal(videoSigned.status,200);
  const videoContent=await fetch(origin+videoSigned.body.url);assert.equal(videoContent.headers.get("content-type"),"video/mp4");assert.deepEqual(Buffer.from(await videoContent.arrayBuffer()),video);
  const range=await fetch(origin+videoSigned.body.url,{headers:{Range:"bytes=0-31"}});assert.equal(range.status,206);assert.deepEqual(Buffer.from(await range.arrayBuffer()),video.subarray(0,32));
  assert.equal((await api("media?id="+videoFile.id,{token:outsider.accessToken})).status,404);
  const tampered=new URL(videoSigned.body.url,origin);tampered.searchParams.set("token","invalid");assert.equal((await fetch(tampered)).status,404);
  uploadIds.push(videoFile.id);
}
const forged=await api("portal",{method:"POST",token:outsider.accessToken,data:{action:"submit",id:randomUUID(),assignmentId:practice.id,participantId:student,note:"越权联调",uploadIds:[file.id]}});assert.equal(forged.status,403);
const submission={action:"submit",id:randomUUID(),assignmentId:practice.id,participantId:student,note:"本机接口联调：私有附件与重试去重。",uploadIds};
const sent=await api("portal",{method:"POST",token:session.accessToken,data:submission});assert.equal(sent.status,201,sent.body.code);
assert.equal((await api("portal",{method:"POST",token:session.accessToken,data:submission})).body.id,sent.body.id);
const saved=await api(`portal?resource=submission&id=${practice.id}&participant=${student}`,{token:session.accessToken});assert.equal(saved.body.id,sent.body.id);assert.deepEqual(saved.body.media.map(item=>item.id).sort(),[...uploadIds].sort());
const reports=await api("portal?resource=reports",{token:session.accessToken});assert.equal(reports.status,200);assert(Array.isArray(reports.body));
assert.deepEqual((await api("portal?resource=reports",{token:outsider.accessToken})).body,[]);
const cancel=await api("portal",{method:"POST",token:session.accessToken,data:{action:"cancel",id:booking.body.id}});assert.equal(cancel.status,200);
for(const token of [session.accessToken,outsider.accessToken])assert.equal((await api("auth",{method:"POST",token,data:{action:"logout"}})).status,200);
fs.writeFileSync(path.join(output,"http-check.json"),JSON.stringify({host:observed.host,checkedAt:new Date().toISOString(),intakeId:registered.body.id,submissionId:sent.body.id,uploadIds,videoChecked:Boolean(videoPath),checks:"form, idempotency, auth refresh, booking concurrency, cancellation, media upload/download, persisted submission, cross-family denial"},null,2),"utf8");
console.log(`PASS: real HTTP login/refresh, anonymous intake, concurrent booking/retry, cancellation, private PNG${videoPath?"/MP4 + Range":""} upload/read, submission persistence, cross-family rejection. Local test records retained.`);
