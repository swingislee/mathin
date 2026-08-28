"use client";

import { LoaderCircle, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useAction } from "@/components/action-form";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useRouter } from "@/i18n/navigation";
import { createCampusRoomV2Action } from "./actions/organization-locations";
import { inputClass } from "./controls";

function capacityValue(value: string): number | null {
  return value.trim() ? Number(value) : null;
}

export function CampusRoomCreateDialog({ campusId, disabled = false }: { campusId: string; disabled?: boolean }) {
  const t = useTranslations("school.locations");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [capacity, setCapacity] = useState("");
  const { run, pending } = useAction(createCampusRoomV2Action, {
    successMessage: t("roomCreated"),
    errorMessage: {
      ROOM_NAME_EXISTS: t("roomNameExists"),
      INVALID_ROOM: t("roomInvalid"),
      FORBIDDEN: t("forbidden"),
      default: t("actionFailed"),
    },
    onSuccess: () => {
      setOpen(false);
      setName("");
      setCapacity("");
      router.refresh();
    },
  });

  return (
    <>
      <Button size="sm" className="gap-1.5" disabled={disabled} onClick={() => setOpen(true)}>
        <Plus size={15} />
        {t("newRoom")}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{t("newRoom")}</DialogTitle></DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <Label className="grid gap-1.5 text-sm font-normal text-muted">
              {t("roomName")}
              <Input value={name} onChange={(event) => setName(event.target.value)} maxLength={100} className={inputClass} />
            </Label>
            <Label className="grid gap-1.5 text-sm font-normal text-muted">
              {t("capacity")}
              <Input type="number" min={1} max={500} value={capacity} onChange={(event) => setCapacity(event.target.value)} className={inputClass} />
            </Label>
          </div>
          <p className="text-xs text-muted">{t("roomNameHint")}</p>
          <DialogFooter>
            <Button type="button" size="sm" variant="secondary" disabled={pending} onClick={() => setOpen(false)}>{t("cancel")}</Button>
            <Button type="button" size="sm" disabled={pending || !name.trim()} onClick={() => run({ campusId, name, capacity: capacityValue(capacity) })}>
              {pending && <LoaderCircle size={15} className="animate-spin motion-reduce:animate-none" />}
              {t("create")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
