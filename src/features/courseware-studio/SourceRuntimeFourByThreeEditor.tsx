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
  CoursewareFourByThreeAdapter,
  CoursewareFourByThreeComparison,
  CoursewareFourByThreePanel,
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

  return (
    <CoursewareFourByThreeAdapter source={{ kind: "source-runtime", doc, bindingUrls }}>
      <CoursewareEditorAdapterSurface
        toolbar={(
          <span className="flex items-center gap-2 text-xs text-muted">
            <LayoutTemplate className="size-4" />
            {adaptationT("sourceToolbar")}
          </span>
        )}
        saveControls={<Badge variant="outline">{adaptationT("sessionOnly")}</Badge>}
        inspectorHeader={(
          <CoursewareFormalInspectorTabs
            value="layout"
            onValueChange={() => undefined}
            disabled={["adjust", "replace"]}
            labels={{
              adjust: t("prototypeTabAdjust"),
              layout: t("prototypeTabLayout"),
              replace: t("prototypeTabReplace"),
            }}
          />
        )}
        inspector={(
          <ScrollArea className="size-full min-h-0">
            <div className="px-4 py-4">
              <CoursewareFourByThreePanel />
            </div>
          </ScrollArea>
        )}
        aspect={16 / 9}
        hostProps={{ "data-courseware-editor-adapter": "source-runtime-page-v1" }}
        stageProps={{ "data-fitted-courseware-stage": true }}
      >
        <CoursewareFourByThreeComparison view={view} />
      </CoursewareEditorAdapterSurface>
    </CoursewareFourByThreeAdapter>
  );
}
