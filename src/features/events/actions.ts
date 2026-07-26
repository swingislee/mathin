"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const USER_NOTIFICATION_TYPES = [
  "payment.recorded",
  "review.insert",
  "review.update",
  "classroom.staff.assigned",
  "classroom.staff.removed",
  "classroom.staff.primary_support_set",
] as const;

export interface ChangeEvent {
  id: string;
  type: string;
  occurredAt: string;
  link: string | null;
  unread: boolean;
}

export async function getInitialChangeFeed(): Promise<ChangeEvent[]> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];
  const [{ data: events }, { data: cursor }, { data: profile }] = await Promise.all([
    supabase.from("domain_events").select("id,event_type,entity_type,entity_id,occurred_at,event_link,actor_id,target_user_id")
      .in("event_type", USER_NOTIFICATION_TYPES).order("occurred_at",{ascending:false}).limit(40)
      .returns<Array<{id:string;event_type:string;entity_type:string;entity_id:string|null;occurred_at:string;event_link:string|null;actor_id:string|null;target_user_id:string|null}>>(),
    supabase.from("user_event_reads").select("last_read_at").eq("user_id",user.id).maybeSingle<{last_read_at:string}>(),
    supabase.from("profiles").select("role").eq("id",user.id).maybeSingle<{role:string}>(),
  ]);
  const lastRead = cursor?.last_read_at ? new Date(cursor.last_read_at).getTime() : 0;
  const fallbackLink=(event:{event_type:string;entity_type:string;entity_id:string|null})=>{
    if(event.event_type.startsWith("payment.")||event.event_type.startsWith("refund."))return "/dashboard/finance";
    if(event.event_type.startsWith("review.")||event.event_type.startsWith("attendance."))return profile?.role==="parent"?"/dashboard/children":"/dashboard";
    if(event.entity_type==="student"&&event.entity_id)return `/dashboard/students/${event.entity_id}`;
    if(event.entity_type==="profile")return "/dashboard/staff";
    if(event.entity_type==="classroom"&&event.entity_id)return `/dashboard/classes/${event.entity_id}`;
    return "/dashboard";
  };
  const customerRole = profile?.role === "parent" || profile?.role === "student";
  return (events??[])
    .filter(event => event.target_user_id === user.id || (customerRole && event.actor_id !== user.id))
    .slice(0,20)
    .map(event=>({id:event.id,type:event.event_type,occurredAt:event.occurred_at,link:event.event_link??fallbackLink(event),unread:new Date(event.occurred_at).getTime()>lastRead}));
}

const eventIdSchema = z.string().uuid();

export async function markChangeFeedRead(latestVisibleEventId: string): Promise<void> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("UNAUTHENTICATED");
  const parsed = eventIdSchema.safeParse(latestVisibleEventId);
  if (!parsed.success) throw new Error("VALIDATION");
  const { data: event, error: eventError } = await supabase.from("domain_events")
    .select("occurred_at").eq("id", parsed.data).in("event_type", USER_NOTIFICATION_TYPES).maybeSingle<{ occurred_at: string }>();
  if (eventError || !event) throw new Error(eventError?.message ?? "NOT_FOUND");
  const advanceCursor = () => supabase.from("user_event_reads")
    .update({ last_read_at: event.occurred_at })
    .eq("user_id", user.id)
    .lt("last_read_at", event.occurred_at)
    .select("user_id")
    .maybeSingle<{ user_id: string }>();
  const firstAdvance = await advanceCursor();
  if (firstAdvance.error) throw new Error(firstAdvance.error.message);
  if (firstAdvance.data) return;
  const { error: insertError } = await supabase.from("user_event_reads").insert({ user_id: user.id, last_read_at: event.occurred_at });
  if (!insertError) return;
  if (insertError.code !== "23505") throw new Error(insertError.message);
  const retryAdvance = await advanceCursor();
  if (retryAdvance.error) throw new Error(retryAdvance.error.message);
}
