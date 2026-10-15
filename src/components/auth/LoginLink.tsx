"use client";

import { forwardRef, type ComponentProps } from "react";
import { Link } from "@/i18n/navigation";
import { useLoginDialog } from "./LoginDialogProvider";
import { isPlainLoginClick } from "./login-contract";

type LoginLinkProps = Omit<ComponentProps<typeof Link>, "href"> & { next?: string; fallbackTarget?: string };

/** 保留真实 href：新标签页、无脚本和直接访问继续使用完整登录页。 */
export const LoginLink = forwardRef<HTMLAnchorElement, LoginLinkProps>(function LoginLink({ next, onClick, target, fallbackTarget, ...props }, ref) {
  const open = useLoginDialog();
  return <Link {...props} ref={ref} href={next ? { pathname: "/login", query: { next } } : "/login"} target={target ?? (!open ? fallbackTarget : undefined)}
    onClick={(event) => {
      onClick?.(event);
      if (!event.defaultPrevented && open && isPlainLoginClick(event, target)) {
        event.preventDefault();
        open(next, event.currentTarget);
      }
    }} />;
});
