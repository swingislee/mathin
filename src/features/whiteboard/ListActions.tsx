"use client";

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
import { createWhiteboard, deleteWhiteboard } from "./actions";

export function CreateBoardButton() {
  const t = useTranslations("whiteboard.list");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      size="sm"
      disabled={pending}
      className="gap-1.5"
      onClick={() => startTransition(async () => {
        const board = await createWhiteboard();
        router.push(`/whiteboard/${board.id}`);
      })}
    >
      {pending ? <LoaderCircle size={15} className="animate-spin motion-reduce:animate-none" /> : <Plus size={15} />}
      {t("newBoard")}
    </Button>
  );
}

export function DeleteBoardButton({ id, title }: { id: string; title: string }) {
  const t = useTranslations("whiteboard.list");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  return (
    <>
      <button
        type="button"
        aria-label={t("delete")}
        title={t("delete")}
        onClick={() => setOpen(true)}
        className="rounded-full p-2 text-muted transition-colors hover:bg-rose/10 hover:text-rose"
      >
        <Trash2 size={15} />
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{title || t("untitled")}</DialogTitle>
            <DialogDescription>{t("deleteConfirm")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>{t("cancel")}</Button>
            <Button
              size="sm"
              disabled={pending}
              onClick={() => startTransition(async () => {
                await deleteWhiteboard(id);
                setOpen(false);
                router.refresh();
              })}
            >
              {pending ? <LoaderCircle size={15} className="animate-spin motion-reduce:animate-none" /> : t("confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
