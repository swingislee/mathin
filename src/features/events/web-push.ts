import "server-only";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

interface RpcError {
  message: string;
}
type UntypedRpc = (
  name: string,
  args?: Record<string, unknown>,
) => Promise<{ data: unknown; error: RpcError | null }>;

const resultSchema = z.array(z.object({
  notification_id: z.uuid(),
  deep_link: z.string().startsWith("/").max(500),
})).length(1);

export async function resolveMyWebPushDelivery(deliveryId: string): Promise<string | null> {
  const parsed = z.uuid().safeParse(deliveryId);
  if (!parsed.success) return null;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data, error } = await (supabase.rpc as unknown as UntypedRpc)(
    "resolve_my_web_push_delivery",
    { p_delivery_id: parsed.data },
  );
  if (error) {
    if (error.message.includes("NOT_FOUND")) return null;
    throw new Error(error.message);
  }
  const result = resultSchema.safeParse(data);
  if (!result.success) return null;
  const deepLink = result.data[0].deep_link;
  return deepLink.startsWith("//") || deepLink.includes("\\") ? null : deepLink;
}
