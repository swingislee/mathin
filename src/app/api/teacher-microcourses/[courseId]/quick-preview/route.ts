import { NextResponse } from "next/server";
import { z } from "zod";
import { quickPreviewSchema } from "@/features/school/teaching-operations/teacher-microcourse-library";
import { createClient } from "@/lib/supabase/server";

export async function GET(_request: Request, { params }: { params: Promise<{ courseId: string }> }) {
  const courseId = z.uuid().safeParse((await params).courseId);
  if (!courseId.success) return NextResponse.json({ code: "NOT_FOUND" }, { status: 404 });
  const supabase = await createClient();
  // This security-definer RPC rejects a missing auth.uid() and rechecks course
  // visibility inside PostgreSQL. Avoid a second, serial Auth API round trip on
  // every row selection; the database remains the authorization authority.
  const { data, error } = await supabase.rpc("get_teacher_microcourse_quick_preview", {
    p_course_id: courseId.data,
  });
  if (error) return NextResponse.json({ code: error.message.includes("FORBIDDEN") ? "FORBIDDEN" : "NOT_FOUND" }, { status: error.message.includes("FORBIDDEN") ? 403 : 404 });
  return NextResponse.json(quickPreviewSchema.parse(data), {
    headers: { "Cache-Control": "private, no-store" },
  });
}
