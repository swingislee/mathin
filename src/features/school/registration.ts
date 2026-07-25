import "server-only";

import { createClient } from "@/lib/supabase/server";

export interface RegistrationInviteSettings {
  code: string;
  isActive: boolean;
  updatedAt: string;
}

export async function getRegistrationInviteSettings(): Promise<RegistrationInviteSettings> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_registration_invite_settings");
  if (error) throw new Error(error.message);
  const row = data?.[0];
  if (!row) throw new Error("REGISTRATION_INVITE_SETTINGS_NOT_FOUND");

  return {
    code: row.code,
    isActive: row.is_active,
    updatedAt: row.updated_at,
  };
}
