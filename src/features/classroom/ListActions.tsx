"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { LoaderCircle, LogIn, Plus } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { createClassroom, joinClassroom } from "./actions";

export function CreateClassroomButton() {
  const t = useTranslations("classroom.list");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [pending, startTransition] = useTransition();

  const submit = () => startTransition(async () => {
    const id = await createClassroom(name);
    setOpen(false);
    router.push(`/classroom/${id}`);
  });

  return (
    <>
      <Button size="sm" className="gap-1.5" onClick={() => setOpen(true)}>
        <Plus size={15} />
        {t("create")}
      </Button>
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
            autoFocus
            onKeyDown={(event) => {
              if (event.key === "Enter" && !pending) submit();
            }}
            className="w-full rounded-full border border-line bg-transparent px-4 py-2.5 text-sm outline-none transition focus:ring-2 focus:ring-moon"
          />
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>{t("cancel")}</Button>
            <Button size="sm" disabled={pending} onClick={submit}>
              {pending ? <LoaderCircle size={15} className="animate-spin motion-reduce:animate-none" /> : t("confirmCreate")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function JoinClassroomForm() {
  const t = useTranslations("classroom.list");
  const router = useRouter();
  const [code, setCode] = useState("");
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();

  const submit = () => {
    if (!code.trim()) return;
    startTransition(async () => {
      const id = await joinClassroom(code);
      if (id) {
        router.push(`/classroom/${id}`);
      } else {
        setFailed(true);
      }
    });
  };

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <input
          value={code}
          onChange={(event) => {
            setCode(event.target.value);
            setFailed(false);
          }}
          placeholder={t("joinPlaceholder")}
          maxLength={16}
          aria-label={t("join")}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !pending) submit();
          }}
          className="w-44 rounded-full border border-line bg-transparent px-4 py-2 font-mono text-sm outline-none transition focus:ring-2 focus:ring-moon"
        />
        <Button variant="secondary" size="sm" className="gap-1.5" disabled={pending || !code.trim()} onClick={submit}>
          {pending ? <LoaderCircle size={15} className="animate-spin motion-reduce:animate-none" /> : <LogIn size={15} />}
          {t("join")}
        </Button>
      </div>
      {failed && <p role="alert" className="pl-4 text-xs text-rose">{t("joinFailed")}</p>}
    </div>
  );
}
