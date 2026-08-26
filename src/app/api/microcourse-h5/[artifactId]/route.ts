import { injectH5Runtime, microcourseH5SecurityHeaders } from "@/features/courseware-doc/h5-shim";
import { normalizeMicrocourseH5 } from "@/features/teacher-microcourses/h5";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

type Artifact = {
  id: string;
  microcourseId: string;
  sha256: string;
  byteCount: number;
  privatePath: string;
  publicPath: string | null;
  status: "draft" | "published";
};

function htmlResponse(html: string, cacheControl: string) {
  return new Response(injectH5Runtime(normalizeMicrocourseH5(html), null), {
    status: 200,
    headers: {
      ...microcourseH5SecurityHeaders(),
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": cacheControl,
    },
  });
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ artifactId: string }> },
) {
  const { artifactId } = await context.params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(artifactId)) {
    return new Response("Not found", { status: 404 });
  }
  const admin = createAdminClient();
  const { data: published } = await admin
    .from("teacher_microcourse_h5_artifacts")
    .select("id,microcourse_id,sha256,byte_count,private_path,public_path,status")
    .eq("id", artifactId)
    .eq("status", "published")
    .maybeSingle();
  if (published?.public_path) {
    const { data, error } = await admin.storage.from("cw-h5").download(published.public_path);
    if (error || !data) return new Response("Not found", { status: 404 });
    return htmlResponse(await data.text(), "public, max-age=0, must-revalidate");
  }

  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return new Response("Unauthorized", { status: 401 });
  const { data, error } = await (supabase.rpc as unknown as (
    name: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: Artifact | null; error: { message: string } | null }>)(
    "get_teacher_microcourse_h5_artifact",
    { p_artifact_id: artifactId },
  );
  if (error || !data || data.status !== "draft") {
    return new Response(error?.message === "FORBIDDEN" ? "Forbidden" : "Not found", {
      status: error?.message === "FORBIDDEN" ? 403 : 404,
    });
  }
  const { data: html, error: downloadError } = await admin.storage
    .from("cw-h5-drafts")
    .download(data.privatePath);
  if (downloadError || !html) return new Response("Not found", { status: 404 });
  return htmlResponse(await html.text(), "private, no-store");
}

