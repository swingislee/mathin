"use client";

import { getToolSceneDefinition } from "./registry";
import { ToolSceneEditor } from "./ToolSceneEditor";

export function PreparedToolWorkbench({ id }: { id: string }) {
  const definition = getToolSceneDefinition(id);
  return definition ? <ToolSceneEditor version={definition.contentVersion} fullHeight /> : null;
}
