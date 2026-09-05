import "server-only";
import { getMyPerms } from "@/lib/auth";
import { staffRpcClient } from "./actions/guards";
import { getPublicClassWorkbench } from "./public-class";
import type { PublicClassRegistrationData } from "./public-class-registration-contract";

export async function loadPublicClassRegistration(activityId: string): Promise<PublicClassRegistrationData> {
  const { supabase, user } = await staffRpcClient();
  const permissions = await getMyPerms(user.id);
  if (!(["activity.register", "review.write", "followup.view", "activity.manage"] as const).some((key) => permissions.has(key))) throw new Error("FORBIDDEN");
  const [data, recordPermission] = await Promise.all([
    getPublicClassWorkbench(activityId, { includeTeachingCatalog: false }),
    supabase.rpc("can_record_public_class", { p_activity_id: activityId, p_uid: user.id }),
  ]);
  if (recordPermission.error) throw new Error(recordPermission.error.message);
  if (!data) throw new Error("PUBLIC_CLASS_NOT_FOUND");
  return {
    activity: data.activity, segments: data.segments, participants: data.participants,
    roomOptions: data.roomOptions, staffOptions: data.staffOptions,
    canRecord: recordPermission.data === true, canManage: permissions.has("activity.manage"),
    canFollowUp: permissions.has("followup.view") || permissions.has("enrollment.manage"),
  };
}
