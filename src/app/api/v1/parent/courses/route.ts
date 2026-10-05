import { courseGet, coursePost } from "@/features/parent-portal/course-server";
import { failure } from "@/features/parent-portal/server";

export const runtime = "nodejs";
export async function GET(request: Request) {
  try { return await courseGet(request); } catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  try { return await coursePost(request); } catch (error) { return failure(error); }
}
