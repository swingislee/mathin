"use client";

import { useEffect } from "react";
import { useRouter } from "@/i18n/navigation";
import { STUDENT_360_REFRESH_EVENT } from "../student-360-contract";

/** 每次服务端渲染的页面数据首次显示时所处的数据版本。 */
const shownAt = new Map<string, number>();
let dataVersion = 0;
if (typeof window !== "undefined") window.addEventListener(STUDENT_360_REFRESH_EVENT, () => { dataVersion += 1; });

/**
 * 名单页可在短时间内复用浏览器里的页面数据（页面导出 unstable_dynamicStaleTime）。
 * 复用的数据若早于本机的一次保存（保存后会广播 STUDENT_360_REFRESH_EVENT），
 * 先显示已有名单，再在后台重新读取，保存结果随后出现在其他名单里。
 */
export function DashboardRevisitFreshness({ renderId }: { renderId: string }) {
  const router = useRouter();
  useEffect(() => {
    const version = shownAt.get(renderId);
    shownAt.set(renderId, dataVersion);
    if (version !== undefined && version !== dataVersion) router.refresh();
  }, [renderId, router]);
  return null;
}
