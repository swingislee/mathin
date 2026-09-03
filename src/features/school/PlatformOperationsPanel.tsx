import { getFormatter, getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DashboardCardShell, DashboardEmptyCard, DashboardTableShell, StatusStrip } from "./dashboard-page";
import { JobReplayButton } from "./JobReplayButton";
import { createClient } from "@/lib/supabase/server";

interface DeadLetter {
  id: string;
  kind: string;
  attemptCount: number;
  maxAttempts: number;
  errorCode: string | null;
  errorMessage: string | null;
  deadLetteredAt: string;
}

interface FilePolicySnapshot {
  bucketId: string;
  accessMode: "public" | "signed" | "service";
  uploadProtocol: "standard" | "tus" | "service";
  maxBytes: number;
  quotaBytes: number | null;
  retentionDays: number | null;
  enabled: boolean;
}

interface IntegrationSnapshot {
  channel: "email" | "sms" | "wechat" | "webhook" | "web_push";
  providerKey: string | null;
  status: "disabled" | "enabled" | "degraded";
  secretConfigured: boolean;
  consecutiveFailures: number;
  degradedUntil: string | null;
}

interface WorkerSnapshot {
  workerId: string;
  version: string;
  lastSeenAt: string;
  processedCount: number;
  failedCount: number;
}

interface OperationsSnapshot {
  jobs: {
    pending: number;
    running: number;
    succeeded24h: number;
    dead: number;
    oldestDueAt: string | null;
    deadLetters: DeadLetter[];
  };
  notifications: { total24h: number; unread: number; failedDeliveries: number; queuedDeliveries: number };
  webPush?: {
    featureEnabled: boolean;
    rolloutMembers: number;
    activeSubscriptions: number;
    sharedSubscriptions: number;
    expiredOrGoneSubscriptions: number;
    queued: number;
    sent24h: number;
    suppressed24h: number;
    failed: number;
    oldestDueAt: string | null;
    workerStale: boolean;
  };
  files: {
    activeUploads: number;
    orphansDue: number;
    cleanupPending: number;
    rejected: number;
    policies: FilePolicySnapshot[];
  };
  integrations: IntegrationSnapshot[];
  workers: WorkerSnapshot[];
}

function statusTone(value: number): "critical" | "warning" | "default" {
  return value > 0 ? "critical" : "default";
}

