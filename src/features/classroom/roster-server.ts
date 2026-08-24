import "server-only";

import { createClient } from "@/lib/supabase/server";
import { parseSessionRosterState } from "./roster";
import type { SessionRosterState } from "./types";

export async function getSessionRoster(sessionId: string): Promise<SessionRosterState> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_session_roster", {
    p_session_id: sessionId,
  });
  if (error) throw new Error(error.message);
  return parseSessionRosterState(data);
}
