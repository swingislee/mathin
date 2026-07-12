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
  const [{ data: events }, { data: cursor }] = await Promise.all([
    supabase.from("domain_events").select("id,event_type,occurred_at,event_link").order("occurred_at",{ascending:false}).limit(20)
      .returns<Array<{id:string;event_type:string;occurred_at:string;event_link:string|null}>>(),
    supabase.from("user_event_reads").select("last_read_at").eq("user_id",user.id).maybeSingle<{last_read_at:string}>(),
  ]);
  const lastRead = cursor?.last_read_at ? new Date(cursor.last_read_at).getTime() : 0;
  return (events??[]).map(event=>({id:event.id,type:event.event_type,occurredAt:event.occurred_at,link:event.event_link,unread:new Date(event.occurred_at).getTime()>lastRead}));
}

export async function markChangeFeedRead(): Promise<void> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("UNAUTHENTICATED");
  const { error } = await supabase.from("user_event_reads").upsert({user_id:user.id,last_read_at:new Date().toISOString()},{onConflict:"user_id"});
  if (error) throw new Error(error.message);
}
