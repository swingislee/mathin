import { authPost, failure } from "@/features/parent-portal/server";
export const runtime = "nodejs";
export async function POST(request: Request) { try { return await authPost(request); } catch (error) { return failure(error); } }
