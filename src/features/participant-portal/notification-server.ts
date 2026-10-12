import "server-only";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { authorize, requireResult, response } from "@/features/parent-portal/server";
import type { RegistrationRpc } from "@/features/parent-portal/course-server";
import { callProvider, connectedProvider, providerActor } from "./provider-transport";
import { readPublishedSettings } from "./settings-server";
export async function notificationsGet(request: Request) { const { db } = await authorize(request); return response(requireResult(await (db.rpc as unknown as RegistrationRpc)("miniapp_notifications", {}))); }
export async function dispatchExperienceNotifications() {
  const db = createAdminClient(), rpc = (db.rpc as unknown as RegistrationRpc).bind(db), connections = (await readPublishedSettings()).config?.experience?.connections || [];
  const rows = requireResult(await rpc("miniapp_notification_claim", {})) as { id: string; owner_id: string; connection_id: string; channel: string; template_key: string; event: string; title: unknown; body: unknown; data: unknown; attempts: number }[];
  let accepted = 0;
  for (const row of rows) { let success = false;
    try { const connection = connections.find(c => c.id === row.connection_id); if (!connection) throw new Error("UNAVAILABLE");
      const config = await connectedProvider(connection, "notifications.send", ["notifications.v1", "idempotency.v1"]);
      const result = z.object({ accepted: z.literal(true) }).strict().parse(await callProvider(config, "notifications.send", {
        requestId: row.id, actor: providerActor(config, row.owner_id), channel: row.channel, templateKey: row.template_key, event: row.event, title: row.title, body: row.body,
        data: Object.fromEntries(Object.entries(row.data as Record<string, unknown>).filter(([key]) => key !== "studentId")),
      })); success = result.accepted; if (success) accepted++;
    } catch { /* The durable outbox retains failed attempts with bounded backoff; secrets never enter error output. */ }
    requireResult(await rpc("miniapp_notification_ack", { p_id: row.id, p_attempt: row.attempts, p_success: success }));
  }
  return { processed: rows.length, accepted, retrying: rows.length - accepted };
}
