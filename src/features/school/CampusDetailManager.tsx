"use client";

import { Archive, LoaderCircle, Pencil, Power, RotateCcw } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { useAction, type ActionErrorMessages } from "@/components/action-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useRouter } from "@/i18n/navigation";
import {
  getLocationImpactV2Action,
  setCampusRoomStatusV2Action,
  updateCampusRoomV2Action,
  updateCampusV2Action,
} from "./actions/organization-locations";
import { inputClass } from "./controls";
import { DashboardCard, DashboardCardShell, DashboardEmptyCard } from "./dashboard-page";
import type { CampusRoomV2, CampusV2, LocationImpactV2 } from "./organization-locations";

type Confirmation =
  | { kind: "campus"; impact: LocationImpactV2 }
  | { kind: "room"; room: CampusRoomV2; impact: LocationImpactV2 };

function capacityValue(value: string): number | null {
  return value.trim() ? Number(value) : null;
}

export function CampusDetailManager({ campus }: { campus: CampusV2 }) {
  const t = useTranslations("school.locations");
  const router = useRouter();
  const [campusDialogOpen, setCampusDialogOpen] = useState(false);
  const [campusName, setCampusName] = useState(campus.name);
  const [campusAddress, setCampusAddress] = useState(campus.address ?? "");
  const [editingRoom, setEditingRoom] = useState<CampusRoomV2 | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [impactPending, startImpactTransition] = useTransition();

  const errors: ActionErrorMessages = {
    CAMPUS_NAME_EXISTS: t("campusNameExists"),
    ROOM_NAME_EXISTS: t("roomNameExists"),
    INVALID_CAMPUS: t("campusInvalid"),
    INVALID_ROOM: t("roomInvalid"),
    CAMPUS_ARCHIVED: t("campusArchivedError"),
    LOCATION_IMPACT_STALE: t("impactStale"),
    FORBIDDEN: t("forbidden"),
    default: t("actionFailed"),
  };

  const saveCampus = useAction(updateCampusV2Action, {
    successMessage: t("campusSaved"),
    errorMessage: errors,
    onSuccess: () => {
      setCampusDialogOpen(false);
      router.refresh();
    },
  });
  const changeCampusStatus = useAction(updateCampusV2Action, {
    successMessage: campus.status === "active" ? t("campusArchived") : t("campusRestored"),
    errorMessage: errors,
    onSuccess: () => {
      setConfirmation(null);
      router.refresh();
    },
    onError: (code) => { if (code === "LOCATION_IMPACT_STALE") router.refresh(); },
  });
  const saveRoom = useAction(updateCampusRoomV2Action, {
    successMessage: t("roomSaved"),
    errorMessage: errors,
    onSuccess: () => {
      setEditingRoom(null);
      router.refresh();
    },
  });
  const changeRoomStatus = useAction(setCampusRoomStatusV2Action, {
    successMessage: t("roomStatusSaved"),
    errorMessage: errors,
    onSuccess: () => {
      setConfirmation(null);
      router.refresh();
    },
    onError: (code) => { if (code === "LOCATION_IMPACT_STALE") router.refresh(); },
  });

  const loadImpact = (kind: "campus" | "room", room?: CampusRoomV2) => {
    startImpactTransition(async () => {
      const result = await getLocationImpactV2Action(kind, kind === "campus" ? campus.id : room!.id);
      if (!result.ok) {
        toast.error(errors[result.code] ?? errors.default);
        return;
      }
      setConfirmation(kind === "campus" ? { kind, impact: result.data } : { kind, room: room!, impact: result.data });
    });
  };

  const confirmDescription = confirmation?.kind === "campus"
    ? t("archiveCampusImpact", {
        rooms: confirmation.impact.roomCount,
        classes: confirmation.impact.classDefaultCount,
        sessions: confirmation.impact.unstartedSessionCount,
        history: confirmation.impact.historicalSessionCount,
      })
    : confirmation?.kind === "room"
      ? t("disableRoomImpact", {
          room: confirmation.room.name,
          classes: confirmation.impact.classDefaultCount,
          sessions: confirmation.impact.unstartedSessionCount,
          history: confirmation.impact.historicalSessionCount,
        })
      : "";

  const confirmStatusChange = () => {
    if (!confirmation) return;
    if (confirmation.kind === "campus") {
      changeCampusStatus.run({
        campusId: campus.id,
        name: campus.name,
        address: campus.address ?? "",
        status: "archived",
        expectedUnstartedSessionCount: confirmation.impact.unstartedSessionCount,
      });
      return;
    }
    changeRoomStatus.run({
      roomId: confirmation.room.id,
      status: "inactive",
      expectedUnstartedSessionCount: confirmation.impact.unstartedSessionCount,
    });
  };

  return (
    <div className="grid gap-6">
      <DashboardCard
        title={t("campusDetails")}
        description={t("campusScopeHint")}
        actions={(
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="secondary" className="gap-1.5" onClick={() => {
              setCampusName(campus.name);
              setCampusAddress(campus.address ?? "");
              setCampusDialogOpen(true);
            }}>
              <Pencil size={14} />{t("edit")}
            </Button>
            {campus.status === "active" ? (
              <Button type="button" size="sm" variant="secondary" className="gap-1.5 text-rose" disabled={impactPending} onClick={() => loadImpact("campus")}>
                {impactPending ? <LoaderCircle size={14} className="animate-spin motion-reduce:animate-none" /> : <Archive size={14} />}
                {t("archiveCampus")}
              </Button>
            ) : (
              <Button type="button" size="sm" variant="secondary" className="gap-1.5" disabled={changeCampusStatus.pending} onClick={() => changeCampusStatus.run({
                campusId: campus.id,
                name: campus.name,
                address: campus.address ?? "",
                status: "active",
                expectedUnstartedSessionCount: null,
              })}>
                <RotateCcw size={14} />{t("restoreCampus")}
              </Button>
            )}
          </div>
        )}
      >
        <dl className="grid gap-4 sm:grid-cols-3">
          <div><dt className="text-xs text-muted">{t("campusName")}</dt><dd className="mt-1 font-medium text-ink">{campus.name}</dd></div>
          <div><dt className="text-xs text-muted">{t("address")}</dt><dd className="mt-1 text-sm">{campus.address || t("addressUnset")}</dd></div>
          <div><dt className="text-xs text-muted">{t("status")}</dt><dd className="mt-1"><Badge variant={campus.status === "active" ? "secondary" : "outline"}>{t(campus.status)}</Badge></dd></div>
        </dl>
      </DashboardCard>

      <section className="grid gap-3">
        <div>
          <h2 className="text-base font-medium text-ink">{t("roomsTitle")}</h2>
          <p className="mt-0.5 text-sm text-muted">{t("roomsIntro")}</p>
        </div>
        {campus.rooms.length === 0 ? (
          <DashboardEmptyCard>{t("emptyRooms")}</DashboardEmptyCard>
        ) : (
          <DashboardCardShell>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("roomName")}</TableHead>
                  <TableHead>{t("capacity")}</TableHead>
                  <TableHead>{t("status")}</TableHead>
                  <TableHead className="text-right">{t("actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {campus.rooms.map((room) => (
                  <TableRow key={room.id}>
                    <TableCell className="font-medium">{room.name}</TableCell>
                    <TableCell>{room.capacity ?? t("capacityUnset")}</TableCell>
                    <TableCell><Badge variant={room.status === "active" ? "secondary" : "outline"}>{t(room.status)}</Badge></TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-2">
                        <Button type="button" size="sm" variant="ghost" aria-label={t("editRoom", { room: room.name })} onClick={() => setEditingRoom(room)}>
                          <Pencil size={14} />
                        </Button>
                        {room.status === "active" ? (
                          <Button type="button" size="sm" variant="ghost" className="text-rose" aria-label={t("disableRoom", { room: room.name })} disabled={impactPending} onClick={() => loadImpact("room", room)}>
                            <Power size={14} />
                          </Button>
                        ) : (
                          <Button type="button" size="sm" variant="ghost" aria-label={t("enableRoom", { room: room.name })} disabled={changeRoomStatus.pending || campus.status !== "active"} onClick={() => changeRoomStatus.run({
                            roomId: room.id,
                            status: "active",
                            expectedUnstartedSessionCount: null,
                          })}>
                            <RotateCcw size={14} />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </DashboardCardShell>
        )}
      </section>

      <Dialog open={campusDialogOpen} onOpenChange={setCampusDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{t("editCampus")}</DialogTitle></DialogHeader>
          <div className="grid gap-4">
            <Label className="grid gap-1.5 text-sm font-normal text-muted">{t("campusName")}<Input value={campusName} onChange={(event) => setCampusName(event.target.value)} maxLength={100} className={inputClass} /></Label>
            <Label className="grid gap-1.5 text-sm font-normal text-muted">{t("address")}<Input value={campusAddress} onChange={(event) => setCampusAddress(event.target.value)} maxLength={500} className={inputClass} /></Label>
          </div>
          <DialogFooter>
            <Button type="button" size="sm" variant="secondary" disabled={saveCampus.pending} onClick={() => setCampusDialogOpen(false)}>{t("cancel")}</Button>
            <Button type="button" size="sm" disabled={saveCampus.pending || !campusName.trim()} onClick={() => saveCampus.run({
              campusId: campus.id,
              name: campusName,
              address: campusAddress,
              status: campus.status,
              expectedUnstartedSessionCount: null,
            })}>{saveCampus.pending && <LoaderCircle size={15} className="animate-spin motion-reduce:animate-none" />}{t("save")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <RoomEditDialog key={editingRoom?.id ?? "none"} room={editingRoom} pending={saveRoom.pending} close={() => setEditingRoom(null)} save={(roomId, name, capacity) => saveRoom.run({ roomId, name, capacity })} />

      <ConfirmDialog
        open={confirmation !== null}
        onOpenChange={(open) => { if (!open) setConfirmation(null); }}
        title={confirmation?.kind === "campus" ? t("archiveCampus") : t("disableRoomTitle")}
        description={confirmDescription}
        confirmLabel={confirmation?.kind === "campus" ? t("archiveCampus") : t("disable")}
        cancelLabel={t("cancel")}
        pending={changeCampusStatus.pending || changeRoomStatus.pending}
        onConfirm={confirmStatusChange}
      />
    </div>
  );
}

function RoomEditDialog({
  room,
  pending,
  close,
  save,
}: {
  room: CampusRoomV2 | null;
  pending: boolean;
  close: () => void;
  save: (roomId: string, name: string, capacity: number | null) => void;
}) {
  const t = useTranslations("school.locations");
  const [name, setName] = useState(room?.name ?? "");
  const [capacity, setCapacity] = useState(room?.capacity?.toString() ?? "");
  if (!room) return null;
  return (
    <Dialog key={room.id} open onOpenChange={(open) => { if (!open) close(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>{t("editRoomTitle", { room: room.name })}</DialogTitle></DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <Label className="grid gap-1.5 text-sm font-normal text-muted">{t("roomName")}<Input value={name} onChange={(event) => setName(event.target.value)} maxLength={100} className={inputClass} /></Label>
          <Label className="grid gap-1.5 text-sm font-normal text-muted">{t("capacity")}<Input type="number" min={1} max={500} value={capacity} onChange={(event) => setCapacity(event.target.value)} className={inputClass} /></Label>
        </div>
        <p className="text-xs text-muted">{t("roomNameHint")}</p>
        <DialogFooter>
          <Button type="button" size="sm" variant="secondary" disabled={pending} onClick={close}>{t("cancel")}</Button>
          <Button type="button" size="sm" disabled={pending || !name.trim()} onClick={() => save(room.id, name, capacityValue(capacity))}>
            {pending && <LoaderCircle size={15} className="animate-spin motion-reduce:animate-none" />}{t("save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
