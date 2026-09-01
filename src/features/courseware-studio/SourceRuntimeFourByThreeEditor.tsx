"use client";

import { LayoutTemplate } from "lucide-react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { CoursewareEditorAdapterSurface } from "@/features/courseware-doc/CoursewareEditorAdapterSurface";
import { CoursewareFormalInspectorTabs } from "@/features/courseware-doc/CoursewareEditorWorkbench";
import type { ResolvedBindingUrls } from "@/features/courseware-doc/resolve";
import type { SourceRuntimePageDoc } from "@/features/courseware-doc/source-runtime-schema";
import {
  CoursewareFourByThreeComparison,
  CoursewareFourByThreePanel,
  useCoursewareFourByThreeAdapter,
} from "./CoursewareFourByThreeAdapter";

export function SourceRuntimeFourByThreeEditor({
  doc,
  bindingUrls,
  view,
}: {
  doc: SourceRuntimePageDoc;
  bindingUrls: ResolvedBindingUrls;
  view: "compare" | "native-16x9" | "adapted-4x3";
}) {
  const t = useTranslations("coursewareWorkspace");
  const adaptationT = useTranslations("coursewareFourByThree");
  const fourByThree = useCoursewareFourByThreeAdapter({ kind: "source-runtime", doc, bindingUrls });
  const coarseLayout = view === "compare";

  return (
      <CoursewareEditorAdapterSurface
        toolbar={coarseLayout ? (
          <span className="flex items-center gap-2 text-xs text-muted">
            <LayoutTemplate className="size-4" />
            {adaptationT("sourceToolbar")}
          </span>
        ) : null}
        saveControls={<Badge variant="outline">{coarseLayout ? adaptationT("sessionOnly") : t("sourceReadOnlyStatus")}</Badge>}
        inspectorHeader={coarseLayout ? (
          <CoursewareFormalInspectorTabs
            value="layout"
            onValueChange={() => undefined}
            tabs={["layout"]}
            labels={{
              adjust: t("prototypeTabAdjust"),
              layout: t("prototypeTabLayout"),
              replace: t("prototypeTabReplace"),
            }}
          />
        ) : undefined}
        inspector={(
          <ScrollArea className="size-full min-h-0">
            <div className="px-4 py-4">
              {coarseLayout ? <CoursewareFourByThreePanel adapter={fourByThree} /> : (
                <div className="space-y-2">
                  <p className="text-sm font-medium text-ink">{t("sourceReadOnlyTitle")}</p>
                  <p className="text-xs leading-5 text-muted">{t("sourceReadOnlyDescription")}</p>
                </div>
              )}
            </div>
          </ScrollArea>
        )}
        aspect={coarseLayout ? 16 / 9 : view === "adapted-4x3" ? 4 / 3 : doc.viewport.width / doc.viewport.height}
        hostProps={{ "data-courseware-editor-adapter": "source-runtime-page-v1" }}
        stageProps={{ "data-fitted-courseware-stage": true }}
      >
        <CoursewareFourByThreeComparison adapter={fourByThree} view={view} />
      </CoursewareEditorAdapterSurface>
  );
}
