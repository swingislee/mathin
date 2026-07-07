import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { EmptyState } from "@/components/empty-state";
import { SectionShell, type Section } from "@/components/section-shell";
import { requireUser } from "@/lib/auth";

// tools/terms/minds/games/dashboard 已建成真实路由，从占位白名单移除（docs/plan/03-§6）
const publicSections = ["story"] as const;
const protectedSections = ["classroom", "notebook", "whiteboard"] as const;

export default async function SectionRoute({ params }: { params: Promise<{ locale: string; section: string }> }) {
  const { locale, section } = await params;
  const isPublic = publicSections.includes(section as (typeof publicSections)[number]);
  const isProtected = protectedSections.includes(section as (typeof protectedSections)[number]);
  if (!isPublic && !isProtected) notFound();
  if (isProtected) await requireUser(locale);
  const common = await getTranslations("common");
  return (
    <SectionShell section={section as Section}>
      <EmptyState message={common("comingSoon")} />
    </SectionShell>
  );
}
