"use server";

import { createClient } from "@/lib/supabase/server";

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
    supabase.from("domain_events").select("id,event_type,entity_type,entity_id,occurred_at,event_link").order("occurred_at",{ascending:false}).limit(20)
      .returns<Array<{id:string;event_type:string;entity_type:string;entity_id:string|null;occurred_at:string;event_link:string|null}>>(),
    supabase.from("user_event_reads").select("last_read_at").eq("user_id",user.id).maybeSingle<{last_read_at:string}>(),
    supabase.from("profiles").select("role").eq("id",user.id).maybeSingle<{role:string}>(),
  ]);
  const lastRead = cursor?.last_read_at ? new Date(cursor.last_read_at).getTime() : 0;
  const fallbackLink=(event:{event_type:string;entity_type:string;entity_id:string|null})=>{
    if(event.event_type.startsWith("payment.")||event.event_type.startsWith("refund."))return "/dashboard/finance";
    if(event.event_type.startsWith("review.")||event.event_type.startsWith("attendance."))return profile?.role==="parent"?"/dashboard/children":"/dashboard";
    if(event.entity_type==="student"&&event.entity_id)return `/dashboard/students/${event.entity_id}`;
    if(event.entity_type==="profile")return "/dashboard/staff";
    return "/dashboard";
  };
  return (events??[]).map(event=>({id:event.id,type:event.event_type,occurredAt:event.occurred_at,link:event.event_link??fallbackLink(event),unread:new Date(event.occurred_at).getTime()>lastRead}));
}

export async function markChangeFeedRead(): Promise<void> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("UNAUTHENTICATED");
  const { error } = await supabase.from("user_event_reads").upsert({user_id:user.id,last_read_at:new Date().toISOString()},{onConflict:"user_id"});
  if (error) throw new Error(error.message);
}
