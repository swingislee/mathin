"use client";

import { useTranslations } from "next-intl";
import { useAction } from "@/components/action-form";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useRouter } from "@/i18n/navigation";
import { setClassroomCoursewareTrackAction } from "./actions/classes";

export function CoursewareTrackSettings({
  classroomId,
  track,
}: {
  classroomId: string;
  track: "native-16x9" | "adapted-4x3";
}) {
  const t = useTranslations("school.classes");
  const router = useRouter();
  const update = useAction(setClassroomCoursewareTrackAction, {
    successMessage: t("coursewareTrackSaved"),
    errorMessage: { default: t("actionFailed") },
    onSuccess: () => router.refresh(),
  });

  return (
    <section className="rounded-xl border border-line bg-card p-5">
      <h2 className="font-medium">{t("coursewareTrackTitle")}</h2>
      <p className="mt-1 text-sm text-muted">{t("coursewareTrackDescription")}</p>
      <div className="mt-4 max-w-sm space-y-2">
        <Label htmlFor="class-courseware-track">{t("coursewareTrackDefault")}</Label>
        <Select
          value={track}
          disabled={update.pending}
          onValueChange={(value) => update.run(classroomId, value as "native-16x9" | "adapted-4x3")}
        >
          <SelectTrigger id="class-courseware-track"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="native-16x9">{t("coursewareTrackNative")}</SelectItem>
            <SelectItem value="adapted-4x3">{t("coursewareTrackAdapted")}</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </section>
  );
}
