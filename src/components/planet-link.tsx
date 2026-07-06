import type { LucideIcon } from "lucide-react";
import type { CSSProperties } from "react";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

export type PlanetAccent = "moon" | "star" | "crater" | "rose" | "leaf" | "cheek";

/** 圆形星球入口（docs/plan/01-6）：56px 圆 + 陨石棕描边 + 图标 + 下方标签。 */
export function PlanetLink({ href, label, icon: Icon, accent, className, style }: {
  href: string;
  label: string;
  icon: LucideIcon;
  accent: PlanetAccent;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <Link
      href={href}
      style={{ ...style, "--planet-accent": `var(--${accent})` } as CSSProperties}
      className={cn("group flex flex-col items-center gap-2 outline-none", className)}
    >
      <span className="grid size-12 place-items-center rounded-full border-[1.5px] border-crater bg-card shadow-sm transition-[background-color,transform] duration-200 group-hover:-translate-y-0.5 group-hover:bg-[var(--planet-accent)] group-focus-visible:ring-2 group-focus-visible:ring-[var(--planet-accent)] group-focus-visible:ring-offset-2 group-focus-visible:ring-offset-paper">
        <Icon size={18} strokeWidth={1.75} className="text-ink" />
      </span>
      <span className="text-xs text-muted transition-colors duration-200 group-hover:text-ink">{label}</span>
    </Link>
  );
}
