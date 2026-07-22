import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getRosterMismatchCount } from "@/features/school/dashboard";
import { SchoolPageHeader } from "@/features/school/PageHeader";
import { StatusStrip, type StatusStripItem } from "@/features/school/stage/StatusStrip";
import { Link } from "@/i18n/navigation";
import { getMyPerms, requirePerm } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}

interface OperationalErrorRow {
  id: string;
  occurred_at: string;
  event: string;
  message: string;
  digest: string | null;
  method: string | null;
  route_path: string | null;
  route_type: string | null;
  environment: string | null;
  release: string | null;
}

export default async function OperationsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const user = await requirePerm(locale, "audit.view");
  const [t, homeT, format, supabase, perms] = await Promise.all([
    getTranslations("school.operations"),
    getTranslations("school.home"),
    getFormatter(),
    createClient(),
    getMyPerms(user.id),
  ]);
  const canRosterMismatch = perms.has("class.view.all");
  const [{ data, error }, rosterMismatch] = await Promise.all([
    supabase
      .from("operational_errors")
      .select("id,occurred_at,event,message,digest,method,route_path,route_type,environment,release")
      .order("occurred_at", { ascending: false })
      .limit(200)
      .returns<OperationalErrorRow[]>(),
    canRosterMismatch ? safe(getRosterMismatchCount, { unlinkedEnrollments: 0, orphanMembers: 0 }) : Promise.resolve(null),
  ]);
  if (error) throw new Error(error.message);
  const rows = data ?? [];

  const statusItems: StatusStripItem[] = rosterMismatch
    ? [
        { label: homeT("rosterUnlinked"), value: rosterMismatch.unlinkedEnrollments, tone: rosterMismatch.unlinkedEnrollments > 0 ? "warning" : "default" },
        { label: homeT("rosterOrphan"), value: rosterMismatch.orphanMembers, tone: rosterMismatch.orphanMembers > 0 ? "warning" : "default" },
      ]
    : [];

  return (
    <div className="mx-auto w-full max-w-6xl">
      <SchoolPageHeader
        title={t("title")}
        actions={<Link href="/dashboard/operations/legacy-home" className="text-xs text-muted underline underline-offset-2 hover:text-ink">{t("legacyHomeLinkLabel")}</Link>}
      >
        <p className="mt-1 max-w-3xl text-sm text-muted">{t("intro")}</p>
      </SchoolPageHeader>
      {statusItems.length > 0 && <StatusStrip items={statusItems} className="mt-4" />}
      <div className="mt-6 overflow-hidden rounded-2xl border border-line bg-card">
        {rows.length === 0 ? (
          <p className="p-8 text-center text-sm text-muted">{t("empty")}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("time")}</TableHead>
                <TableHead>{t("route")}</TableHead>
                <TableHead>{t("message")}</TableHead>
                <TableHead>{t("release")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="whitespace-nowrap text-xs text-muted">
                    {format.dateTime(new Date(row.occurred_at), { dateStyle: "short", timeStyle: "medium" })}
                  </TableCell>
                  <TableCell className="max-w-56">
                    <div className="truncate font-medium">{row.method ?? "—"} {row.route_path ?? row.event}</div>
                    <div className="mt-1 text-xs text-muted">{[row.route_type, row.environment, row.digest].filter(Boolean).join(" · ")}</div>
                  </TableCell>
                  <TableCell className="max-w-xl break-words">{row.message}</TableCell>
                  <TableCell className="text-xs text-muted">{row.release ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}
