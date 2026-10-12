import { config } from "../config.local";
import { activityPageImageUrl, type ActivityPage } from "./activity-detail";
import type { MiniappDocument, MiniappSettingsPublication } from "./miniapp-settings";
import type { GuardianBindingPreview, GuardianBindingStep, GuardianConfirmation } from "./api-types";
import type { FamilyRegistration, PhoneResult, RegistrationResult } from "./onboarding";
import type { ActivityOffer, ActivityRequest, ActivityRequestCommand, RegistrationHistory, RegistrationForm, RegistrationSubmission } from "./api-types";
import type { Session, Media, ParticipantCalendar, AssessmentOverview, AssessmentRequest, AssessmentAvailability, AssessmentTopic, AssessmentCommand, WechatAuthStatus, WechatAuthResult } from "./api-types";

const sessionKey="gezhi.session.v1";
let refreshing:Promise<Session>|null=null;
let sessionVersion=0;
export class ApiError extends Error { constructor(public code:string,public reason?:string){super(code);} }
export function session():Session|null {return wx.getStorageSync(sessionKey)||null;}
// Discard unfinished authentication without signing out an existing account.
export function cancelPendingAuthentication(){sessionVersion++;}
export function clearSession(){sessionVersion++;wx.removeStorageSync(sessionKey);}
export function saveSession(value:Session){sessionVersion++;wx.setStorageSync(sessionKey,value);}
export function configured(){return Boolean(config.apiOrigin);}
function origin(){const value=String(config.apiOrigin);if(!value)throw new ApiError("CONFIG_REQUIRED");return value.replace(/\/$/,"");}
let consentNavigationPending = false;
function send<T>(path:string,method:"GET"|"POST",data?:object,token?:string):Promise<T> {
  return new Promise((resolve,reject)=>{
    // WeChat entry can wait for development compilation before the server exchanges its one-time code.
    const wechatEntry = path === "auth/wechat" || path === "auth/wechat/onboarding" || path === "guardian-binding";
    wx.request({url:origin()+"/api/v1/participant/"+path,method,data,timeout:wechatEntry ? 60000 : 20000,
      header:{"content-type":"application/json",...(token?{Authorization:"Bearer "+token}:{})},
      success:result=>{
        if(token&&session()?.accessToken!==token){reject(new ApiError("UNAUTHENTICATED"));return;}
        if(result.statusCode>=200&&result.statusCode<300)resolve(result.data as T);
        else {
          const error=result.data as {code?:string;reason?:string};
          if (token && error.code === "ACCOUNT_SECURITY" && error.reason === "CONSENT_REQUIRED" && !consentNavigationPending
            && getCurrentPages().slice(-1)[0]?.route !== "pages/document/index") {
            consentNavigationPending = true;
            wx.navigateTo({ url: "/pages/document/index?consent=1", complete: () => { consentNavigationPending = false; } });
          }
          reject(new ApiError(error?.code||"UNAVAILABLE",typeof error?.reason==="string"?error.reason:undefined));
        }
      },fail:error=>{console.warn("Portal request failed:",error.errMsg);reject(new ApiError("NETWORK"));},
    });
  });
}
async function accessToken(){
  const current=session();if(!current)throw new ApiError("UNAUTHENTICATED");
  if(current.expiresAt*1000>Date.now()+60000)return current.accessToken;
  if(!refreshing)refreshing=send<Session>("auth","POST",{action:"refresh",refreshToken:current.refreshToken})
    .then(value=>{if(session()?.refreshToken!==current.refreshToken)throw new ApiError("UNAUTHENTICATED");saveSession(value);return value;}).catch(error=>{if(error instanceof ApiError&&error.code==="UNAUTHENTICATED"&&session()?.refreshToken===current.refreshToken)clearSession();throw error;});
  const pending=refreshing;
  try{return (await pending).accessToken;}finally{if(refreshing===pending)refreshing=null;}
}
export async function get<T>(resource:string,query="",authenticated=true):Promise<T>{
  return send<T>("portal?resource="+resource+query,"GET",undefined,authenticated?await accessToken():undefined);
}
export async function post<T>(data:object,authenticated=true):Promise<T>{
  return send<T>("portal","POST",data,authenticated?await accessToken():undefined);
}
export async function serviceContacts(): Promise<import("./api-types").ServiceContact[]> {
  return send("services", "GET");
}
export async function miniappSettings(revision?: number): Promise<MiniappSettingsPublication> {
  return send("settings" + (revision === undefined ? "" : "?revision=" + revision), "GET");
}
export async function miniappDocument(id: string): Promise<MiniappDocument> {
  return send("documents?id=" + encodeURIComponent(id), "GET");
}
export function miniappContentImage(path: string, thumbnail = false): string {
  return path ? origin() + "/api/v1/participant/settings/image?path=" + encodeURIComponent(path) + (thumbnail ? "&size=thumb" : "") : "";
}
export async function activityCatalog(): Promise<ActivityOffer[]> {
  return send<ActivityOffer[]>("activities", "GET");
}
export async function activityDetail(id: string): Promise<{ offer: ActivityOffer; page: ActivityPage | null; pageRevision?: number }> {
  return send("activities/detail?id=" + encodeURIComponent(id), "GET");
}
export function activityImageUrl(path: string, thumbnail = false): string {
  return path ? origin() + activityPageImageUrl(path, false, thumbnail) : "";
}
export async function activityRequests(): Promise<ActivityRequest[]> {
  return send<ActivityRequest[]>("activities?resource=applications", "GET", undefined, await accessToken());
}
export async function activityRegistrationAnswers(id: string): Promise<import("./form-questions").FormAnswerSnapshot> {
  return send("activities?resource=answers&id=" + encodeURIComponent(id), "GET", undefined, await accessToken());
}
export async function activityCommand(data: ActivityRequestCommand): Promise<{ id?: string; ok?: boolean }> {
  return send("activities", "POST", data, await accessToken());
}
export async function getRegistrationHistory(page = 1): Promise<RegistrationHistory> {
  return send("registrations?page=" + page, "GET", undefined, await accessToken());
}
export async function getRegistrationForm(): Promise<RegistrationForm> {
  return send("registrations?resource=form", "GET", undefined, await accessToken());
}
export async function getRegistrationReceipt(id: string): Promise<{ id: string } | null> {
  return send("registrations?resource=receipt&id=" + encodeURIComponent(id), "GET", undefined, await accessToken());
}
export async function submitRegistration(id: string, family: FamilyRegistration): Promise<RegistrationSubmission> {
  return send("registrations", "POST", { id, family }, await accessToken());
}
export async function participantCalendar(participant:string,range:{from:string;to:string}):Promise<ParticipantCalendar>{
  const query=`participant=${encodeURIComponent(participant)}&from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`;
  return send<ParticipantCalendar>("calendar?"+query,"GET",undefined,await accessToken());
}
export async function getAssessments(participant:string):Promise<AssessmentOverview>{
  return send<AssessmentOverview>("assessments?participant="+encodeURIComponent(participant),"GET",undefined,await accessToken());
}
export async function postAssessment(data:AssessmentCommand):Promise<AssessmentRequest>{
  return send<AssessmentRequest>("assessments","POST",data,await accessToken());
}
export async function getAssessmentSlots(participant: string, topics: AssessmentTopic[], stageNumber: number, mode: "campus" | "online" = "campus"): Promise<AssessmentAvailability> {
  const query = `participant=${encodeURIComponent(participant)}&topics=${encodeURIComponent(topics.join(","))}&stageNumber=${stageNumber}`;
  return send<AssessmentAvailability>("assessment-slots?" + query + "&mode=" + mode, "GET", undefined, await accessToken());
}
export async function wechatAuthStatus():Promise<WechatAuthStatus>{
  return send<WechatAuthStatus>("auth/wechat","GET",undefined,session()?await accessToken():undefined);
}
function wechatCode():Promise<string>{
  return new Promise((resolve,reject)=>wx.login({timeout:10000,
    success:result=>result.code?resolve(result.code):reject(new ApiError("UNAUTHENTICATED","WECHAT_CODE_INVALID")),
    fail:()=>reject(new ApiError("UNAUTHENTICATED","WECHAT_CODE_INVALID")),
  }));
}
export async function loginWithWechat(scene?:string,useCurrentSession=false):Promise<WechatAuthResult>{
  const token=useCurrentSession?await accessToken():undefined;
  const version=sessionVersion;
  const code=await wechatCode();
  if(version!==sessionVersion)throw new ApiError("UNAUTHENTICATED");
  const result=await send<WechatAuthResult>("auth/wechat","POST",{action:"login",code,...(scene ? {scene} : {})},token);
  if(version!==sessionVersion)throw new ApiError("UNAUTHENTICATED");
  if(result.state==="authenticated")saveSession(result.session);
  return result;
}
export function authorizeWechatPhone(ticket:string,code:string):Promise<PhoneResult>{
  return send("auth/wechat/onboarding","POST",{action:"phone",ticket,code});
}
export function verifiedWechatForm(ticket:string):Promise<PhoneResult>{
  return send("auth/wechat/onboarding","POST",{action:"form",ticket});
}
export async function completeWechatFamily(ticket:string,family:FamilyRegistration):Promise<RegistrationResult>{
  const version=sessionVersion;
  const result=await send<RegistrationResult>("auth/wechat/onboarding","POST",{action:"complete",ticket,family});
  if(version!==sessionVersion)throw new ApiError("UNAUTHENTICATED");
  saveSession(result.session);return result;
}
export async function bindWechat():Promise<void>{
  const token=await accessToken();
  const code=await wechatCode();
  if(session()?.accessToken!==token)throw new ApiError("UNAUTHENTICATED");
  const result=await send<WechatAuthResult>("auth/wechat","POST",{action:"bind",code,confirm:true},token);
  if(result.state!=="bound")throw new ApiError("UNAVAILABLE");
}
export function guardianBindingPreview(invitation: string): Promise<GuardianBindingPreview> {
  return send("guardian-binding", "POST", { action: "preview", invitation });
}
export async function beginGuardianBinding(invitation: string): Promise<GuardianBindingStep> {
  const token = session() ? await accessToken() : undefined, version = sessionVersion;
  const code = await wechatCode();
  if (version !== sessionVersion) throw new ApiError("UNAUTHENTICATED");
  const result = await send<GuardianBindingStep>("guardian-binding", "POST", { action: "login", invitation, code }, token);
  if (version !== sessionVersion) throw new ApiError("UNAUTHENTICATED");
  return result;
}
export function guardianBindingPhone(ticket: string, code: string): Promise<GuardianBindingStep> {
  return send("guardian-binding", "POST", { action: "phone", ticket, code });
}
export async function confirmGuardianBinding(ticket: string, confirmation: GuardianConfirmation): Promise<RegistrationResult> {
  const token = session() ? await accessToken() : undefined, version = sessionVersion;
  const result = await send<RegistrationResult>("guardian-binding", "POST", { action: "confirm", ticket, confirmation }, token);
  if (version !== sessionVersion) throw new ApiError("UNAUTHENTICATED");
  saveSession(result.session); return result;
}
export async function logout(){try{await send("auth","POST",{action:"logout"},await accessToken());}finally{clearSession();}}
export function upload(filePath:string,taskId:string,participantId:string,onProgress:(progress:number)=>void):Promise<Media>{
  return accessToken().then(token=>new Promise<Media>((resolve,reject)=>{
    const task=wx.uploadFile({url:origin()+"/api/v1/participant/media",filePath,name:"file",timeout:120000,
      header:{Authorization:"Bearer "+token,"x-task-id":taskId,"x-participant-id":participantId},
      success:result=>{if(session()?.accessToken!==token){reject(new ApiError("UNAUTHENTICATED"));return;}try{const body=JSON.parse(result.data);if(result.statusCode>=200&&result.statusCode<300)resolve(body as Media);else reject(new ApiError(body.code||"UNAVAILABLE"));}catch{reject(new ApiError("UNAVAILABLE"));}},
      fail:()=>reject(new ApiError("NETWORK")),
    });task.onProgressUpdate(event=>onProgress(event.progress));
  }));
}
export async function mediaUrl(id:string){const result=await send<{url:string}>("media?id="+encodeURIComponent(id),"GET",undefined,await accessToken());return origin()+result.url;}
/** 请求号只用于重试去重，不作为登录凭据或访问授权。 */
export function requestId(){return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g,key=>{const value=Math.floor(Math.random()*16);return (key==="x"?value:(value&3)|8).toString(16);});}

export async function consentDocuments() { return send<import("./miniapp-settings").ConsentDocuments>("consents", "GET"); }
export async function acceptConsentDocuments(privacyVersion: string, childrenPrivacyVersion: string) { return send<{ ok: true }>("consents", "POST", { privacyVersion, childrenPrivacyVersion, consent: true }, await accessToken()); }
