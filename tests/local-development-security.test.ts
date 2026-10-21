import { describe, expect, it } from "vitest";
import {
  hasLocalDevelopmentMfaExemption,
  LOCAL_DEVELOPMENT_MFA_EXEMPT_CLAIM,
} from "@/lib/local-development-security";

describe("local development MFA exemption", () => {
  const metadata = { [LOCAL_DEVELOPMENT_MFA_EXEMPT_CLAIM]: true };

  it("allows only an explicit claim against loopback Supabase in Next development mode", () => {
    expect(hasLocalDevelopmentMfaExemption(metadata, {
      nodeEnv: "development",
      supabaseUrl: "http://127.0.0.1:35421",
    })).toBe(true);
    expect(hasLocalDevelopmentMfaExemption(metadata, {
      nodeEnv: "development",
      supabaseUrl: "http://localhost:54321",
    })).toBe(true);
  });

  it("stays fail-closed in production, on remote Supabase, or without the trusted claim", () => {
    expect(hasLocalDevelopmentMfaExemption(metadata, {
      nodeEnv: "production",
      supabaseUrl: "http://127.0.0.1:35421",
    })).toBe(false);
    expect(hasLocalDevelopmentMfaExemption(metadata, {
      nodeEnv: "development",
      supabaseUrl: "https://supabase.mathin.club",
    })).toBe(false);
    expect(hasLocalDevelopmentMfaExemption({}, {
      nodeEnv: "development",
      supabaseUrl: "http://127.0.0.1:35421",
    })).toBe(false);
  });

  it("supports an explicitly enabled local production preview", () => {
    expect(hasLocalDevelopmentMfaExemption(metadata, {
      nodeEnv: "production",
      localProductionPreview: "1",
      supabaseUrl: "http://127.0.0.1:35421",
    })).toBe(true);
  });

  it.each([
    "https://supabase.mathin.club",
    "http://192.168.5.183:35421",
    "http://localhost.example.com:35421",
    "http://127.0.0.1.example.com:35421",
    "invalid",
    undefined,
  ])("keeps MFA for non-local or missing database targets in local preview: %s", (supabaseUrl) => {
    expect(hasLocalDevelopmentMfaExemption(metadata, {
      nodeEnv: "production", localProductionPreview: "1", supabaseUrl,
    })).toBe(false);
  });

  it.each([undefined, null, {}, { [LOCAL_DEVELOPMENT_MFA_EXEMPT_CLAIM]: "true" }])(
    "requires the trusted boolean claim in local production preview",
    (appMetadata) => {
      expect(hasLocalDevelopmentMfaExemption(appMetadata, {
        nodeEnv: "production", localProductionPreview: "1", supabaseUrl: "http://127.0.0.1:35421",
      })).toBe(false);
    },
  );

  it.each([undefined, "0", "true"])("keeps production MFA without the exact preview switch: %s", (localProductionPreview) => {
    expect(hasLocalDevelopmentMfaExemption(metadata, {
      nodeEnv: "production", localProductionPreview, supabaseUrl: "http://127.0.0.1:35421",
    })).toBe(false);
  });
});
