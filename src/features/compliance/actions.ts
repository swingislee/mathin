"use server";
import type { ActionResult } from "@/lib/action-result";
import { createClient } from "@/lib/supabase/server";
export async function requestAccountAction(formData:FormData):Promise<ActionResult>{
 const kind=String(formData.get("kind")??"");if(kind!=="delete"&&kind!=="export")return{ok:false,code:"INVALID_KIND"};
 const supabase=await createClient();const{error}=await supabase.rpc("request_account_action",{p_kind:kind,p_reason:String(formData.get("reason")??"").slice(0,1000)});
 return error?{ok:false,code:error.message.includes("UNAUTHENTICATED")?"UNAUTHENTICATED":"FAILED"}:{ok:true};
}
