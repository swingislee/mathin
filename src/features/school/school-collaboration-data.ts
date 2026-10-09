import "server-only";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { studentStageRpc } from "./student-stage-data";
import { schoolCollaborationSchema } from "./school-collaboration-contract";

export async function readSchoolCollaborationSettings() {
  return schoolCollaborationSchema.parse(await studentStageRpc(await createClient(), "read_school_collaboration_settings", {}));
}

const supportOwnersSchema = z.array(z.object({ userId: z.string().uuid(), displayName: z.string() }));
export async function listSchoolSupportOwners() {
  const client = await createClient();
  const { data, error } = await client.rpc("list_school_support_owners");
  if (error) throw new Error(error.message);
  return supportOwnersSchema.parse(data);
}
