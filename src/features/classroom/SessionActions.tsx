"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { LoaderCircle, Plus, Trash2 } from "lucide-react";
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

export function CreateSessionButton({ classroomId }: { classroomId: string }) {
  const t = useTranslations("classroom.sessions");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [pending, startTransition] = useTransition();

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-xs text-muted transition-colors hover:bg-moon/30 hover:text-ink"
      >
        <Plus size={14} />
        {t("create")}
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("createTitle")}</DialogTitle>
          </DialogHeader>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={t("namePlaceholder")}
            maxLength={100}
            className="w-full rounded-xl border border-line bg-transparent px-3 py-2 text-sm outline-none focus:border-ink/40"
          />
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>{t("cancel")}</Button>
            <Button
              size="sm"
              disabled={pending}
              onClick={() => startTransition(async () => {
                const { createClassSession } = await import("./actions");
                const id = await createClassSession(classroomId, name);
                router.push(`/classroom/${classroomId}/session/${id}`);
              })}
            >
              {pending ? <LoaderCircle size={15} className="animate-spin motion-reduce:animate-none" /> : t("createConfirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function SessionTitleInput({ sessionId, initialTitle }: { sessionId: string; initialTitle: string }) {
  const t = useTranslations("classroom.sessions");
  const [title, setTitle] = useState(initialTitle);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  return (
    <input
      value={title}
      maxLength={100}
      placeholder={t("untitled")}
      onChange={(event) => {
        const value = event.target.value;
        setTitle(value);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(async () => {
          const { renameClassSession } = await import("./actions");
          await renameClassSession(sessionId, value).catch(() => undefined);
        }, 800);
      }}
      className="w-full min-w-0 bg-transparent font-display text-2xl outline-none placeholder:text-muted/50 md:text-3xl"
    />
  );
}

export function DeleteSessionButton({ sessionId, title }: { sessionId: string; title: string }) {
  const t = useTranslations("classroom.sessions");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  return (
    <>
      <button
        type="button"
        aria-label={t("delete")}
        title={t("delete")}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setOpen(true);
        }}
        className="rounded-full p-2 text-muted transition-colors hover:bg-rose/10 hover:text-rose"
      >
        <Trash2 size={14} />
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("delete")}</DialogTitle>
            <DialogDescription>{t("deleteConfirm", { title })}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>{t("cancel")}</Button>
            <Button
              size="sm"
              disabled={pending}
              onClick={() => startTransition(async () => {
                const { deleteClassSession } = await import("./actions");
                await deleteClassSession(sessionId);
                setOpen(false);
                router.refresh();
              })}
            >
              {pending ? <LoaderCircle size={15} className="animate-spin motion-reduce:animate-none" /> : t("delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
