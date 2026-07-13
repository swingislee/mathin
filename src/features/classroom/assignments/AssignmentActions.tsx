"use client";

import { Input } from "@/components/ui/input";

import { useState, useTransition } from "react";
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
import { Textarea } from "@/components/ui/textarea";

export function CreateAssignmentButton({ classroomId }: { classroomId: string }) {
  const t = useTranslations("classroom.assignments");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [due, setDue] = useState("");
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
          <Input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder={t("titlePlaceholder")}
            maxLength={100}
            className="w-full rounded-xl border border-line bg-transparent px-3 py-2 text-sm outline-none focus:border-ink/40"
          />
          <Textarea
            value={content}
            onChange={(event) => setContent(event.target.value)}
            placeholder={t("contentPlaceholder")}
            rows={5}
          />
          <label className="flex items-center gap-2 text-xs text-muted">
            {t("dueLabel")}
            <Input
              type="date"
              value={due}
              onChange={(event) => setDue(event.target.value)}
              className="rounded-lg border border-line bg-transparent px-2 py-1 text-sm outline-none focus:border-ink/40"
            />
          </label>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>{t("cancel")}</Button>
            <Button
              size="sm"
              disabled={pending || !title.trim()}
              onClick={() => startTransition(async () => {
                const { createAssignment } = await import("../actions");
                const dueAt = due ? new Date(`${due}T23:59:00`).toISOString() : null;
                await createAssignment(classroomId, title, content, dueAt);
                setOpen(false);
                setTitle("");
                setContent("");
                setDue("");
                router.refresh();
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

export function DeleteAssignmentButton({ assignmentId, title }: { assignmentId: string; title: string }) {
  const t = useTranslations("classroom.assignments");
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
                const { deleteAssignment } = await import("../actions");
                await deleteAssignment(assignmentId);
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
