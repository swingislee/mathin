"use client";

import type { ReactNode } from "react";
import { logout } from "@/app/[locale]/(auth)/actions";
import { reconcileMyWebPushSubscriptionAction, revokeMyWebPushSubscriptionAction } from "@/features/events/web-push-actions";
import { WEB_PUSH_SERVICE_WORKER_SCOPE } from "@/features/events/web-push-contract";

/** 本浏览器的桌面通知订阅随退出撤销；同一账号在其他设备上的订阅保持。 */
async function releaseThisBrowserPush() {
  if (!("serviceWorker" in navigator)) return;
  const registration = await navigator.serviceWorker.getRegistration(WEB_PUSH_SERVICE_WORKER_SCOPE);
  const subscription = await registration?.pushManager.getSubscription();
  if (!subscription) return;
  const current = await reconcileMyWebPushSubscriptionAction(subscription.endpoint);
  if (current.ok && current.data.subscriptionId) await revokeMyWebPushSubscriptionAction(current.data.subscriptionId);
  await subscription.unsubscribe().catch(() => false);
}

/**
 * 退出当前设备。教室平板、展示屏等共用设备上退出，不影响本人或他人在其他设备上的登录；
 * 注销全部设备在账号安全中单独操作。通知清理最多等待 2 秒，随后照常退出。
 */
export function LogoutForm({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <form
      className={className}
      action={async (formData) => {
        await Promise.race([
          releaseThisBrowserPush().catch(() => undefined),
          new Promise((resolve) => setTimeout(resolve, 2000)),
        ]);
        await logout(formData);
      }}
    >
      {children}
    </form>
  );
}
