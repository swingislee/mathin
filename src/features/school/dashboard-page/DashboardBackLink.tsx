import { ArrowLeft } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

/**
 * Dashboard 的唯一返回入口（doc 23 §4.3A）。
 *
 * 过去两套页头各写各的：普通页页头把它放在标题上方、`text-xs`、始终可见；对象工作区
 * 把它塞在标题、上下文、状态**之后**，还带 `hidden sm:inline-flex`——于是移动端上
 * 唯一的返回路径直接消失，用户只能靠浏览器后退，而后退在"从课表进课次、改完再回课表"
 * 这类动线里根本不成立。
 *
 * 统一后只有一种外观和一个位置：在对象身份之前。任何页面都不得再手写返回 Link
 * （scripts/verify-doc23-object-workspaces.mjs 会盯着这条）。
 */
export function DashboardBackLink({
  href,
  label,
  className,
}: {
  href: string;
  label: string;
  className?: string;
}) {
  return (
    <Link
      href={href}
      data-dashboard-back-link
      className={cn(
        // w-fit 已经是 min(max-content, 可用宽度)，不需要再补 max-w-full——
        // 那条还会撞上 doc21 §23 "页面骨架不得出现 max-w-*" 的防回退检查。
        "inline-flex w-fit items-center gap-1 rounded text-xs text-muted transition hover:text-ink",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-crater/60 focus-visible:ring-offset-2 focus-visible:ring-offset-paper",
        className,
      )}
    >
      <ArrowLeft size={14} className="shrink-0" />
      <span className="min-w-0 truncate">{label}</span>
    </Link>
  );
}
