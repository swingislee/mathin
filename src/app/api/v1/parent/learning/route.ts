import { learningGet, learningPost } from "@/features/parent-portal/learning-server";
import { failure } from "@/features/parent-portal/server";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try { return await learningGet(request); } catch (error) { return failure(error); }
}

export async function POST(request: Request) {
  try { return await learningPost(request); } catch (error) { return failure(error); }
}
