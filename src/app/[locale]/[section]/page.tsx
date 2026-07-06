import { notFound } from "next/navigation";
import { SectionPage } from "@/components/section-page";
import { requireUser } from "@/lib/auth";

const publicSections = ["story", "games", "minds", "terms", "tools"] as const;
const protectedSections = ["dashboard", "classroom", "notebook", "whiteboard"] as const;
type Section = (typeof publicSections)[number] | (typeof protectedSections)[number];

export default async function SectionRoute({ params }: { params: Promise<{ locale: string; section: string }> }) {
  const { locale, section } = await params;
  const isPublic = publicSections.includes(section as (typeof publicSections)[number]);
  const isProtected = protectedSections.includes(section as (typeof protectedSections)[number]);
  if (!isPublic && !isProtected) notFound();
  if (isProtected) await requireUser(locale);
  return <SectionPage section={section as Section} locale={locale} showLogout={isProtected} />;
}
