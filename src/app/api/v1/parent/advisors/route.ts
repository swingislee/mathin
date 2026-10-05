import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { getSupabaseConfig } from "@/lib/supabase/config";
import { failure, requireResult, response } from "@/features/parent-portal/server";
import type { RegistrationRpc } from "@/features/parent-portal/course-server";

export async function GET(request: Request) {
  try {
    const { url, key } = getSupabaseConfig();
    const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const rows = z.array(z.object({ grade: z.number().int().min(-1).max(12), teacherName: z.string(), phone: z.string(),
      qrPath: z.string().regex(/^-?\d{1,2}\/[0-9a-f-]{36}\.(png|jpg|webp)$/) }))
      .parse(requireResult(await (db.rpc as unknown as RegistrationRpc)("miniapp_advisor_contacts")));
    return response(rows.map(({ qrPath, ...row }) => ({ ...row, qrCodeUrl: `${new URL(request.url).origin}/api/v1/parent/advisors/qr?path=${encodeURIComponent(qrPath)}` })));
  } catch (error) { return failure(error); }
}
