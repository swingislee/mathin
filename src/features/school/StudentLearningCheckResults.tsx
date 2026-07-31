import { getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import type { MyLearningCheckResult, MyLearningCheckStatus } from "./customer";

function statusVariant(status: MyLearningCheckStatus): "default" | "secondary" | "outline" | "danger" {
  if (status === "independent") return "default";
  if (status === "incomplete") return "danger";
  if (status === "imitated") return "outline";
  return "secondary";
}

export async function StudentLearningCheckResults({
  locale,
  records,
  showClassroom = true,
}: {
  locale: string;
  records: MyLearningCheckResult[];
  showClassroom?: boolean;
}) {
  const [t, sessionT] = await Promise.all([
    getTranslations("school.students"),
    getTranslations("school.session"),
  ]);
  if (records.length === 0) return <p className="text-sm text-muted">{t("learningChecksEmpty")}</p>;

  const groups = new Map<string, MyLearningCheckResult[]>();
  for (const record of records) {
    const group = groups.get(record.sessionId) ?? [];
    group.push(record);
    groups.set(record.sessionId, group);
  }
  const dateTime = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" });

  return (
    <ol className="divide-y divide-line">
      {[...groups.values()].map((group) => {
        const session = group[0];
        const timestamp = session.scheduledAt ?? session.endedAt;
        return (
          <li key={session.sessionId} className="py-4 first:pt-0 last:pb-0">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                {showClassroom && <p className="truncate text-xs text-muted">{session.classroomName}</p>}
                <h3 className="truncate text-sm font-medium text-ink">{session.lectureName}</h3>
              </div>
              <div className="flex shrink-0 items-center gap-2 text-xs text-muted">
                <span>{t("learningCheckCount", { count: group.length })}</span>
                <time>{dateTime.format(new Date(timestamp))}</time>
              </div>
            </div>
            <ul className="mt-3 grid gap-2 sm:grid-cols-2">
              {group.map((record) => (
                <li key={record.checkId} className="flex min-w-0 items-center justify-between gap-3 rounded-lg border border-line bg-paper/45 px-3 py-2 text-sm">
                  <span className="min-w-0 truncate">{record.checkTitle}</span>
                  <Badge className="shrink-0" variant={statusVariant(record.status)}>
                    {sessionT(`learningStatus_${record.status}`)}
                  </Badge>
                </li>
              ))}
            </ul>
          </li>
        );
      })}
    </ol>
  );
}