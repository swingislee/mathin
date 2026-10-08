import { participantGet, participantPost } from "@/features/participant-portal/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ endpoint: string[] }> };

export async function GET(request: Request, context: Context) {
  return participantGet(request, (await context.params).endpoint.join("/"));
}

export async function POST(request: Request, context: Context) {
  return participantPost(request, (await context.params).endpoint.join("/"));
}
