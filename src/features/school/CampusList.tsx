import { ArrowRight, Building2 } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { Link } from "@/i18n/navigation";
import { DashboardEmptyCard } from "./dashboard-page";
import type { CampusV2 } from "./organization-locations";

export async function CampusList({ campuses }: { campuses: CampusV2[] }) {
  const t = await getTranslations("school.locations");
  if (campuses.length === 0) return <DashboardEmptyCard>{t("emptyCampuses")}</DashboardEmptyCard>;

  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {campuses.map((campus) => {
        const activeRooms = campus.rooms.filter((room) => room.status === "active").length;
        return (
          <Link
            key={campus.id}
            href={`/dashboard/campuses/${campus.id}`}
            className="group min-w-0 rounded-2xl border border-line bg-card p-5 transition-colors hover:border-accent/50 hover:bg-moon/15"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-start gap-3">
                <span className="mt-0.5 rounded-xl bg-moon/30 p-2 text-accent"><Building2 size={18} /></span>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="truncate font-medium text-ink">{campus.name}</h2>
                    <Badge variant={campus.status === "active" ? "secondary" : "outline"}>{t(campus.status)}</Badge>
                  </div>
                  <p className="mt-1 line-clamp-2 text-sm text-muted">{campus.address || t("addressUnset")}</p>
                </div>
              </div>
              <ArrowRight size={17} className="mt-1 shrink-0 text-muted transition-transform group-hover:translate-x-0.5" />
            </div>
            <p className="mt-5 border-t border-line pt-3 text-xs text-muted">
              {t("roomSummary", { active: activeRooms, total: campus.rooms.length })}
            </p>
          </Link>
        );
      })}
    </div>
  );
}
