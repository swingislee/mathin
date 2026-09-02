"use client";

import { useCallback, useState, type ReactNode } from "react";
import { Layers3, LayoutTemplate } from "lucide-react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { CoursewareEditorAdapterSurface } from "@/features/courseware-doc/CoursewareEditorAdapterSurface";
import {
  CoursewareFormalInspectorTabs,
  type CoursewareFormalInspectorTab,
} from "@/features/courseware-doc/CoursewareEditorWorkbench";
import type { ResolvedBindingUrls } from "@/features/courseware-doc/resolve";
import type { SourceRuntimePageDoc } from "@/features/courseware-doc/source-runtime-schema";
import {
  CoursewareFourByThreeComparison,
  CoursewareFourByThreePanel,
  useCoursewareFourByThreeAdapter,
} from "./CoursewareFourByThreeAdapter";
import {
  SourceRuntimeHostCapabilityPrototype,
  SourceRuntimeHostPreview,
  type SourceRuntimeHostPreviewMode,
} from "./SourceRuntimeHostCapabilityPrototype";

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
  const [tab, setTab] = useState<CoursewareFormalInspectorTab>("adjust");
  const [hostMode, setHostMode] = useState<SourceRuntimeHostPreviewMode>("original");
  const decorateStage = useCallback((stage: ReactNode) => (
    <SourceRuntimeHostPreview mode={hostMode}>{stage}</SourceRuntimeHostPreview>
  ), [hostMode]);
  const showingLayout = tab === "layout";

  return (
      <CoursewareEditorAdapterSurface
        toolbar={(
          <span className="flex items-center gap-2 text-xs text-muted">
            {showingLayout ? <LayoutTemplate className="size-4" /> : <Layers3 className="size-4" />}
            {showingLayout ? adaptationT("sourceToolbar") : t("sourcePrototypeToolbar")}
          </span>
        )}
        saveControls={<Badge variant="outline">{adaptationT("sessionOnly")}</Badge>}
        inspectorHeader={(
          <CoursewareFormalInspectorTabs
            value={tab}
            onValueChange={setTab}
            tabs={["adjust", "layout"]}
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
              {showingLayout
                ? <CoursewareFourByThreePanel adapter={fourByThree} />
                : <SourceRuntimeHostCapabilityPrototype mode={hostMode} onModeChange={setHostMode} />}
            </div>
          </ScrollArea>
        )}
        aspect={coarseLayout ? 16 / 9 : view === "adapted-4x3" ? 4 / 3 : doc.viewport.width / doc.viewport.height}
        hostProps={{ "data-courseware-editor-adapter": "source-runtime-page-v1" }}
        stageProps={{ "data-fitted-courseware-stage": true }}
      >
        <CoursewareFourByThreeComparison adapter={fourByThree} view={view} decorateStage={decorateStage} />
      </CoursewareEditorAdapterSurface>
  );
}
