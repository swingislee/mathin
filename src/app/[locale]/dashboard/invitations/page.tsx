import { redirect } from "@/i18n/navigation";

export default async function LegacyFollowupRoute({ params, searchParams }: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [values, raw] = await Promise.all([params, searchParams]);
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === "string") query.set(key, value);
    else if (Array.isArray(value)) value.forEach((item) => query.append(key, item));
  }
  redirect({ locale: values.locale, href: `/dashboard/followups/communication${query.size ? `?${query}` : ""}` });
}
