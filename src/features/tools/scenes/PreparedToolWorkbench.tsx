"use client";

import { getToolSceneDefinition } from "./registry";
import { ToolSceneEditor } from "./ToolSceneEditor";
import type { ToolScenePageHeader } from "./ToolSceneLibrary";

export function PreparedToolWorkbench({ id, pageHeader }: { id: string; pageHeader?: ToolScenePageHeader }) {
  const definition = getToolSceneDefinition(id);
  return definition ? <ToolSceneEditor version={definition.contentVersion} fullHeight pageHeader={pageHeader} /> : null;
}