export async function PlatformOperationsPanel({ canManage }: { canManage: boolean }) {
  const [t, format, supabase] = await Promise.all([
    getTranslations("school.operations"),
    getFormatter(),
    createClient(),
  ]);
  const { data, error } = await supabase.rpc("get_platform_operations_snapshot");
  if (error) throw new Error(error.message);
  const snapshot = data as unknown as OperationsSnapshot;
  const webPush = snapshot.webPush ?? {
    featureEnabled: false,
    rolloutMembers: 0,
    activeSubscriptions: 0,
    sharedSubscriptions: 0,
    expiredOrGoneSubscriptions: 0,
    queued: 0,
    sent24h: 0,
    suppressed24h: 0,
    failed: 0,
    oldestDueAt: null,
    workerStale: false,
  };

  const status = [
    { label: t("jobsPending"), value: snapshot.jobs.pending, tone: snapshot.jobs.pending > 0 ? "warning" as const : "default" as const },
    { label: t("jobsRunning"), value: snapshot.jobs.running, tone: "default" as const },
    { label: t("deadLetters"), value: snapshot.jobs.dead, tone: statusTone(snapshot.jobs.dead) },
    { label: t("failedDeliveries"), value: snapshot.notifications.failedDeliveries, tone: statusTone(snapshot.notifications.failedDeliveries) },
    { label: t("webPushFailed"), value: webPush.failed, tone: statusTone(webPush.failed) },
    { label: t("webPushWorkerStale"), value: webPush.workerStale ? 1 : 0, tone: webPush.workerStale ? "warning" as const : "default" as const },
    { label: t("fileCleanupPending"), value: snapshot.files.cleanupPending, tone: snapshot.files.cleanupPending > 0 ? "warning" as const : "default" as const },
  ];

  return (
    <div className="grid gap-5">
      <StatusStrip items={status} />
      <div className="grid gap-5 @4xl/page:grid-cols-2">
        <DashboardTableShell>
          <div className="border-b border-line px-5 py-4">
            <h2 className="text-base font-medium text-ink">{t("jobRuntimeTitle")}</h2>
            <p className="mt-1 text-sm text-muted">{t("jobRuntimeIntro", { succeeded: snapshot.jobs.succeeded24h })}</p>
          </div>
          {snapshot.jobs.deadLetters.length === 0 ? (
            <p className="px-5 py-6 text-sm text-muted">{t("noDeadLetters")}</p>
          ) : (
            <Table>
              <TableHeader><TableRow>
                <TableHead>{t("jobKind")}</TableHead><TableHead>{t("attempts")}</TableHead>
                <TableHead>{t("failure")}</TableHead><TableHead className="text-right">{t("action")}</TableHead>
              </TableRow></TableHeader>
              <TableBody>{snapshot.jobs.deadLetters.map((job) => (
                <TableRow key={job.id}>
                  <TableCell><div className="font-mono text-xs">{job.kind}</div><div className="mt-1 text-xs text-muted">{format.dateTime(new Date(job.deadLetteredAt), { dateStyle: "short", timeStyle: "short" })}</div></TableCell>
                  <TableCell>{job.attemptCount}/{job.maxAttempts}</TableCell>
                  <TableCell className="max-w-72"><div className="text-xs font-medium">{job.errorCode ?? "—"}</div><div className="mt-1 line-clamp-2 text-xs text-muted">{job.errorMessage ?? "—"}</div></TableCell>
                  <TableCell className="text-right">{canManage ? <JobReplayButton jobId={job.id} /> : "—"}</TableCell>
                </TableRow>
              ))}</TableBody>
            </Table>
          )}
        </DashboardTableShell>

        <DashboardCardShell>
          <div className="border-b border-line px-5 py-4">
            <h2 className="text-base font-medium text-ink">{t("integrationsTitle")}</h2>
            <p className="mt-1 text-sm text-muted">{t("integrationsIntro")}</p>
          </div>
          <ul className="divide-y divide-line">{snapshot.integrations.map((integration) => (
            <li key={integration.channel} className="flex items-center gap-3 px-5 py-3 text-sm">
              <span className="min-w-0 flex-1"><span className="font-medium">{t(`channel_${integration.channel}`)}</span><span className="ml-2 text-xs text-muted">{integration.providerKey ?? t("providerUnselected")}</span></span>
              <Badge variant={integration.status === "enabled" ? "default" : integration.status === "degraded" ? "danger" : "outline"}>{t(`integration_${integration.status}`)}</Badge>
            </li>
          ))}</ul>
        </DashboardCardShell>
      </div>

      <DashboardCardShell>
        <div className="flex flex-wrap items-start gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-medium text-ink">{t("webPushTitle")}</h2>
            <p className="mt-1 text-sm text-muted">{t("webPushIntro")}</p>
          </div>
          <Badge variant={webPush.featureEnabled ? "default" : "outline"}>
            {webPush.featureEnabled ? t("webPushFeatureOn") : t("webPushFeatureOff")}
          </Badge>
        </div>
        <dl className="grid gap-px bg-line sm:grid-cols-2 lg:grid-cols-4">
          {([
            ["webPushRollout", webPush.rolloutMembers],
            ["webPushActive", webPush.activeSubscriptions],
            ["webPushShared", webPush.sharedSubscriptions],
            ["webPushQueued", webPush.queued],
            ["webPushSent24h", webPush.sent24h],
            ["webPushSuppressed24h", webPush.suppressed24h],
            ["webPushExpiredGone", webPush.expiredOrGoneSubscriptions],
            ["webPushFailed", webPush.failed],
          ] as const).map(([label, value]) => (
            <div key={label} className="bg-card px-5 py-4">
              <dt className="text-xs text-muted">{t(label)}</dt>
              <dd className="mt-1 text-xl font-medium text-ink">{format.number(value)}</dd>
            </div>
          ))}
        </dl>
        <p className="border-t border-line px-5 py-3 text-xs text-muted">
          {webPush.oldestDueAt
            ? t("webPushOldestDue", { time: format.dateTime(new Date(webPush.oldestDueAt), { dateStyle: "short", timeStyle: "medium" }) })
            : t("webPushNoDue")}
        </p>
      </DashboardCardShell>

      <DashboardTableShell>
        <div className="border-b border-line px-5 py-4">
          <h2 className="text-base font-medium text-ink">{t("fileGovernanceTitle")}</h2>
          <p className="mt-1 text-sm text-muted">{t("fileGovernanceIntro", { uploads: snapshot.files.activeUploads, orphans: snapshot.files.orphansDue, rejected: snapshot.files.rejected })}</p>
        </div>
        <Table>
          <TableHeader><TableRow>
            <TableHead>{t("bucket")}</TableHead><TableHead>{t("access")}</TableHead><TableHead>{t("protocol")}</TableHead>
            <TableHead>{t("maxSize")}</TableHead><TableHead>{t("retention")}</TableHead>
          </TableRow></TableHeader>
          <TableBody>{snapshot.files.policies.map((policy) => (
            <TableRow key={policy.bucketId}>
              <TableCell className="font-mono text-xs">{policy.bucketId}</TableCell>
              <TableCell>{t(`access_${policy.accessMode}`)}</TableCell>
              <TableCell><Badge variant="outline">{policy.uploadProtocol.toUpperCase()}</Badge></TableCell>
              <TableCell>{format.number(policy.maxBytes / 1024 / 1024, { maximumFractionDigits: 0 })} MB</TableCell>
              <TableCell>{policy.retentionDays ? t("retentionDays", { days: policy.retentionDays }) : t("retentionLinked")}</TableCell>
            </TableRow>
          ))}</TableBody>
        </Table>
      </DashboardTableShell>

      {snapshot.workers.length === 0 ? (
        <DashboardEmptyCard>{t("noWorkers")}</DashboardEmptyCard>
      ) : (
        <DashboardCardShell>
          <div className="border-b border-line px-5 py-4"><h2 className="text-base font-medium text-ink">{t("workersTitle")}</h2></div>
          <ul className="divide-y divide-line">{snapshot.workers.map((worker) => (
            <li key={worker.workerId} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
              <span className="font-mono text-xs">{worker.workerId}</span><Badge variant="outline">{worker.version}</Badge>
              <span className="ml-auto text-xs text-muted">{t("workerCounts", { processed: worker.processedCount, failed: worker.failedCount })} · {format.dateTime(new Date(worker.lastSeenAt), { dateStyle: "short", timeStyle: "medium" })}</span>
            </li>
          ))}</ul>
        </DashboardCardShell>
      )}
    </div>
  );
}
