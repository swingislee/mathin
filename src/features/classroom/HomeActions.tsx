"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Check, Copy, LoaderCircle, LogOut, UserMinus } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export function CopyInviteButton({ code }: { code: string }) {
  const t = useTranslations("classroom.home");
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      aria-label={t("copy")}
      title={t("copy")}
      className="rounded-full p-2 text-muted transition-colors hover:bg-moon/30 hover:text-ink"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(code);
        } catch {
          // 非安全上下文兜底：无 clipboard API 时用户可手动选中复制
        }
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? <Check size={15} className="text-leaf-deep" /> : <Copy size={15} />}
    </button>
  );
}

function ConfirmButton({ label, description, icon, onConfirm }: {
  label: string;
  description: string;
  icon: React.ReactNode;
  /** 确认后的动作自行负责导航/刷新，避免与本组件竞态。 */
  onConfirm: () => Promise<void>;
}) {
  const t = useTranslations("classroom.home");
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  return (
    <>
      <button
        type="button"
        aria-label={label}
        title={label}
        onClick={() => setOpen(true)}
        className="rounded-full p-2 text-muted transition-colors hover:bg-rose/10 hover:text-rose"
      >
        {icon}
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{label}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>{t("cancel")}</Button>
            <Button
              size="sm"
              disabled={pending}
              onClick={() => startTransition(async () => {
                await onConfirm();
                setOpen(false);
              })}
            >
              {pending ? <LoaderCircle size={15} className="animate-spin motion-reduce:animate-none" /> : label}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function RemoveMemberButton({ classroomId, userId, name }: { classroomId: string; userId: string; name: string }) {
  const t = useTranslations("classroom.home");
  const router = useRouter();
  return (
    <ConfirmButton
      label={t("remove")}
      description={t("removeConfirm", { name })}
      icon={<UserMinus size={15} />}
      onConfirm={async () => {
        const { removeClassroomMember } = await import("./actions");
        await removeClassroomMember(classroomId, userId);
        router.refresh();
      }}
    />
  );
}

export function LeaveClassroomButton({ classroomId }: { classroomId: string }) {
  const t = useTranslations("classroom.home");
  const router = useRouter();
  return (
    <ConfirmButton
      label={t("leave")}
      description={t("leaveConfirm")}
      icon={<LogOut size={15} />}
      onConfirm={async () => {
        const { leaveClassroom } = await import("./actions");
        await leaveClassroom(classroomId);
        router.push("/classroom");
      }}
    />
  );
}
