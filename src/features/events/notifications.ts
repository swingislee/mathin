"use server";

import { z } from "zod";
import type { Json } from "@/lib/database.types";
import { createClient } from "@/lib/supabase/server";

export interface ChangeEvent {
  id: string;
  type: string;
  occurredAt: string;
  link: string | null;
  payload: Record<string, unknown>;
  unread: boolean;
}

function fallbackLink(type: string): string {
  if (type.startsWith("payment.") || type.startsWith("refund.")) return "/dashboard/finance";
  if (type.startsWith("review.") || type.startsWith("attendance.")) return "/dashboard/children";
  if (type.startsWith("classroom.")) return "/dashboard/classes";
  if (type.startsWith("approval.")) return "/dashboard/coordination";
  return "/dashboard";
}

function objectPayload(payload: Json): Record<string, unknown> {
  return payload && typeof payload === "object" && !Array.isArray(payload)
    ? payload as Record<string, unknown>
    : {};
}

export async function getInitialChangeFeed(): Promise<ChangeEvent[]> {
  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) return [];
  const { data, error } = await supabase
    .from("notifications")
    .select("id,notification_key,occurred_at,deep_link,payload,read_at")
    .is("archived_at", null)
    .is("read_at", null)
    .order("occurred_at", { ascending: false })
    .limit(20)
    .returns<Array<{
      id: string;
      notification_key: string;
      occurred_at: string;
      deep_link: string | null;
      payload: Json;
      read_at: string | null;
    }>>();
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    id: row.id,
    type: row.notification_key,
    occurredAt: row.occurred_at,
    link: row.deep_link ?? fallbackLink(row.notification_key),
    payload: objectPayload(row.payload),
    unread: row.read_at === null,
  }));
}

const notificationIdSchema = z.string().uuid();

export async function markChangeFeedItemRead(notificationId: string): Promise<void> {
  const parsed = notificationIdSchema.safeParse(notificationId);
  if (!parsed.success) throw new Error("VALIDATION");
  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) throw new Error("UNAUTHENTICATED");
  const { error } = await supabase.rpc("mark_notification_read", { p_notification_id: parsed.data });
  if (error) throw new Error(error.message);
}

export async function markChangeFeedRead(latestVisibleNotificationId: string): Promise<void> {
  const parsed = notificationIdSchema.safeParse(latestVisibleNotificationId);
  if (!parsed.success) throw new Error("VALIDATION");
  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) throw new Error("UNAUTHENTICATED");
  const { error } = await supabase.rpc("mark_notifications_read_through", { p_notification_id: parsed.data });
  if (error) throw new Error(error.message);
}
