import "server-only";
import { createClient } from "@/lib/supabase/server";
import { sessionCommunicationsSchema } from "./session-communication-contract";

export async function getSessionCommunications(sessionId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_session_communications", { p_session_id: sessionId });
  if (error) throw new Error(error.message);
  return sessionCommunicationsSchema.parse(data);
}
