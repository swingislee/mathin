import { failure, portalGet, portalPost } from "@/features/parent-portal/server";
export const runtime = "nodejs";
export async function GET(request: Request) { try { return await portalGet(request); } catch (error) { return failure(error); } }
export async function POST(request: Request) { try { return await portalPost(request); } catch (error) { return failure(error); } }
