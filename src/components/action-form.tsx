"use client";
import { useActionState } from "react";
import type { ActionResult } from "@/lib/action-result";

export function ActionForm({action,successMessage,errorMessage,children,className}:{action:(formData:FormData)=>Promise<ActionResult>;successMessage:string;errorMessage:(code:string)=>string;children:React.ReactNode;className?:string}){
  const [state,formAction,pending]=useActionState(async (_:ActionResult|null,formData:FormData)=>action(formData),null);
  return <form action={formAction} className={className} aria-busy={pending}>{children}<div className="mt-2 min-h-5 text-xs" aria-live="polite">{state?.ok?<p className="text-leaf-deep">{successMessage}</p>:state&&!state.ok?<p className="text-rose">{errorMessage(state.code)}</p>:null}</div></form>;
}
