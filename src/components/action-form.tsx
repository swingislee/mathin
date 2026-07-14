"use client";
import { useTranslations } from "next-intl";
import { useActionState, useCallback, useEffect, useRef, useTransition } from "react";
import { toast } from "sonner";
import type { ActionResult } from "@/lib/action-result";

/** code→文案映射；未命中用 default。纯字面量对象（非函数），可以安全地从 Server Component 传给这两个 Client 原语。 */
export type ActionErrorMessages = Record<string, string> & { default: string };

/**
 * VALIDATION（zod 拒绝畸形入参，P4G-9 §7.2）在全站都是同一句话，故在此兜底，
 * 免得每个调用点都重复声明；调用点仍可显式覆盖它。
 */
function useResolveError() {
  const t = useTranslations("common");
  return useCallback(
    (messages: ActionErrorMessages, code: string) => messages[code] ?? (code === "VALIDATION" ? t("invalidInput") : messages.default),
    [t],
  );
}

export function ActionForm({action,successMessage,errorMessage,children,className}:{action:(formData:FormData)=>Promise<ActionResult>;successMessage:string;errorMessage:ActionErrorMessages;children:React.ReactNode;className?:string}){
  const [state,formAction,pending]=useActionState(async (_:ActionResult|null,formData:FormData)=>action(formData),null);
  const resolveError=useResolveError();
  const latest=useRef({successMessage,errorMessage,resolveError});
  useEffect(()=>{latest.current={successMessage,errorMessage,resolveError};});
  useEffect(()=>{
    if(!state)return;
    if(state.ok)toast.success(latest.current.successMessage);
    else toast.error(latest.current.resolveError(latest.current.errorMessage,state.code));
  },[state]);
  return <form action={formAction} className={className} aria-busy={pending}>{children}</form>;
}

/** 命令式版本：非 <form> 触发（按钮点击、ConfirmDialog 确认后）的 Server Action 统一走成功 toast / 失败按 code 分流文案。onSuccess 收到 ActionResult 的 data（无 data 时为 undefined）。 */
export function useAction<A extends unknown[],T=undefined>(action:(...args:A)=>Promise<ActionResult<T>>,opts:{successMessage:string;errorMessage:ActionErrorMessages;onSuccess?:(data:T)=>void}){
  const [pending,startTransition]=useTransition();
  const resolveError=useResolveError();
  function run(...args:A){
    startTransition(async()=>{
      const result=await action(...args);
      if(result.ok){toast.success(opts.successMessage);opts.onSuccess?.((result as {data?:T}).data as T);}
      else toast.error(resolveError(opts.errorMessage,result.code));
    });
  }
  return {run,pending};
}
