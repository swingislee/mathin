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
});
