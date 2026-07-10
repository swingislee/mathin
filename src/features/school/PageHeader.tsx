import type { ReactNode } from "react";

/**
 * 后台子页统一页头（P4C-0 §3.3）。页面第一元素即页头，与侧栏顶部（同为 py-6 起点）
 * 严格等高，消除反馈④「右侧标题比左侧导航矮一截」。返回类按钮进 actions 槽。
 */
export function SchoolPageHeader({
  title,
  eyebrow,
  actions,
  children,
}: {
  title: string;
  eyebrow?: string;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-3 border-b border-line pb-4">
      <div className="min-w-0">
        {eyebrow && <p className="text-[11px] uppercase tracking-[0.18em] text-crater">{eyebrow}</p>}
        <h1 className="font-display text-2xl">{title}</h1>
        {children}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </header>
  );
}
