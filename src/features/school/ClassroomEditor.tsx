"use client";

import { LoaderCircle, Pencil } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { useAction } from "@/components/action-form";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useRouter } from "@/i18n/navigation";
import {
  previewClassroomDefaultRoomAction,
  updateClassroomAction,
  updateClassroomDefaultRoomAction,
  type ClassroomRoomApplyPreview,
} from "./actions/classes";
import type { ClassroomDetail } from "./classes";
import { fromSelectValue, inputClass, toSelectValue } from "./controls";
import type { RoomOptionV2 } from "./organization-locations";
import { RoomPicker } from "./RoomPicker";

export function ClassroomEditor({
  classroom,
  roomOptions,
}: {
  classroom: ClassroomDetail;
  roomOptions: RoomOptionV2[];
}) {
  const t = useTranslations("school.classes");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(classroom.name);
  const [grade, setGrade] = useState(classroom.grade?.toString() ?? "");
  const [capacity, setCapacity] = useState(classroom.capacity?.toString() ?? "");
  const [roomId, setRoomId] = useState<string | null>(classroom.defaultRoomId);
  const [preview, setPreview] = useState<ClassroomRoomApplyPreview | null>(null);
  const [previewPending, startPreview] = useTransition();
  const errors = {
    INVALID_ROOM: t("roomInvalid"),
    LOCATION_IMPACT_STALE: t("roomImpactStale"),
    FORBIDDEN_SCOPE: t("reasonForbiddenScope"),
    default: t("actionFailed"),
  };

  const saveProfile = useAction(updateClassroomAction, {
    successMessage: t("classSaved"),
    errorMessage: errors,
    onSuccess: () => router.refresh(),
  });
  const saveRoom = useAction(updateClassroomDefaultRoomAction, {
    successMessage: t("defaultRoomSaved"),
    errorMessage: errors,
    onSuccess: () => {
      setPreview(null);
      setOpen(false);
      router.refresh();
    },
    onError: (code) => { if (code === "LOCATION_IMPACT_STALE") router.refresh(); },
  });

  const capacityNumber = capacity ? Number(capacity) : null;
  const profileValid = name.trim().length > 0
    && name.trim().length <= 100
    && (capacityNumber === null || (Number.isInteger(capacityNumber) && capacityNumber >= 1 && capacityNumber <= 500));
  const roomChanged = roomId !== classroom.defaultRoomId;

  const requestApply = () => {
    startPreview(async () => {
      const result = await previewClassroomDefaultRoomAction(classroom.id, roomId);
      if (!result.ok) {
        toast.error(errors[result.code as keyof typeof errors] ?? errors.default);
        return;
      }
      setPreview(result.data);
    });
  };

  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)} className="gap-1.5">
        <Pencil size={15} />{t("editClass")}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{t("editClass")}</DialogTitle></DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <Label className="grid gap-1 text-xs font-normal text-muted sm:col-span-2">
              {t("name")}
              <Input value={name} onChange={(event) => setName(event.target.value)} maxLength={100} className={inputClass} />
            </Label>
            <Label className="grid gap-1 text-xs font-normal text-muted">
              {t("gradeLabel")}
              <Select value={toSelectValue(grade)} onValueChange={(value) => setGrade(fromSelectValue(value))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={toSelectValue("")}>—</SelectItem>
                  {Array.from({ length: 12 }, (_, index) => index + 1).map((value) => (
                    <SelectItem key={value} value={String(value)}>{t("grade", { grade: value })}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Label>
            <Label className="grid gap-1 text-xs font-normal text-muted">
              {t("capacity")}
              <Input type="number" min={1} max={500} value={capacity} onChange={(event) => setCapacity(event.target.value)} className={inputClass} />
            </Label>
          </div>
          <div className="rounded-xl border border-line p-3">
            <Label className="text-xs font-normal text-muted">{t("defaultRoom")}</Label>
            <div className="mt-1">
              <RoomPicker
                rooms={roomOptions}
                value={roomId}
                onValueChange={setRoomId}
                capacity={capacityNumber}
                disabled={previewPending || saveRoom.pending}
              />
            </div>
            <p className="mt-2 text-xs text-muted">{t("defaultRoomFutureHint")}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button type="button" size="sm" variant="secondary" disabled={!roomChanged || saveRoom.pending} onClick={() => saveRoom.run({
                classroomId: classroom.id,
                roomId,
                applyToUnstarted: false,
                expectedUnstartedSessionCount: null,
              })}>{t("saveForNewSessions")}</Button>
              <Button type="button" size="sm" variant="secondary" disabled={!roomChanged || previewPending || saveRoom.pending} onClick={requestApply}>
                {previewPending && <LoaderCircle size={14} className="animate-spin motion-reduce:animate-none" />}
                {t("applyToUnstarted")}
              </Button>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" size="sm" variant="secondary" disabled={saveProfile.pending || saveRoom.pending} onClick={() => setOpen(false)}>{t("cancel")}</Button>
            <Button type="button" size="sm" disabled={!profileValid || saveProfile.pending} onClick={() => saveProfile.run(classroom.id, {
              name,
              grade: grade ? Number(grade) : null,
              capacity: capacityNumber,
            })}>
              {saveProfile.pending && <LoaderCircle size={15} className="animate-spin motion-reduce:animate-none" />}
              {t("saveBasicInfo")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={preview !== null}
        onOpenChange={(next) => { if (!next) setPreview(null); }}
        title={t("applyDefaultRoomTitle")}
        description={preview ? t("applyDefaultRoomDescription", { count: preview.unstartedDefaultSessionCount }) : ""}
        confirmLabel={t("confirmApply")}
        cancelLabel={t("cancel")}
        pending={saveRoom.pending}
        onConfirm={() => preview && saveRoom.run({
          classroomId: classroom.id,
          roomId: preview.roomId,
          applyToUnstarted: true,
          expectedUnstartedSessionCount: preview.unstartedDefaultSessionCount,
        })}
      />
    </>
  );
}
