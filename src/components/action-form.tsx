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
  // inert：提交进行中整块表单不可再交互（docs/plan/24 §5.2）。aria-busy 只告诉读屏软件
  // "正在忙"，挡不住第二次点击——而这些表单提交的是导出/删除账号这类不该重复触发的请求。
  return <form action={formAction} className={className} aria-busy={pending} inert={pending || undefined}>{children}</form>;
}

/** 命令式版本：非 <form> 触发（按钮点击、ConfirmDialog 确认后）的 Server Action 统一走成功 toast / 失败按 code 分流文案。onSuccess 收到 ActionResult 的 data（无 data 时为 undefined）；onError 收到失败 code，用于在 stale/冲突后重置本地状态或刷新。 */
export function useAction<A extends unknown[],T=undefined>(action:(...args:A)=>Promise<ActionResult<T>>,opts:{successMessage:string;errorMessage:ActionErrorMessages;onSuccess?:(data:T)=>void;onError?:(code:string)=>void}){
  const [pending,startTransition]=useTransition();
  const resolveError=useResolveError();
  /**
   * 同步的在途闸门（docs/plan/24 §5.2「pending 期间防止重复提交」）。
   *
   * 不能只靠 `pending` + 调用点的 `disabled`：`useTransition` 的 pending 要等下一次
   * 渲染才为真，而 `run` 闭包里拿到的还是旧值——一次双击的两下都落在同一帧里，
   * 两个请求都会发出去。收款、下单、退款走的都是这条路径，重复提交就是重复记账。
   * 调用点的 `disabled={pending}` 仍然要写，那管的是"看得出来正在处理"，不是正确性。
   */
  const inFlight=useRef(false);
  function run(...args:A){
    if(inFlight.current)return;
    inFlight.current=true;
    startTransition(async()=>{
      try{
        const result=await action(...args);
        if(result.ok){toast.success(opts.successMessage);opts.onSuccess?.((result as {data?:T}).data as T);}
        else{toast.error(resolveError(opts.errorMessage,result.code));opts.onError?.(result.code);}
      }finally{
        inFlight.current=false;
      }
    });
  }
  return {run,pending};
}
