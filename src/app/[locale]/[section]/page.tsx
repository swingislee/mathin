import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { EmptyState } from "@/components/empty-state";
import { SectionShell, type Section } from "@/components/section-shell";

// 其余板块均已建成真实路由；story 待 P5（docs/plan/03-§6）
const publicSections = ["story"] as const;

export default async function SectionRoute({ params }: { params: Promise<{ locale: string; section: string }> }) {
  const { section } = await params;
  if (!publicSections.includes(section as (typeof publicSections)[number])) notFound();
  const common = await getTranslations("common");
  return (
    <SectionShell section={section as Section}>
      <EmptyState message={common("comingSoon")} />
    </SectionShell>
  );
}
