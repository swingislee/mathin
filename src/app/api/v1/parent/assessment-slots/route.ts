import { assessmentSlotsGet } from "@/features/parent-portal/assessment-server";
import { failure } from "@/features/parent-portal/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try { return await assessmentSlotsGet(request); } catch (error) { return failure(error); }
}
