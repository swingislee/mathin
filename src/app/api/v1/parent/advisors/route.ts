import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { getSupabaseConfig } from "@/lib/supabase/config";
import { failure, PortalError, requireResult, response } from "@/features/parent-portal/server";
import type { RegistrationRpc } from "@/features/parent-portal/course-server";
import { contactImagePath, miniappLocalized } from "@/features/school/miniapp-settings/contract";

export async function GET(request: Request) {
  try {
    const query = new URL(request.url).searchParams, stage = query.get("stage");
    if (query.getAll("stage").length > 1 || stage !== null && !/^(-1|[0-9]|1[0-2])$/.test(stage)) throw new PortalError("VALIDATION");
    const { url, key } = getSupabaseConfig();
    const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const rows = z.array(z.object({ grade: z.number().int().min(-1).max(12), teacherName: z.string(), phone: z.string(),
      qrPath: z.string().refine(v => !v || contactImagePath.test(v)), id: z.string().optional(), name: miniappLocalized(60).optional(), service: miniappLocalized(120).optional(),
      campusId: z.string().optional(), campusName: z.string().optional(), hours: miniappLocalized(500).optional(), address: miniappLocalized(500).optional() }))
      .parse(requireResult(await (db.rpc as unknown as RegistrationRpc)("miniapp_service_contacts")));
    return response(rows.filter(row => stage === null || row.grade === Number(stage)).map(({ qrPath, ...row }) => ({ ...row, qrCodeUrl: qrPath ? `${new URL(request.url).origin}/api/v1/parent/advisors/qr?path=${encodeURIComponent(qrPath)}` : "" })));
  } catch (error) { return failure(error); }
}
