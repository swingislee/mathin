import { NextResponse } from "next/server";
import { z } from "zod";
import { authorizedClient } from "@/features/school/actions/guards";
import {
  COURSEWARE_TRACKS,
  loadLecturePreviewPage,
} from "@/features/courseware-studio/data";

const requestSchema = z.object({
  releaseId: z.uuid(),
  pageDocId: z.uuid(),
  track: z.enum(COURSEWARE_TRACKS),
});

function responseStatus(code: string) {
  if (code === "UNAUTHENTICATED") return 401;
  if (code === "FORBIDDEN") return 403;
  if (code === "VALIDATION" || code === "RELEASE_TRACK_MISMATCH") return 400;
  if (code === "RELEASE_NOT_FOUND" || code === "PREVIEW_PAGE_NOT_FOUND") return 404;
  return 500;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ releaseId: string; pageDocId: string }> },
) {
  const path = await params;
  const input = requestSchema.safeParse({
    ...path,
    track: new URL(request.url).searchParams.get("track"),
  });
  if (!input.success) {
    return NextResponse.json({ code: "VALIDATION" }, {
      status: 400,
      headers: { "Cache-Control": "private, no-store" },
    });
  }

  try {
    const { supabase } = await authorizedClient("course.view");
    const payload = await loadLecturePreviewPage(
      input.data.releaseId,
      input.data.track,
      input.data.pageDocId,
      supabase,
    );
    return NextResponse.json(payload, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    const raw = error instanceof Error ? error.message : "UNKNOWN";
    const code = raw.split(":", 1)[0] || "UNKNOWN";
    return NextResponse.json({ code }, {
      status: responseStatus(code),
      headers: { "Cache-Control": "private, no-store" },
    });
  }
}
