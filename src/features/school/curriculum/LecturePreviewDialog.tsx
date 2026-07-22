"use client";

import type { ReactNode } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { useRouter } from "@/i18n/navigation";

/**
 * 讲次预览对话框的纯壳层——真正的正文是 `LecturePreviewPanel`（可在多个
 * 入口复用），这里只管 Radix Dialog 的开关语义：关闭时把地址替换回
 * `closeHref`（不留 `?lecture=` 等查询参数），不持有任何业务状态。
 */
export function LecturePreviewDialog({
  title,
  closeHref,
  children,
}: {
  title: string;
  closeHref: string;
  children: ReactNode;
}) {
  const router = useRouter();
  return (
    <Dialog open onOpenChange={(open) => { if (!open) router.replace(closeHref); }}>
      <DialogContent className="flex h-[min(94vh,58rem)] max-w-6xl flex-col gap-0 overflow-hidden p-0">
        <DialogTitle className="sr-only">{title}</DialogTitle>
        {children}
      </DialogContent>
    </Dialog>
  );
}
