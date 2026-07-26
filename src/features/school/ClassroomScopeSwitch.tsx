import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import type { ClassroomScope } from "./teaching-operations/types";

export async function ClassroomScopeSwitch({ activeScope, availableScopes }: { activeScope: ClassroomScope; availableScopes: readonly ClassroomScope[] }) {
  const t = await getTranslations("school.classes");
  return <nav aria-label={t("scopeLabel")} className="flex flex-wrap items-center gap-1">
    {availableScopes.map((scope) => (
      <Link
        key={scope}
        href={`/dashboard/classes?scope=${scope}`}
        aria-current={scope === activeScope ? "page" : undefined}
        className={scope === activeScope
          ? "rounded-full bg-ink px-3 py-1.5 text-xs font-medium text-paper"
          : "rounded-full px-3 py-1.5 text-xs text-muted transition hover:bg-paper/80 hover:text-ink"}
      >
        {t(`scope_${scope}`)}
      </Link>
    ))}
  </nav>;
}
