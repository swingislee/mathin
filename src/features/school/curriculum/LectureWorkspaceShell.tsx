import type { ReactNode } from "react";

/** 讲次工作区整页布局：正文+决策栏左右并排（窄屏纵向堆叠）。 */
export function LectureWorkspaceShell({ body, decisionRail }: { body: ReactNode; decisionRail: ReactNode }) {
  return <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{body}</div>
    {decisionRail}
  </div>;
}
