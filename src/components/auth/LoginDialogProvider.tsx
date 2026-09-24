"use client";

import dynamic from "next/dynamic";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import { X } from "lucide-react";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { usePathname, useRouter } from "@/i18n/navigation";
import { dialogReturnTo, dialogRouterHref } from "./login-contract";

function LoginLoading() {
  const t = useTranslations("auth");
  return <div className="space-y-5 p-8" role="status"><p className="text-sm text-muted">{t("loadingLogin")}</p><div className="h-10 animate-pulse rounded-xl bg-line/50" /><div className="h-10 animate-pulse rounded-xl bg-line/50" /></div>;
}

const LazyLoginCard = dynamic(() => import("./LoginCard").then((module) => module.LoginCard), { ssr: false, loading: LoginLoading });
type OpenLogin = (next: string | undefined, trigger: HTMLElement) => void;
const LoginDialogContext = createContext<OpenLogin | null>(null);
export const useLoginDialog = () => useContext(LoginDialogContext);

export function LoginDialogProvider({ children, wechatAvailable }: { children: ReactNode; wechatAvailable: boolean }) {
  const locale = useLocale();
  const t = useTranslations("auth");
  const router = useRouter();
  const pathname = usePathname();
  const [request, setRequest] = useState<{ next: string; pathname: string } | null>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const close = useCallback(() => setRequest(null), []);
  const open = useCallback<OpenLogin>((next, trigger) => {
    triggerRef.current = trigger;
    const destination = dialogReturnTo(next, `${window.location.pathname}${window.location.search}${window.location.hash}`, locale);
    // 菜单里的登录入口先完成 Sheet 关闭与焦点恢复，再把焦点交给登录 Dialog。
    requestAnimationFrame(() => setRequest({ next: destination, pathname }));
  }, [locale, pathname]);

  useEffect(() => {
    window.addEventListener("popstate", close);
    return () => window.removeEventListener("popstate", close);
  }, [close]);

  const onSuccess = useCallback(() => {
    const next = request?.next;
    close();
    if (next && next !== dialogReturnTo(undefined, `${window.location.pathname}${window.location.search}${window.location.hash}`, locale)) {
      router.push(dialogRouterHref(next, locale));
    }
    router.refresh();
  }, [request, close, locale, router]);

  return <LoginDialogContext.Provider value={open}>
    {children}
    <Dialog open={Boolean(request && request.pathname === pathname)} onOpenChange={(value) => { if (!value) close(); }}>
      <DialogContent className="max-w-md gap-0 rounded-[2rem] p-0" showCloseButton={false} onCloseAutoFocus={(event) => {
        event.preventDefault();
        const trigger = triggerRef.current;
        if (trigger?.isConnected) trigger.focus();
        else document.querySelector<HTMLElement>("[data-auth-dialog-focus-fallback]")?.focus();
      }}>
        <DialogTitle className="sr-only">{t("loginTitle")}</DialogTitle>
        <DialogDescription className="sr-only">{t("welcomeBack")}</DialogDescription>
        {request ? <LazyLoginCard locale={locale} wechatAvailable={wechatAvailable} next={request.next} dialog onSuccess={onSuccess} onNavigate={close} /> : null}
        <DialogClose asChild><Button type="button" variant="ghost" className="absolute right-3 top-3 size-8 p-0 text-muted" aria-label={t("closeLogin")}><X className="size-4" aria-hidden /></Button></DialogClose>
      </DialogContent>
    </Dialog>
  </LoginDialogContext.Provider>;
}
