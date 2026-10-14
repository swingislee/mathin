import { cn } from "@/lib/utils";

/**
 * 页面中单独加载的区域：写明正在等待的内容，配不确定进度条。
 * 页面其他部分先可用；进度条在减少动态时放慢但继续移动（globals.css）。
 */
export function SectionLoading({ label, hint, className }: { label: string; hint?: string; className?: string }) {
  return (
    <div role="status" aria-live="polite" className={cn("flex w-full flex-col items-center justify-center gap-3 px-6 py-10 text-center", className)}>
      <p className="text-sm text-ink">{label}</p>
      <div className="h-1 w-48 max-w-full overflow-hidden rounded-full bg-line/40" aria-hidden>
        <div className="section-loading-bar h-full w-1/3 rounded-full bg-crater/70" />
      </div>
      {hint ? <p className="max-w-sm text-xs text-muted">{hint}</p> : null}
    </div>
  );
}
