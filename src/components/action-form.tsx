"use client";
import { useActionState, useEffect, useRef, useTransition } from "react";
import { toast } from "sonner";
import type { ActionResult } from "@/lib/action-result";

/** code→文案映射；未命中用 default。纯字面量对象（非函数），可以安全地从 Server Component 传给这两个 Client 原语。 */
export type ActionErrorMessages = Record<string, string> & { default: string };

function resolveError(messages: ActionErrorMessages, code: string): string {
  return messages[code] ?? messages.default;
}

export function ActionForm({action,successMessage,errorMessage,children,className}:{action:(formData:FormData)=>Promise<ActionResult>;successMessage:string;errorMessage:ActionErrorMessages;children:React.ReactNode;className?:string}){
  const [state,formAction,pending]=useActionState(async (_:ActionResult|null,formData:FormData)=>action(formData),null);
  const latest=useRef({successMessage,errorMessage});
  useEffect(()=>{latest.current={successMessage,errorMessage};});
  useEffect(()=>{
    if(!state)return;
    if(state.ok)toast.success(latest.current.successMessage);
    else toast.error(resolveError(latest.current.errorMessage,state.code));
  },[state]);
  return <form action={formAction} className={className} aria-busy={pending}>{children}</form>;
}

/** 命令式版本：非 <form> 触发（按钮点击、ConfirmDialog 确认后）的 Server Action 统一走成功 toast / 失败按 code 分流文案。 */
export function useAction<A extends unknown[]>(action:(...args:A)=>Promise<ActionResult>,opts:{successMessage:string;errorMessage:ActionErrorMessages;onSuccess?:()=>void}){
  const [pending,startTransition]=useTransition();
  function run(...args:A){
    startTransition(async()=>{
      const result=await action(...args);
      if(result.ok){toast.success(opts.successMessage);opts.onSuccess?.();}
      else toast.error(resolveError(opts.errorMessage,result.code));
    });
  }
  return {run,pending};
}
