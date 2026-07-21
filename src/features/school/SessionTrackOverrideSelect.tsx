"use client";

import { useTranslations } from "next-intl";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAction } from "@/components/action-form";
import { useRouter } from "@/i18n/navigation";
import { setSessionCoursewareTrackOverrideAction } from "./actions/classes";

/** 本次轨道（doc19 §14.3"本次覆盖"的一部分）；与 SessionManagementDrawer 的同款控件各自内联，两处都很小，不值得抽共享组件。 */
export function SessionTrackOverrideSelect({
  sessionId,
  override,
}: {
  sessionId: string;
  override: "native-16x9" | "adapted-4x3" | null;
}) {
  const t = useTranslations("school.classes");
  const router = useRouter();
  const trackRun = useAction(setSessionCoursewareTrackOverrideAction, {
    successMessage: t("coursewareTrackSaved"),
    errorMessage: { default: t("actionFailed") },
    onSuccess: () => router.refresh(),
  });

  return (
    <Select
      value={override ?? "inherit"}
      disabled={trackRun.pending}
      onValueChange={(value) => trackRun.run(sessionId, value === "inherit" ? null : (value as "native-16x9" | "adapted-4x3"))}
    >
      <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value="inherit">{t("coursewareTrackInherit")}</SelectItem>
        <SelectItem value="native-16x9">{t("coursewareTrackNative")}</SelectItem>
        <SelectItem value="adapted-4x3">{t("coursewareTrackAdapted")}</SelectItem>
      </SelectContent>
    </Select>
  );
}
