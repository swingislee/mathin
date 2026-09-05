"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { EnrollmentSourceRef } from "./enrollment-workflow-contract";

export const PostActivityHandoff = dynamic(() => import("./PostActivityHandoff").then((module) => module.PostActivityHandoff));

export function EnrollmentHandoffButton({ source, name, disabled }: { source: EnrollmentSourceRef; name: string; disabled?: boolean }) {
  const t = useTranslations("school.enrollmentWorkflow");
  const [open, setOpen] = useState(false);
  return <>
    <Button size="sm" variant="secondary" disabled={disabled} onClick={() => setOpen(true)}>{t("handoff")}</Button>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader><DialogTitle>{t("handoffFor", { name })}</DialogTitle><DialogDescription>{t("handoffIntro")}</DialogDescription></DialogHeader>
        {open ? <PostActivityHandoff source={source} /> : null}
      </DialogContent>
    </Dialog>
  </>;
}
