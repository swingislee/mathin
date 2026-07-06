import type { LucideIcon } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

export type PlanetAccent = "moon" | "star" | "crater" | "rose" | "leaf" | "cheek";

/**
 * 圆形星球入口（docs/plan/01-6）：圆 + 陨石棕描边 + 内容（图标或迷你星球）+ 下方标签。
 * 传 planetName 时，hover 标签从板块名切换为星球名（docs/plan/05-§4）。
 */
export function PlanetLink({ href, label, planetName, icon: Icon, art, accent, className, style }: {
  href: string;
  label: string;
  planetName?: string;
  icon?: LucideIcon;
  /** 自定义图形（如 MiniPlanet），优先于 icon */
  art?: ReactNode;
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
        {art ?? (Icon && <Icon size={18} strokeWidth={1.75} className="text-ink" />)}
      </span>
      {planetName ? (
        <span className="grid text-center text-xs text-muted transition-colors duration-200 group-hover:text-ink">
          <span className="col-start-1 row-start-1 transition-opacity duration-200 group-hover:opacity-0">{label}</span>
          <span className="col-start-1 row-start-1 whitespace-nowrap opacity-0 transition-opacity duration-200 group-hover:opacity-100">{planetName}</span>
        </span>
      ) : (
        <span className="text-xs text-muted transition-colors duration-200 group-hover:text-ink">{label}</span>
      )}
    </Link>
  );
}
