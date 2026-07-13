import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SchoolPageHeader } from "@/features/school/PageHeader";
import { requirePerm } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

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
  await requirePerm(locale, "audit.view");
  const [t, format, supabase] = await Promise.all([
    getTranslations("school.operations"),
    getFormatter(),
    createClient(),
  ]);
  const { data, error } = await supabase
    .from("operational_errors")
    .select("id,occurred_at,event,message,digest,method,route_path,route_type,environment,release")
    .order("occurred_at", { ascending: false })
    .limit(200)
    .returns<OperationalErrorRow[]>();
  if (error) throw new Error(error.message);
  const rows = data ?? [];

  return (
    <div className="mx-auto w-full max-w-6xl">
      <SchoolPageHeader title={t("title")}>
        <p className="mt-1 max-w-3xl text-sm text-muted">{t("intro")}</p>
      </SchoolPageHeader>
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
