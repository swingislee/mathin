"use server";

import { z } from "zod";
import type { Json } from "@/lib/database.types";
import { getActiveEnvironment } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export interface ChangeEvent {
  id: string;
  type: string;
  occurredAt: string;
  link: string | null;
  payload: Record<string, unknown>;
  unread: boolean;
}

function studentLearningLink(type: string): string | null {
  if (type.startsWith("leave_request.") || type === "session_change.makeup") {
    return "/dashboard/coursework#leave";
  }
  if (
    type.startsWith("learning_result.")
    || type.startsWith("knowledge_summary.")
    || type.startsWith("review.")
    || type.startsWith("attendance.")
  ) {
    return "/dashboard/progress#learning-results";
  }
  return null;
}

function familyLearningLink(type: string, payload: Record<string, unknown>): string | null {
  const studentId = typeof payload.studentId === "string" ? payload.studentId : null;
  const suffix = studentId ? `?child=${encodeURIComponent(studentId)}` : "";
  if (type.startsWith("leave_request.") || type === "session_change.makeup") {
    return `/dashboard/children${suffix}#leave`;
  }
  if (
    type.startsWith("learning_result.")
    || type.startsWith("knowledge_summary.")
    || type.startsWith("review.")
    || type.startsWith("attendance.")
  ) {
    return `/dashboard/children${suffix}#learning-results`;
  }
  return null;
}

function fallbackLink(type: string): string {
  if (type.startsWith("payment.") || type.startsWith("refund.")) return "/dashboard/finance";
  if (type.startsWith("classroom.")) return "/dashboard/classes";
  if (type.startsWith("approval.")) return "/dashboard/coordination";
  return "/dashboard";
}

function actionableLink(
  type: string,
  link: string | null,
  payload: Record<string, unknown>,
  environment: Awaited<ReturnType<typeof getActiveEnvironment>>,
): string {
  if (environment === "learning") {
    return studentLearningLink(type) ?? link ?? fallbackLink(type);
  }
  if (environment === "family") {
    return familyLearningLink(type, payload) ?? link ?? fallbackLink(type);
  }
  return link ?? fallbackLink(type);
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
  const environment = await getActiveEnvironment(authData.user.id);
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
  return (data ?? []).map((row) => {
    const payload = objectPayload(row.payload);
    return {
      id: row.id,
      type: row.notification_key,
      occurredAt: row.occurred_at,
      link: actionableLink(row.notification_key, row.deep_link, payload, environment),
      payload,
      unread: row.read_at === null,
    };
  });
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
