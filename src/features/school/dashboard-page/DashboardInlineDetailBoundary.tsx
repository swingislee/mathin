"use client";

import { Suspense, type ReactNode } from "react";
import { useTranslations } from "next-intl";

export function FollowupDetailLoading({ children }: { children: ReactNode }) {
  return <p role="status" className="py-3 text-xs text-muted">{children}</p>;
}

function DetailContent({ children }: { children: ReactNode | (() => ReactNode) }) {
  return typeof children === "function" ? children() : children;
}

/** 模块、异步内容及延迟构造的等待均留在当前详情，外围列表持续挂载。 */
export function DashboardInlineDetailBoundary({ children, loadingLabel }: {
  children: ReactNode | (() => ReactNode);
  loadingLabel?: string;
}) {
  const t = useTranslations("school.followupWorkspace");
  return <Suspense fallback={<FollowupDetailLoading>{loadingLabel ?? t("loadingDetails")}</FollowupDetailLoading>}>
    <DetailContent>{children}</DetailContent>
  </Suspense>;
}
