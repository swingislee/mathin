import { config } from "../config.local";
import type { Session, Media } from "./api-types";

const sessionKey="gezhi.session.v1";
let refreshing:Promise<Session>|null=null;
export class ApiError extends Error { constructor(public code:string){super(code);} }
export function session():Session|null {return wx.getStorageSync(sessionKey)||null;}
export function clearSession(){wx.removeStorageSync(sessionKey);}
export function saveSession(value:Session){wx.setStorageSync(sessionKey,value);}
export function configured(){return Boolean(config.apiOrigin);}
function origin(){const value=String(config.apiOrigin);if(!value)throw new ApiError("CONFIG_REQUIRED");return value.replace(/\/$/,"");}
function send<T>(path:string,method:"GET"|"POST",data?:object,token?:string):Promise<T> {
  return new Promise((resolve,reject)=>{
    wx.request({url:origin()+"/api/v1/parent/"+path,method,data,timeout:20000,
      header:{"content-type":"application/json",...(token?{Authorization:"Bearer "+token}:{})},
      success:result=>{
        if(token&&session()?.accessToken!==token){reject(new ApiError("UNAUTHENTICATED"));return;}
        if(result.statusCode>=200&&result.statusCode<300)resolve(result.data as T);
        else reject(new ApiError((result.data as {code?:string})?.code||"UNAVAILABLE"));
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
export async function login(identifier:string,password:string){const value=await send<Session>("auth","POST",{action:"login",identifier,password});saveSession(value);}
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
