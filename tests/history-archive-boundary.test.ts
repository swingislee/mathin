import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import {
  historyArchiveHref,
  isLocalHistoryArchiveEnvironment,
  parseHistoryArchiveFilters,
  type HistoryArchivePageData,
} from "../src/features/school/history-archive-contract";

const boundary = vi.hoisted(() => ({
  events: [] as string[],
  requireEnvironment: vi.fn(),
  profile: vi.fn(),
  exists: vi.fn(),
  readFile: vi.fn(),
  realpath: vi.fn(),
  readPage: vi.fn(),
  readDetail: vi.fn(),
  routerPush: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("node:fs", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:fs")>();
  return { ...original, default: { ...original, existsSync: boundary.exists, readFileSync: boundary.readFile, realpathSync: boundary.realpath } };
});
vi.mock("../src/lib/auth", () => ({ requireDashboardEnvironment: boundary.requireEnvironment, getProfile: boundary.profile }));
vi.mock("../scripts/lib/history-archive-store.mjs", () => ({ readHistoryArchivePage: boundary.readPage, readHistoryArchiveDetail: boundary.readDetail }));
vi.mock("next-intl/server", () => ({ setRequestLocale: vi.fn() }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NOT_FOUND"); } }));
vi.mock("../src/i18n/navigation", () => ({
  redirect: ({ locale, href }: { locale: string; href: string }) => { throw new Error(`REDIRECT:${locale}${href}`); },
  useRouter: () => ({ push: boundary.routerPush }),
  Link: "a",
}));
vi.mock("../src/features/school/dashboard-page", () => ({ DashboardPage: "main", DashboardCommandPanel: "section" }));
vi.mock("../src/features/school/HistoryArchiveWorkbench", () => ({ HistoryArchiveWorkbench: "article", HistoryArchiveCommandBar: "form" }));
vi.mock("react", async (importOriginal) => {
  const original = await importOriginal<typeof import("react")>();
  return { ...original, useTransition: () => [false, (work: () => void) => work()] };
});

import * as archiveData from "../src/features/school/history-archive-data";
import HistoryImportPage from "../src/app/[locale]/dashboard/history-import/page";
import { HistoryArchivePagination } from "../src/features/school/HistoryArchiveFilters";
import { getHistoryArchiveMessages, historyArchiveMatchExplanation, historyArchiveWarningExplanation } from "../src/features/school/history-archive-messages";
import { Select } from "../src/components/ui/select";

const filters = parseHistoryArchiveFilters({ q: "示例姓名 & 13800000000", table: "table-source", status: "review", page: "3", pageSize: "50", record: "source-record", relatedPage: "2" });
const emptyPage: HistoryArchivePageData = {
  summary: { available: true, generatedAt: null, sourceCount: 1, tableCount: 1, recordCount: 0, contentRecordCount: 0,
    matchedCount: 0, reviewCount: 0, singleCandidateReviewCount: 0, multipleCandidateReviewCount: 0, unmatchedCount: 0, gradeCorrectionCount: 0, excludedCommunicationCount: 0, archivedClassCount: 0, tables: [] },
  rows: [], total: 0, page: 1, pageSize: 50,
};

function query(href: string) {
  return Object.fromEntries(new URL(href, "http://example.invalid").searchParams);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:35421");
  boundary.events = [];
  boundary.requireEnvironment.mockImplementation(async () => { boundary.events.push("authenticate"); return { user: { id: "test-admin" }, environment: "staff" }; });
  boundary.profile.mockImplementation(async () => { boundary.events.push("authorize-admin"); return { role: "admin" }; });
  boundary.exists.mockImplementation(() => { boundary.events.push("pointer-exists"); return true; });
  boundary.readFile.mockImplementation(() => { boundary.events.push("pointer-read"); return JSON.stringify({ database: "run-unit-test/archive.sqlite" }); });
  boundary.realpath.mockImplementation((value: string) => value);
  boundary.readPage.mockImplementation(() => { boundary.events.push("sqlite-page"); return emptyPage; });
  boundary.readDetail.mockImplementation(() => { boundary.events.push("sqlite-detail"); return null; });
});

afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("history archive query boundaries", () => {
  it("rejects repeated parameters, invalid statuses and unsafe page numbers without accepting extra access flags", () => {
    expect(parseHistoryArchiveFilters({ q: ["one", "two"], status: "admin", table: ["a", "b"], record: ["a"], page: "-2", relatedPage: "Infinity", pageSize: "30" }))
      .toEqual({ q: "", status: "all", table: "", record: "", page: 1, relatedPage: 1, pageSize: 25 });
    expect(parseHistoryArchiveFilters({ q: `  ${"a".repeat(230)}  `, table: "t".repeat(200), record: "r".repeat(200), page: "9999999", relatedPage: "9007199254740993" }))
      .toMatchObject({ q: "a".repeat(200), table: "t".repeat(160), record: "r".repeat(160), page: 1_000_000, relatedPage: 1 });
  });

  it("preserves search, scope and selected record when paging either list", () => {
    expect(parseHistoryArchiveFilters(query(historyArchiveHref(filters, { page: 4 })))).toEqual({ ...filters, page: 4 });
    expect(parseHistoryArchiveFilters(query(historyArchiveHref(filters, { relatedPage: 5 })))).toEqual({ ...filters, relatedPage: 5 });
    expect(parseHistoryArchiveFilters(query(historyArchiveHref(filters, { record: "a&role=admin#b" })))).toEqual({ ...filters, record: "a&role=admin#b" });
  });

  it("the page-size control returns to page one and keeps the search and record context", () => {
    const tree = HistoryArchivePagination({ filters, page: 3, pageSize: 50, total: 140, messages: getHistoryArchiveMessages("zh") });
    function findSelect(node: unknown): ReactElement<{ onValueChange: (value: string) => void }> | null {
      if (!node || typeof node !== "object") return null;
      if (Array.isArray(node)) return node.map(findSelect).find(Boolean) ?? null;
      const element = node as ReactElement<{ children?: unknown }>;
      if (element.type === Select) return element as ReactElement<{ onValueChange: (value: string) => void }>;
      return findSelect(element.props?.children);
    }
    const select = findSelect(tree);
    expect(select).not.toBeNull();
    select!.props.onValueChange("100");
    expect(boundary.routerPush).toHaveBeenCalledOnce();
    expect(parseHistoryArchiveFilters(query(boundary.routerPush.mock.calls[0][0]))).toEqual({ ...filters, page: 1, pageSize: 100 });
  });
});

describe("operator-facing history explanations", () => {
  it.each(["zh", "en"])("explains ambiguous identities and unavailable source references in %s without displaying implementation flags", (locale) => {
    const messages = getHistoryArchiveMessages(locale);
    expect(historyArchiveMatchExplanation("phone_only", messages)).toBe(messages.reasonPhoneOnly);
    expect(historyArchiveMatchExplanation("unrecognized_internal_flag", messages)).toBe(messages.reasonUnknown);
    expect(historyArchiveWarningExplanation("LINK_TARGET_MISSING:field-private:table-private:record-private", messages)).toBe(messages.warningLink);
    expect(historyArchiveWarningExplanation("new_warning:private-detail", messages)).toBe(messages.warningUnknown);
  });
});

describe("history archive local environment boundary", () => {
  it.each([
    ["production", "http://127.0.0.1:35421"],
    ["test", "http://127.0.0.1:35421"],
    [undefined, "http://127.0.0.1:35421"],
    ["development", "https://supabase.mathin.club"],
    ["development", "http://192.168.5.183:35421"],
    ["development", "http://127.0.0.1:54321"],
    ["development", "https://127.0.0.1:35421"],
    ["development", "http://user:secret@127.0.0.1:35421"],
    ["development", "not-a-url"],
    ["development", undefined],
  ])("rejects environment %s with origin %s", (environment, origin) => {
    expect(isLocalHistoryArchiveEnvironment(environment, origin)).toBe(false);
  });

  it("accepts the configured development origin", () => {
    expect(isLocalHistoryArchiveEnvironment("development", "http://127.0.0.1:35421")).toBe(true);
  });
});

describe("private archive read authorization", () => {
  const loads = [
    { name: "page", run: () => archiveData.loadHistoryArchivePage(filters), final: "sqlite-page" },
    { name: "detail", run: () => archiveData.loadHistoryArchiveDetail("synthetic-record", 2), final: "sqlite-detail" },
  ];

  it.each(loads)("$name rejects production before authentication or file access", async ({ run }) => {
    vi.stubEnv("NODE_ENV", "production");
    await expect(run()).rejects.toThrow("HISTORY_ARCHIVE_LOCAL_ONLY");
    expect(boundary.events).toEqual([]);
  });

  it.each(loads)("$name stops on authentication failure before reading the private pointer", async ({ run }) => {
    boundary.requireEnvironment.mockRejectedValueOnce(new Error("LOGIN_REQUIRED"));
    await expect(run()).rejects.toThrow("LOGIN_REQUIRED");
    expect(boundary.profile).not.toHaveBeenCalled();
    expect(boundary.exists).not.toHaveBeenCalled();
    expect(boundary.readFile).not.toHaveBeenCalled();
    expect(boundary.readPage).not.toHaveBeenCalled();
    expect(boundary.readDetail).not.toHaveBeenCalled();
  });

  it.each(loads)("$name rejects an authenticated staff member before file or SQLite access", async ({ run }) => {
    boundary.profile.mockResolvedValueOnce({ role: "staff" });
    await expect(run()).rejects.toThrow("FORBIDDEN");
    expect(boundary.exists).not.toHaveBeenCalled();
    expect(boundary.readFile).not.toHaveBeenCalled();
    expect(boundary.readPage).not.toHaveBeenCalled();
    expect(boundary.readDetail).not.toHaveBeenCalled();
  });

  it.each(loads)("$name authenticates and authorizes before pointer and SQLite reads", async ({ run, final }) => {
    await run();
    expect(boundary.events).toEqual(["authenticate", "authorize-admin", "pointer-exists", "pointer-read", final]);
    expect(boundary.requireEnvironment).toHaveBeenCalledWith("zh", ["staff"]);
    expect(boundary.profile).toHaveBeenCalledWith("test-admin");
  });

  it("rejects a missing admin profile and does not treat it as an empty archive", async () => {
    boundary.profile.mockResolvedValueOnce(null);
    await expect(archiveData.loadHistoryArchivePage(filters)).rejects.toThrow("FORBIDDEN");
    expect(boundary.exists).not.toHaveBeenCalled();
  });

  it.each(["../../private.sqlite", "run-ok/../../private.sqlite", "/archive.sqlite", "run-ok/archive.sqlite/extra"])("rejects a malformed archive pointer %s", async (database) => {
    boundary.readFile.mockReturnValueOnce(JSON.stringify({ database }));
    await expect(archiveData.loadHistoryArchivePage(filters)).rejects.toThrow("HISTORY_ARCHIVE_POINTER");
    expect(boundary.realpath).not.toHaveBeenCalled();
    expect(boundary.readPage).not.toHaveBeenCalled();
  });

  it("rejects a valid-looking archive pointer whose resolved file escapes the rehearsal directory", async () => {
    boundary.realpath.mockImplementation((value: string) => value.endsWith("archive.sqlite") ? path.resolve(process.cwd(), "outside", "archive.sqlite") : value);
    await expect(archiveData.loadHistoryArchivePage(filters)).rejects.toThrow("HISTORY_ARCHIVE_PATH");
    expect(boundary.readPage).not.toHaveBeenCalled();
  });

  it("shows an authorized preparation state when the local archive has not been generated", async () => {
    boundary.exists.mockReturnValue(false);
    expect(await archiveData.loadHistoryArchivePage(filters)).toMatchObject({ summary: { available: false }, rows: [], total: 0, page: 1, pageSize: 50 });
    expect(await archiveData.loadHistoryArchiveDetail("synthetic-record")).toBeNull();
    expect(boundary.readFile).not.toHaveBeenCalled();
    expect(boundary.readPage).not.toHaveBeenCalled();
    expect(boundary.readDetail).not.toHaveBeenCalled();
  });
});

describe("history import page authorization", () => {
  async function protectedRegion(region: "body" | "command", raw = { record: "synthetic-record" }) {
    const page = await HistoryImportPage({ params: Promise.resolve({ locale: "en" }), searchParams: Promise.resolve(raw) });
    const suspense = region === "body" ? page.props.children : page.props.commandPanel;
    const child = suspense.props.children as { type: (props: { locale: string; searchParams: Promise<Record<string, string>> }) => Promise<unknown>; props: { locale: string; searchParams: Promise<Record<string, string>> } };
    return child.type(child.props);
  }

  it("returns not-found outside the local environment without invoking either loader", async () => {
    const pageRead = vi.spyOn(archiveData, "loadHistoryArchivePage");
    const detailRead = vi.spyOn(archiveData, "loadHistoryArchiveDetail");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://supabase.mathin.club");
    await expect(protectedRegion("body")).rejects.toThrow("NOT_FOUND");
    expect(boundary.requireEnvironment).not.toHaveBeenCalled();
    expect(pageRead).not.toHaveBeenCalled();
    expect(detailRead).not.toHaveBeenCalled();
  });

  it.each(["body", "command"] as const)("the %s region redirects non-admins before either private data loader", async (region) => {
    const pageRead = vi.spyOn(archiveData, "loadHistoryArchivePage");
    const detailRead = vi.spyOn(archiveData, "loadHistoryArchiveDetail");
    boundary.profile.mockResolvedValueOnce({ role: "staff" });
    await expect(protectedRegion(region)).rejects.toThrow("REDIRECT:en/dashboard");
    expect(boundary.requireEnvironment).toHaveBeenCalledWith("en", ["staff"]);
    expect(pageRead).not.toHaveBeenCalled();
    expect(detailRead).not.toHaveBeenCalled();
    expect(boundary.readFile).not.toHaveBeenCalled();
  });

  it("loads the selected record only after the page has confirmed admin status", async () => {
    const pageRead = vi.spyOn(archiveData, "loadHistoryArchivePage").mockImplementation(async () => { boundary.events.push("page-loader"); return emptyPage; });
    const detailRead = vi.spyOn(archiveData, "loadHistoryArchiveDetail").mockImplementation(async () => { boundary.events.push("detail-loader"); return null; });
    await protectedRegion("body");
    expect(boundary.events).toEqual(["authenticate", "authorize-admin", "page-loader", "detail-loader"]);
    expect(pageRead).toHaveBeenCalledOnce();
    expect(detailRead).toHaveBeenCalledWith("synthetic-record", 1);
  });
});
