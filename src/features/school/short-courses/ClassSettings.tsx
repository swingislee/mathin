"use client";

import { useState } from "react";
import { Settings } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { useAction } from "@/components/action-form";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ClassroomEditor } from "../ClassroomEditor";
import { ClassroomStaffDialog } from "../ClassroomStaffDialog";
import { transitionClassroomStatusAction } from "../actions/classes";
import type { ClassroomDetail, StaffOption } from "../classes";
import type { RoomOptionV2 } from "../organization-locations";
import { shortCourseMessages } from "./messages";

export function ShortCourseClassSettings({ classroom, teachers, rooms, locale, plannedLessons }: {
  classroom: ClassroomDetail; teachers: StaffOption[]; rooms: RoomOptionV2[]; locale: string; plannedLessons: number;
}) {
  const m = shortCourseMessages(locale), router = useRouter();
  const [open, setOpen] = useState(false);
  const lifecycle = useAction(transitionClassroomStatusAction, {
    successMessage: locale.startsWith("en") ? "Class status saved" : "班级状态已保存",
    errorMessage: { default: m.error }, onSuccess: () => router.refresh(),
  });
  const delivered = classroom.sessions.filter(session => session.state === "ended").length;
  const canComplete = delivered >= plannedLessons && plannedLessons > 0
    && !classroom.sessions.some(session => session.state === "started" || session.state === "scheduled");
  return <><Button size="sm" variant="secondary" title={m.settings} aria-label={m.settings} onClick={() => setOpen(true)}><Settings className="size-4" /></Button>
    <Sheet open={open} onOpenChange={setOpen}><SheetContent className="overflow-y-auto"><SheetHeader><SheetTitle>{m.settings}</SheetTitle></SheetHeader>
      <div className="space-y-5 py-5"><div className="flex flex-wrap gap-2"><ClassroomEditor classroom={classroom} roomOptions={rooms} />
        <ClassroomStaffDialog classroomId={classroom.id} staffAssignments={classroom.staffAssignments} staffOptions={teachers} />
      </div>
      <div className="space-y-3 border-t border-line pt-4"><p className="text-sm">{m.status} · {m[classroom.operationalStatus]}</p>
        {classroom.operationalStatus === "planning" && <Button size="sm" disabled={lifecycle.pending} onClick={() => lifecycle.run(classroom.id, "active")}>{locale.startsWith("en") ? "Activate class" : "启用班级"}</Button>}
        {classroom.operationalStatus === "active" && <><Button size="sm" disabled={lifecycle.pending || !canComplete} onClick={() => lifecycle.run(classroom.id, "completed")}>{m.finish}</Button>{!canComplete && <p className="text-xs text-muted">{m.finishHint}</p>}</>}
      </div></div>
    </SheetContent></Sheet>
  </>;
}
