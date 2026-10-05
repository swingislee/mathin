import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { runAssertionFiles } from "../scripts/lib/db-audit-runner.mjs";

const files = ["r1_account_security_assertions.sql", "p6_courseware_security_assertions.sql"];
const environment: NodeJS.ProcessEnv = {
  NODE_ENV: "test",
  DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/postgres",
  MATHIN_WRITE_TARGET_ENVIRONMENT: "test",
  MATHIN_WRITE_ALLOWED_DATABASE_TARGET: "127.0.0.1:5432/postgres",
};

describe("explicit SQL assertion execution", () => {
  it.each<NodeJS.ProcessEnv>([
    { NODE_ENV: "test" },
    { NODE_ENV: "test", DATABASE_URL: environment.DATABASE_URL },
    { ...environment, MATHIN_WRITE_ALLOWED_DATABASE_TARGET: "127.0.0.1:5432/another" },
    { ...environment, DATABASE_URL: "postgresql://postgres@supabase.mathin.club:5432/postgres" },
    { ...environment, DATABASE_URL: "postgresql://postgres@192.168.5.183:5432/postgres", MATHIN_WRITE_ALLOWED_DATABASE_TARGET: "192.168.5.183:5432/postgres" },
    { ...environment, SUPABASE_DB_SSH: "xiaomi" },
    { ...environment, SUPABASE_DB_SSH: "unknown-host", MATHIN_WRITE_ALLOWED_SSH_TARGET: "unknown-host" },
  ])("rejects absent, mismatched, production or unregistered targets before launching a process", (target) => {
    const execute = vi.fn();
    expect(() => runAssertionFiles("db:test", files, { environment: target, execute })).toThrow(/R1_WRITE_TARGET_POLICY/);
    expect(execute).not.toHaveBeenCalled();
  });

  it.each([
    { selection: [], code: "FILES_REQUIRED" },
    { selection: ["../fixtures/example.sql"], code: "INVALID_FILE" },
    { selection: ["*.sql"], code: "INVALID_FILE" },
    { selection: ["--help"], code: "INVALID_FILE" },
    { selection: [files[0], "missing_sql_check.sql"], code: "INVALID_FILE" },
  ])("validates the complete selection before executing any SQL", ({ selection, code }) => {
    const execute = vi.fn();
    expect(() => runAssertionFiles("db:test", selection, { environment, execute })).toThrow(`SQL_CHECK:${code}`);
    expect(execute).not.toHaveBeenCalled();
  });

  it("executes only the selected files once, in order, without a shell", () => {
    const execute = vi.fn().mockReturnValue({ status: 0 });
    expect(runAssertionFiles("db:test", [files[0], `supabase/tests/${files[0]}`, files[1]], { environment, execute })).toBe(0);
    expect(execute).toHaveBeenCalledTimes(2);
    expect(execute.mock.calls.map((call) => path.basename(call[1].at(-1)))).toEqual(files);
    for (const [program, args, options] of execute.mock.calls) {
      expect(program).toBe("psql");
      expect(args.slice(0, -1)).toEqual([environment.DATABASE_URL, "-X", "-v", "ON_ERROR_STOP=1", "-f"]);
      expect(options).toMatchObject({ shell: false, windowsHide: true, env: environment });
    }
  });

  it("stops on the first SQL failure and returns its exit code", () => {
    const execute = vi.fn().mockReturnValue({ status: 3 });
    expect(runAssertionFiles("db:test", files, { environment, execute })).toBe(3);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("removes inherited libpq target overrides before launching psql", () => {
    const execute = vi.fn().mockReturnValue({ status: 0 });
    const target = { ...environment, PGHOSTADDR: "192.168.5.183", pghostaddr: "192.168.5.183", PGSERVICE: "another-target", PGSERVICEFILE: "private-services.conf", PGSYSCONFDIR: "private-config" };
    expect(runAssertionFiles("db:test", [files[0]], { environment: target, execute })).toBe(0);
    expect(execute.mock.calls[0][2].env).toEqual(environment);
    expect(target.PGHOSTADDR).toBe("192.168.5.183");
  });

  it("reports launch failures without echoing child-process error details", () => {
    const execute = vi.fn().mockReturnValue({ error: new Error("private connection detail") });
    expect(() => runAssertionFiles("db:test", files, { environment, execute })).toThrow("SQL_CHECK:START_FAILED: unable to start psql");
    expect(execute).toHaveBeenCalledTimes(1);
  });
});
