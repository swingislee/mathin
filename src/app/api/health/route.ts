import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** Lightweight liveness endpoint for the Windows production process.
 *
 * It deliberately does not contact Supabase: deployment automation needs to
 * distinguish a running Next.js server from downstream service availability,
 * and must never disclose configuration or credentials.
 */
export function GET(): NextResponse {
  return NextResponse.json(
    {
      status: "ok",
      service: "mathin",
      environment: process.env.NODE_ENV ?? "unknown",
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}
