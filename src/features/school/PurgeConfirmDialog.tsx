"use client";

import { LoaderCircle, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { type ReactNode, useState } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useAction } from "@/components/action-form";
import { useRouter } from "@/i18n/navigation";
import type { ActionResult } from "@/lib/action-result";
import { cn } from "@/lib/utils";

/**
 * 永久清理的唯一确认入口：必须精确输入对象显示名才能点亮删除按钮，
 * 不使用浏览器原生确认弹窗（AGENTS.md 约束），也不做「再点一次就删」的浅确认。
 */
export function PurgeConfirmDialog({
  objectName,
  impactSummary,
  onConfirm,
  triggerLabel,
}: {
  objectName: string;
  impactSummary: ReactNode;
  onConfirm: (confirmName: string) => Promise<ActionResult>;
  triggerLabel: string;
}) {
  const t = useTranslations("school.testdata");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [typedName, setTypedName] = useState("");

  const { run, pending } = useAction(onConfirm, {
    successMessage: t("purgeSuccess"),
    errorMessage: { default: t("purgeFailed") },
    onSuccess: () => { setOpen(false); setTypedName(""); router.refresh(); },
  });

  const matches = typedName === objectName;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(buttonVariants({ variant: "secondary", size: "sm" }), "gap-1.5 text-rose")}
      >
        <Trash2 size={15} />
        {triggerLabel}
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{t("purgeDialogTitle", { name: objectName })}</DialogTitle></DialogHeader>
          <div className="grid gap-3 text-sm">
            <p className="text-rose">{t("purgeIrreversible")}</p>
            {impactSummary}
            <label className="grid gap-1 text-xs font-normal text-muted">
              {t("purgeTypeToConfirm", { name: objectName })}
              <Input value={typedName} onChange={(event) => setTypedName(event.target.value)} autoComplete="off" />
            </label>
          </div>
          <DialogFooter>
            <Button size="sm" variant="secondary" onClick={() => setOpen(false)}>{t("purgeCancel")}</Button>
            <Button
              size="sm"
              variant="primary"
              disabled={!matches || pending}
              onClick={() => run(typedName)}
            >
              {pending && <LoaderCircle size={15} className="animate-spin" />}
              {t("purgeConfirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
