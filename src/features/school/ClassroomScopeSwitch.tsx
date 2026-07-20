import { getTranslations } from "next-intl/server";
import { buttonVariants } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import type { ClassroomScope } from "./teaching-operations/types";

export async function ClassroomScopeSwitch({ activeScope, availableScopes }: { activeScope: ClassroomScope; availableScopes: readonly ClassroomScope[] }) {
  const t = await getTranslations("school.classes");
  return <nav aria-label={t("scopeLabel")} className="flex flex-wrap gap-2">
    {availableScopes.map((scope) => <Link key={scope} href={`/dashboard/classes?scope=${scope}`} aria-current={scope === activeScope ? "page" : undefined} className={cn(buttonVariants({ variant: scope === activeScope ? "primary" : "secondary", size: "sm" }), "h-9")}>{t(`scope_${scope}`)}</Link>)}
  </nav>;
}
