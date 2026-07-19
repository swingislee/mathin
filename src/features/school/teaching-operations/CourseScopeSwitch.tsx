import { getTranslations } from "next-intl/server";
import { buttonVariants } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import type { CourseScope } from "./types";

export async function CourseScopeSwitch({ activeScope, availableScopes }: { activeScope: CourseScope; availableScopes: readonly CourseScope[] }) {
  const t = await getTranslations("school.courses");
  return <nav aria-label={t("scopeLabel")} className="flex flex-wrap gap-2">
    {availableScopes.map((scope) => <Link key={scope} href={`/dashboard/courses?scope=${scope}`} aria-current={scope === activeScope ? "page" : undefined} className={cn(buttonVariants({ variant: scope === activeScope ? "primary" : "secondary", size: "sm" }), "h-9")}>{t(`scope_${scope}`)}</Link>)}
  </nav>;
}
