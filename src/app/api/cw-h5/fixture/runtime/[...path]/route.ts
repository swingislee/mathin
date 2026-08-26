export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ path: string[] }> },
): Promise<Response> {
  if (process.env.NODE_ENV === "production") return new Response("Not found", { status: 404 });
  const { path } = await context.params;
  const file = path.at(-1) ?? "";
  if (!file.endsWith(".css")) return new Response("", { status: 204 });
  return new Response("/* B3 development fixture: source runtime intentionally empty. */", {
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "text/css; charset=utf-8",
    },
  });
}
