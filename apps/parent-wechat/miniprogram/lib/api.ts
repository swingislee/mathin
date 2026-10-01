import { config } from "../config.local";
import type { Session, Media, ParentLearning, ParentAssessmentOverview, ParentAssessmentRequest, AssessmentCommand, ParentWechatAuthStatus, ParentWechatAuthResult } from "./api-types";

const sessionKey="gezhi.session.v1";
let refreshing:Promise<Session>|null=null;
let sessionVersion=0;
export class ApiError extends Error { constructor(public code:string,public reason?:string){super(code);} }
export function session():Session|null {return wx.getStorageSync(sessionKey)||null;}
export function clearSession(){sessionVersion++;wx.removeStorageSync(sessionKey);}
export function saveSession(value:Session){sessionVersion++;wx.setStorageSync(sessionKey,value);}
export function configured(){return Boolean(config.apiOrigin);}
function origin(){const value=String(config.apiOrigin);if(!value)throw new ApiError("CONFIG_REQUIRED");return value.replace(/\/$/,"");}
function send<T>(path:string,method:"GET"|"POST",data?:object,token?:string):Promise<T> {
  return new Promise((resolve,reject)=>{
    wx.request({url:origin()+"/api/v1/parent/"+path,method,data,timeout:20000,
      header:{"content-type":"application/json",...(token?{Authorization:"Bearer "+token}:{})},
      success:result=>{
        if(token&&session()?.accessToken!==token){reject(new ApiError("UNAUTHENTICATED"));return;}
        if(result.statusCode>=200&&result.statusCode<300)resolve(result.data as T);
        else {
          const error=result.data as {code?:string;reason?:string};
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
export async function learning(participant:string,range:{from:string;to:string}):Promise<ParentLearning>{
  const query=`participant=${encodeURIComponent(participant)}&from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`;
  return send<ParentLearning>("learning?"+query,"GET",undefined,await accessToken());
}
export async function getAssessments(participant:string):Promise<ParentAssessmentOverview>{
  return send<ParentAssessmentOverview>("assessments?participant="+encodeURIComponent(participant),"GET",undefined,await accessToken());
}
export async function postAssessment(data:AssessmentCommand):Promise<ParentAssessmentRequest>{
  return send<ParentAssessmentRequest>("assessments","POST",data,await accessToken());
}
export async function login(identifier:string,password:string){const value=await send<Session>("auth","POST",{action:"login",identifier,password});saveSession(value);}
export async function wechatAuthStatus():Promise<ParentWechatAuthStatus>{
  return send<ParentWechatAuthStatus>("auth/wechat","GET",undefined,session()?await accessToken():undefined);
}
function wechatCode():Promise<string>{
  return new Promise((resolve,reject)=>wx.login({timeout:10000,
    success:result=>result.code?resolve(result.code):reject(new ApiError("UNAUTHENTICATED","WECHAT_CODE_INVALID")),
    fail:()=>reject(new ApiError("UNAUTHENTICATED","WECHAT_CODE_INVALID")),
  }));
}
export async function loginWithWechat():Promise<ParentWechatAuthResult>{
  const version=sessionVersion;
  const code=await wechatCode();
  if(version!==sessionVersion)throw new ApiError("UNAUTHENTICATED");
  const result=await send<ParentWechatAuthResult>("auth/wechat","POST",{action:"login",code});
  if(version!==sessionVersion)throw new ApiError("UNAUTHENTICATED");
  if(result.state==="authenticated")saveSession(result.session);
  return result;
}
export async function bindWechat(password:string):Promise<void>{
  const token=await accessToken();
  const code=await wechatCode();
  if(session()?.accessToken!==token)throw new ApiError("UNAUTHENTICATED");
  const result=await send<ParentWechatAuthResult>("auth/wechat","POST",{action:"bind",code,password,confirm:true},token);
  if(result.state!=="bound")throw new ApiError("UNAVAILABLE");
}
export async function logout(){try{await send("auth","POST",{action:"logout"},await accessToken());}finally{clearSession();}}
export function upload(filePath:string,assignmentId:string,participantId:string,onProgress:(progress:number)=>void):Promise<Media>{
  return accessToken().then(token=>new Promise<Media>((resolve,reject)=>{
    const task=wx.uploadFile({url:origin()+"/api/v1/parent/media",filePath,name:"file",timeout:120000,
      header:{Authorization:"Bearer "+token,"x-assignment-id":assignmentId,"x-participant-id":participantId},
      success:result=>{if(session()?.accessToken!==token){reject(new ApiError("UNAUTHENTICATED"));return;}try{const body=JSON.parse(result.data);if(result.statusCode>=200&&result.statusCode<300)resolve(body as Media);else reject(new ApiError(body.code||"UNAVAILABLE"));}catch{reject(new ApiError("UNAVAILABLE"));}},
      fail:()=>reject(new ApiError("NETWORK")),
    });task.onProgressUpdate(event=>onProgress(event.progress));
  }));
}
export async function mediaUrl(id:string){const result=await send<{url:string}>("media?id="+encodeURIComponent(id),"GET",undefined,await accessToken());return origin()+result.url;}
/** 请求号只用于重试去重，不作为登录凭据或访问授权。 */
export function requestId(){return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g,key=>{const value=Math.floor(Math.random()*16);return (key==="x"?value:(value&3)|8).toString(16);});}
