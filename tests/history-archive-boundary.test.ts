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
  createClient: vi.fn(),
  batchPresent: true,
  databaseError: null as null | { code: string },
  records: [] as Record<string, unknown>[],
  detailRecord: null as Record<string, unknown> | null,
  queryCalls: [] as { table: string; method: string; args: unknown[] }[],
}));

vi.mock("server-only", () => ({}));
vi.mock("node:fs", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:fs")>();
  return { ...original, default: { ...original, existsSync: boundary.exists, readFileSync: boundary.readFile, realpathSync: boundary.realpath } };
});
vi.mock("../src/lib/auth", () => ({ requireDashboardEnvironment: boundary.requireEnvironment, getProfile: boundary.profile }));
vi.mock("../src/lib/supabase/server", () => ({ createClient: boundary.createClient }));
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
    matchedCount: 0, reviewCount: 0, singleCandidateReviewCount: 0, multipleCandidateReviewCount: 0, unmatchedCount: 0, unmatchedWithIdentityCount: 0, unmatchedWithoutIdentityCount: 0, gradeCorrectionCount: 0, excludedCommunicationCount: 0, archivedClassCount: 0, tables: [] },
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
  boundary.batchPresent = true;
  boundary.databaseError = null;
  boundary.records = [];
  boundary.detailRecord = null;
  boundary.queryCalls = [];
  boundary.createClient.mockImplementation(async () => {
    boundary.events.push('database');
    return { from: (table: string) => {
      const chain: Record<string, unknown> = {};
      for (const method of ['select','contains','order','limit','eq','neq','ilike','is','or']) chain[method] = (...args: unknown[]) => {
        boundary.queryCalls.push({table,method,args}); return chain;
      };
      chain.maybeSingle = async () => ({data:table==='history_import_batches'?(boundary.batchPresent?{id:'batch',manifest:{summary:emptyPage.summary},imported_at:'2026-09-07'}:null):boundary.detailRecord,error:boundary.databaseError});
      chain.range = async (...args: unknown[]) => { boundary.queryCalls.push({table,method:'range',args}); return {data:boundary.records,count:boundary.records.length,error:boundary.databaseError}; };
      return chain;
    } };
  });
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
    expect(historyArchiveMatchExplanation("no_current_identity_candidate", messages)).toBe(messages.reasonNoCurrentIdentity);
    expect(historyArchiveMatchExplanation("no_identity_fields", messages)).toBe(messages.reasonNoIdentityFields);
    expect(historyArchiveMatchExplanation("phone_only", messages)).toBe(messages.reasonPhoneOnly);
    expect(historyArchiveMatchExplanation("confirmed_during_work", messages)).toBe(messages.reasonConfirmedDuringWork);
    expect(historyArchiveMatchExplanation("non_student_source", messages)).toBe(messages.reasonNonStudent);
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

  it.each(loads)("$name authenticates and authorizes before database access", async ({ run }) => {
    await run();
    expect(boundary.events).toEqual(["authenticate", "authorize-admin", "database"]);
    expect(boundary.requireEnvironment).toHaveBeenCalledWith("zh", ["staff"]);
    expect(boundary.profile).toHaveBeenCalledWith("test-admin");
  });

  it("rejects a missing admin profile and does not treat it as an empty archive", async () => {
    boundary.profile.mockResolvedValueOnce(null);
    await expect(archiveData.loadHistoryArchivePage(filters)).rejects.toThrow("FORBIDDEN");
    expect(boundary.exists).not.toHaveBeenCalled();
  });

  it("queries the complete database batch with server pagination and all filters", async () => {
    await archiveData.loadHistoryArchivePage(filters);
    expect(boundary.queryCalls).toContainEqual({table:'history_import_records',method:'range',args:[100,149]});
    expect(boundary.queryCalls).toContainEqual({table:'history_import_records',method:'eq',args:['history_import_batch_records.batch_id','batch']});
    expect(boundary.queryCalls).toContainEqual({table:'history_import_records',method:'eq',args:['match_status','review']});
    expect(boundary.queryCalls).toContainEqual({table:'history_import_records',method:'is',args:['association',null]});
    expect(boundary.queryCalls).toContainEqual({table:'history_import_records',method:'eq',args:['source_table_id','table-source']});
    expect(boundary.readFile).not.toHaveBeenCalled();
  });

  it("shows the confirmed student while retaining original unresolved evidence", async () => {
    const stored = {
      id: 'source-example', student_id: null, source_sha256: 'synthetic-hash', source_data: { filename: 'example.base' },
      record_data: { label: '来源称呼', tableName: '历史资料', sourceRecordId: 'original-id', sourceRow: 2, dateLabel: null,
        names: ['来源称呼'], phones: [], warnings: [], cells: [{ fieldId: 'note', fieldName: '原文', kind: 'narrative', text: '保留原有资料', rawValue: '保留原有资料', type: 'text' }] },
      match_status: 'review', match_data: { reason: 'name_only' }, entity_data: null,
      candidate_data: [{ key: 'old-candidate' }],
      association: { student_id: '11111111-1111-4111-8111-111111111111', student: { id: '11111111-1111-4111-8111-111111111111', name: '确认的学员', grade: 3, phone: '', parent_phone: '13800000000' } },
    };
    const original = structuredClone(stored);
    boundary.records = [stored];
    const result = await archiveData.loadHistoryArchivePage({ ...filters, status: 'matched' });
    expect(result.rows[0]).toMatchObject({ matchStatus: 'matched', matchReason: 'confirmed_during_work', entity: { kind: 'student', name: '确认的学员' }, excerpt: '原文：保留原有资料' });
    expect(stored).toEqual(original);
    expect(boundary.queryCalls).toContainEqual({table:'history_import_records',method:'or',args:['match_status.eq.matched,association.not.is.null']});

    boundary.detailRecord = stored;
    const detail = await archiveData.loadHistoryArchiveDetail(stored.id);
    expect(detail?.record.entity?.name).toBe('确认的学员');
    expect(detail?.candidates).toEqual(original.candidate_data);
    expect(boundary.queryCalls).toContainEqual({table:'history_import_records',method:'eq',args:['association_scope.student_id',stored.association.student_id]});
  });

  it("reports database failures without presenting an empty successful import", async () => {
    boundary.databaseError={code:'XX000'};
    await expect(archiveData.loadHistoryArchivePage(filters)).rejects.toThrow('HISTORY_ARCHIVE_BATCH_READ');
  });

  it("shows an authorized preparation state before a complete database batch exists", async () => {
    boundary.batchPresent=false;
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
