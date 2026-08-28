"use client";

import { LoaderCircle, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAction } from "@/components/action-form";
import { useRouter } from "@/i18n/navigation";
import { createCampusV2Action } from "./actions/organization-locations";
import { inputClass } from "./controls";

export function CampusCreateDialog() {
  const t = useTranslations("school.locations");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const { run, pending } = useAction(createCampusV2Action, {
    successMessage: t("campusCreated"),
    errorMessage: {
      CAMPUS_NAME_EXISTS: t("campusNameExists"),
      INVALID_CAMPUS: t("campusInvalid"),
      FORBIDDEN: t("forbidden"),
      default: t("actionFailed"),
    },
    onSuccess: (campusId) => {
      setOpen(false);
      setName("");
      setAddress("");
      router.push(`/dashboard/campuses/${campusId}`);
    },
  });

  return (
    <>
      <Button size="sm" className="gap-1.5" onClick={() => setOpen(true)}>
        <Plus size={15} />
        {t("newCampus")}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{t("newCampus")}</DialogTitle></DialogHeader>
          <div className="grid gap-4">
            <Label className="grid gap-1.5 text-sm font-normal text-muted">
              {t("campusName")}
              <Input value={name} onChange={(event) => setName(event.target.value)} maxLength={100} className={inputClass} />
            </Label>
            <Label className="grid gap-1.5 text-sm font-normal text-muted">
              {t("address")}
              <Input value={address} onChange={(event) => setAddress(event.target.value)} maxLength={500} className={inputClass} />
            </Label>
          </div>
          <p className="text-xs text-muted">{t("campusScopeHint")}</p>
          <DialogFooter>
            <Button type="button" size="sm" variant="secondary" disabled={pending} onClick={() => setOpen(false)}>{t("cancel")}</Button>
            <Button type="button" size="sm" disabled={pending || !name.trim()} onClick={() => run({ name, address })}>
              {pending && <LoaderCircle size={15} className="animate-spin motion-reduce:animate-none" />}
              {t("create")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
