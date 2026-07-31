import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { resolveFormulaOcrUrl } from "@/features/whiteboard/formula-service";

describe("formula OCR production boundary", () => {
  it("requires the Xiaomi loopback service in production", () => {
    expect(resolveFormulaOcrUrl(undefined, "production")).toEqual({ ok: false, reason: "MISSING" });
    expect(resolveFormulaOcrUrl("http://192.168.5.213:8503/pix2text", "production")).toEqual({
      ok: false,
      reason: "NON_LOOPBACK",
    });

    const resolved = resolveFormulaOcrUrl("http://127.0.0.1:8503/pix2text", "production");
    expect(resolved.ok).toBe(true);
    if (resolved.ok) expect(resolved.url.href).toBe("http://127.0.0.1:8503/pix2text");
  });

  it("keeps the loopback default only for local development", () => {
    const resolved = resolveFormulaOcrUrl(undefined, "development");
    expect(resolved.ok).toBe(true);
    if (resolved.ok) expect(resolved.url.href).toBe("http://127.0.0.1:8503/pix2text");
  });

  it("ships a constrained loopback-only Xiaomi container", () => {
    const compose = readFileSync("deploy/formula-ocr/compose.yml", "utf8");
    const deployScript = readFileSync("scripts/ops/deploy-formula-ocr-linux.sh", "utf8");

    expect(compose).toContain("network_mode: host");
    expect(compose).toContain("- 127.0.0.1");
    expect(compose).not.toContain("ports:");
    expect(compose).toContain('mem_limit: 3g');
    expect(compose).toContain('cpus: "3.0"');
    expect(compose).toContain("no-new-privileges:true");
    expect(deployScript).toContain("0\\.0\\.0\\.0|\\[::\\]");
    expect(deployScript).toContain("127\\.0\\.0\\.1|\\[::1\\]");
    expect(deployScript).toContain("http://127.0.0.1:8503/docs");
  });
});
