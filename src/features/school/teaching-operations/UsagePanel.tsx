import { getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { Link } from "@/i18n/navigation";
import type { ClassroomOperationalStatus, ClassroomUsage } from "./types";

const STATUS_KEY: Record<ClassroomOperationalStatus, string> = {
  planning: "usagePlanning",
  active: "usageActive",
  completed: "usageCompleted",
};

export async function UsagePanel({ usage }: { usage: ClassroomUsage[] }) {
  const t = await getTranslations("school.courses");
  const current = usage.filter((row) => row.archivedAt === null);
  const past = usage.filter((row) => row.archivedAt !== null);

  return <section className="rounded-2xl border border-line bg-card p-4">
    <h2 className="font-medium text-ink">{t("usage")}</h2>
    {usage.length === 0 ? <p className="mt-2 text-sm text-muted">{t("usageEmpty")}</p> : <div className="mt-3 grid gap-4">
      {current.length > 0 && <div>
        <h3 className="text-xs font-medium uppercase text-muted">{t("currentlyUsing")}</h3>
        <ul className="mt-1 divide-y divide-line">
          {current.map((row) => <li key={row.id} className="flex items-center justify-between gap-3 py-1.5 text-sm">
            <Link href={`/dashboard/classes/${row.id}`} className="min-w-0 truncate text-ink hover:text-crater">{row.name}</Link>
            <Badge variant="secondary">{t(STATUS_KEY[row.operationalStatus])}</Badge>
          </li>)}
        </ul>
      </div>}
      {past.length > 0 && <div>
        <h3 className="text-xs font-medium uppercase text-muted">{t("previouslyUsed")}</h3>
        <ul className="mt-1 divide-y divide-line">
          {past.map((row) => <li key={row.id} className="flex items-center justify-between gap-3 py-1.5 text-sm text-muted">
            <Link href={`/dashboard/classes/${row.id}`} className="min-w-0 truncate hover:text-crater">{row.name}</Link>
            <Badge variant="outline">{t(STATUS_KEY[row.operationalStatus])}</Badge>
          </li>)}
        </ul>
      </div>}
    </div>}
  </section>;
}
