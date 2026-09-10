import "server-only";
import { createClient } from "@/lib/supabase/server";
import { studentStageRpc } from "./student-stage-data";
import { schoolCollaborationSchema } from "./school-collaboration-contract";

export async function readSchoolCollaborationSettings() {
  return schoolCollaborationSchema.parse(await studentStageRpc(await createClient(), "read_school_collaboration_settings", {}));
}
