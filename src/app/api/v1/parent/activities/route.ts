import { courseGet, coursePost } from "@/features/parent-portal/course-server";
import { failure } from "@/features/parent-portal/server";

export const runtime = "nodejs";

/** Activity registration is the Mini Program's public offering; class applications live on the family website. */
export async function GET(request: Request) {
  try { return await courseGet(request, "activity"); } catch (error) { return failure(error); }
}

export async function POST(request: Request) {
  try { return await coursePost(request, "activity"); } catch (error) { return failure(error); }
}
