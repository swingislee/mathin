"use client";

import { useTranslations } from "next-intl";
import { buttonVariants } from "@/components/ui/button";
import { Link, usePathname } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

const classroomSessionPattern = /^\/classroom\/([0-9a-f-]{36})\/session(?:\/.*)?$/i;

/**
 * 404 只能指向已经存在的语义上级，不能按字符串盲目截掉最后一段而生成死链接。
 */
export function resolveSemanticParent(pathname: string): string {
  const normalized = pathname.replace(/\/+$/, "") || "/";

  if (/^\/dashboard\/courseware\/assets(?:\/.*)?$/.test(normalized)) return "/dashboard/courseware/assets";
  if (/^\/dashboard\/courseware\/adapt(?:\/.*)?$/.test(normalized)) return "/dashboard/courseware/adapt";
  if (/^\/dashboard\/courseware\/lectures\/[^/]+(?:\/.*)?$/.test(normalized)) return "/dashboard/courseware";
  if (/^\/dashboard\/courseware(?:\/.*)?$/.test(normalized)) return "/dashboard/courseware";
  if (/^\/dashboard\/courses\/[^/]+(?:\/.*)?$/.test(normalized)) return "/dashboard/courses";
  if (/^\/dashboard\/classes\/[^/]+(?:\/.*)?$/.test(normalized)) return "/dashboard/classes";

  const classroomMatch = normalized.match(classroomSessionPattern);
  if (classroomMatch) return `/classroom/${classroomMatch[1]}`;

  if (/^\/dashboard\/[^/]+(?:\/.*)?$/.test(normalized)) return "/dashboard";
  const sectionMatch = normalized.match(/^\/(story|games|minds|terms|tools)(?:\/.*)?$/);
  if (sectionMatch) return `/${sectionMatch[1]}`;

  return "/";
}

export function NotFoundActions() {
  const t = useTranslations("notFound");
  const common = useTranslations("common");
  const parentHref = resolveSemanticParent(usePathname());

  return (
    <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
      <Link href={parentHref} className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}>
        {t("backUp")}
      </Link>
      <Link href="/" className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}>
        {common("backHome")}
      </Link>
    </div>
  );
}
