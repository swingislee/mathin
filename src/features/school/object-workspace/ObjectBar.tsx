import type { ReactNode } from "react";
import { GlobalFloatingControlsSafeArea, MainFloatingControlSafeArea } from "@/components/global-floating-controls";
import { DashboardBackLink } from "@/features/school/dashboard-page/DashboardBackLink";
import { cn } from "@/lib/utils";

/**
 * 对象上下文的一条：`{ label, value }`（doc 23 §4.2）。
 *
 * 旧 ObjectBar 只接一个 `context: ReactNode`，于是每个页面都在调用点 `.join(" · ")`
 * 拼一条长字符串："E 系列 · 三年级 · 张老师 · 学辅：李老师 · 12 人 · 下节课 3 月 4 日
 * 19:00"。这条串没有结构：不能按可用宽度决定丢哪几项，不能给"下一节课"加语义色，
 * 读屏用户听到的是一句无停顿的流水账，窄屏则整条被 truncate 成"E 系列 · 三年…"。
 * 改成结构化数组之后，丢弃与折行是布局的决定，不是调用点的字符串手艺。
 */
export interface ObjectContextItem {
  /** 省略时只渲染值（如产品码这种自解释信息）。 */
  label?: string;
  value: ReactNode;
}

/**
 * 对象工作区顶部条（doc 23 §4.2 重写）。
 *
 * 与 doc 21 的 DashboardPageHeader 是同一套身份语言，不是第二套页头：
 *   - 返回在最上、在对象身份**之前**，任何视口都可见（旧版排在状态之后且 `sm:` 起才显示）；
 *   - 标题行是稳定区域：标题 + 状态在左，主操作 + 溢出菜单在右，不靠 flex-wrap 碰运气；
 *   - 上下文是结构化条目，独占第三行，窄屏横向省略而不是把顶栏顶成三四行。
 *
 * 悬浮控件避让沿用 doc 21 §11.3 的测量占位（左上主控件 / 右上全局控件），不写死
 * pl-16 / pr-32——那些值只对"当时那几个按钮"成立。
 */
export function ObjectBar({
  title,
  backHref,
  backLabel,
  context,
  status,
  primaryAction,
  overflowSlot,
  floatingSafeArea = true,
  className,
}: {
  title: string;
  backHref?: string;
  backLabel?: string;
  context?: readonly ObjectContextItem[];
  status?: ReactNode;
  primaryAction?: ReactNode;
  overflowSlot?: ReactNode;
  /**
   * 工作区右侧另有 Rail 时置 false：那时右上悬浮控件压的是 Rail 而不是这条，
   * 安全区由 Rail 自己让，这条再让一次就是白白丢掉一截可用宽度。
   */
  floatingSafeArea?: boolean;
  className?: string;
}) {
  const items = context?.filter((item) => item.value !== null && item.value !== undefined && item.value !== "") ?? [];
  return (
    <header
      data-object-bar
      className={cn("grid min-w-0 shrink-0 grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-2", className)}
    >
      <MainFloatingControlSafeArea />

      <div className="flex min-h-16 min-w-0 flex-col justify-center gap-1 py-2.5 @2xl/chrome:min-h-[76px] @2xl/chrome:py-3">
        {backHref ? <DashboardBackLink href={backHref} label={backLabel ?? ""} /> : null}

        {/*
          窄容器下操作组整行下沉（`w-full` 强制换行，不是 flex-wrap 碰运气）。
          不这么做的话，390px 上"左上菜单安全区 64 + 右上悬浮控件安全区 128"已经吃掉一半宽度，
          剩下的再让给一个"用此版本建班"，标题就会被 truncate 成零宽——对象页最不能丢的
          恰恰是"我在处理什么"。
        */}
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
          <h1 className="min-w-0 flex-1 truncate font-display text-lg leading-tight text-ink @2xl/chrome:flex-none @2xl/chrome:text-xl">
            {title}
          </h1>
          {status ? <div className="flex shrink-0 items-center gap-1.5">{status}</div> : null}
          {primaryAction || overflowSlot ? (
            <div className="flex w-full shrink-0 items-center gap-2 @2xl/chrome:ml-auto @2xl/chrome:w-auto">
              {primaryAction}
              {overflowSlot}
            </div>
          ) : null}
        </div>

        {items.length > 0 ? <ObjectBarContext items={items} /> : null}
      </div>

      {floatingSafeArea ? <GlobalFloatingControlsSafeArea /> : <span />}
    </header>
  );
}

/**
 * 上下文行：单行、右侧溢出即裁掉。优先级由**数组顺序**表达，不额外给一个
 * `secondary` 布尔——溢出裁切已经是"越靠后越先消失"，再加一个开关只是让同一件事
 * 有两种说法，还会在 `display:none` 与 `:first-child` 之间制造分隔符错位。
 *
 * 分隔符用伪元素而不是独立节点：跟着自己那一项一起出现/消失，不会留下孤立的"·"。
 */
function ObjectBarContext({ items }: { items: readonly ObjectContextItem[] }) {
  return (
    <dl className="flex min-w-0 items-baseline gap-x-3 overflow-hidden text-sm text-muted">
      {items.map((item, index) => (
        <div
          key={index}
          className={cn(
            // shrink-0：溢出时整项被右侧裁掉，而不是每一项一起等比压成"MFH… · 1… · 暑"。
            // 前面的条目更重要，应该完整可读。
            "flex shrink-0 items-baseline gap-1.5 whitespace-nowrap",
            index > 0 && "before:mr-3 before:text-line before:content-['·']",
          )}
        >
          {item.label ? <dt className="text-xs text-muted/80">{item.label}</dt> : null}
          <dd>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
