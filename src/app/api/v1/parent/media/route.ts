import { failure, mediaGet, mediaPost } from "@/features/parent-portal/server";
export const runtime = "nodejs";
export async function GET(request: Request) { try { return await mediaGet(request); } catch (error) { return failure(error); } }
export async function POST(request: Request) { try { return await mediaPost(request); } catch (error) { return failure(error); } }
