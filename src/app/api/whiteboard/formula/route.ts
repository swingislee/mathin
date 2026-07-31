import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { extractPix2TextLatex, resolveFormulaOcrUrl } from "@/features/whiteboard/formula-service";

export const runtime = "nodejs";

const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const MAX_CONCURRENT_FORMULA_REQUESTS = 1;
let activeFormulaRequests = 0;

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ code: "UNAUTHENTICATED" }, { status: 401 });

  const requestForm = await request.formData().catch(() => null);
  const image = requestForm?.get("image");
  if (!(image instanceof File) || image.size === 0 || image.size > MAX_IMAGE_BYTES || !["image/png", "image/webp", "image/jpeg"].includes(image.type)) {
    return NextResponse.json({ code: "INVALID_IMAGE" }, { status: 400 });
  }

  const service = resolveFormulaOcrUrl(process.env.FORMULA_OCR_URL, process.env.NODE_ENV);
  if (!service.ok) {
    return NextResponse.json({ code: "FORMULA_SERVICE_MISCONFIGURED" }, { status: 503 });
  }
  if (activeFormulaRequests >= MAX_CONCURRENT_FORMULA_REQUESTS) {
    return NextResponse.json(
      { code: "FORMULA_SERVICE_BUSY" },
      { status: 429, headers: { "Retry-After": "3" } },
    );
  }

  const serviceForm = new FormData();
  serviceForm.set("file_type", "formula");
  serviceForm.set("resized_shape", "768");
  serviceForm.set("return_text", "true");
  serviceForm.set("image", image, "formula.png");

  activeFormulaRequests += 1;
  try {
    const response = await fetch(service.url, {
      method: "POST",
      body: serviceForm,
      signal: AbortSignal.timeout(60_000),
      cache: "no-store",
    });
    if (!response.ok) {
      return NextResponse.json({ code: "FORMULA_SERVICE_FAILED" }, { status: 502 });
    }
    const latex = extractPix2TextLatex(await response.json());
    if (!latex) return NextResponse.json({ code: "FORMULA_NOT_RECOGNIZED" }, { status: 422 });
    return NextResponse.json({ latex });
  } catch {
    return NextResponse.json({ code: "FORMULA_SERVICE_UNAVAILABLE" }, { status: 503 });
  } finally {
    activeFormulaRequests -= 1;
  }
}