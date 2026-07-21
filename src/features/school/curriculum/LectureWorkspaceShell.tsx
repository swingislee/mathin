import type { ReactNode } from "react";

/**
 * 完整页版本的正文+决策栏并排布局，镜像 ObjectOverlay 内部的
 * `flex min-h-0 flex-1 flex-col lg:flex-row` 组合，保持两种形态视觉一致。
 */
export function LectureWorkspaceShell({ body, decisionRail }: { body: ReactNode; decisionRail: ReactNode }) {
  return <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{body}</div>
    {decisionRail}
  </div>;
}
