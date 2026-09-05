import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";

import {
  buildHistoryArchiveDatabase,
  readHistoryArchiveDetail,
  readHistoryArchivePage,
} from "../scripts/lib/history-archive-store.mjs";

const temporaryDirectories: string[] = [];
function freshFile() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mathin-history-store-test-"));
  temporaryDirectories.push(directory);
  return path.join(directory, "synthetic.sqlite");
}
afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

const longNarrative = `${"这是历史资料原文。".repeat(80)}结尾必须完整保留`;
function fixtures() {
  const records = [
    { id: "a", text: "中文沟通：孩子喜欢图形，家长希望周末体验。", status: "matched", entityKey: "entity-a", tableId: "table-a", hasContent: true },
    { id: "b", text: longNarrative, status: "matched", entityKey: "entity-a", tableId: "table-a", hasContent: true },
    { id: "c", text: "待核对沟通，候选包含同名学员。", status: "review", entityKey: null, tableId: "table-a", hasContent: true },
    { id: "d", text: "未匹配旧档案：联系电话未知，仍需搜索。", status: "unmatched", entityKey: null, tableId: "table-b", hasContent: true },
    { id: "e", text: "保存原始标记 %_ 与单引号 ' 和全角ＡＢＣ", status: "unmatched", entityKey: null, tableId: "table-b", hasContent: true },
    { id: "f", text: "", status: "matched", entityKey: "entity-a", tableId: "table-a", hasContent: false },
    { id: "g", text: "另一名学员的独立沟通。", status: "matched", entityKey: "entity-b", tableId: "table-b", hasContent: true },
  ];
  return {
    generatedAt: "2026-01-01T00:00:00.000Z",
    packages: [{
      source: { id: "source-a", filename: "合成来源.base", sha256: "a".repeat(64) },
      tables: [{ id: "table-a", name: "历史沟通", contentRowCount: 99 }, { id: "table-b", name: "旧档案", contentRowCount: 99 }],
      records: records.map((r) => ({
        id: r.id, sourceId: "source-a", tableId: r.tableId, tableName: r.tableId === "table-a" ? "历史沟通" : "旧档案",
        sourceRecordId: `source-${r.id}`, sourceRow: 1, dateLabel: "2020-01-01", label: `合成记录 ${r.id}`, names: [], phones: [],
        hasContent: r.hasContent, warnings: [], links: [],
        cells: [{ fieldId: "note", fieldName: "沟通原文", kind: "narrative", type: "Text", text: r.text, rawValue: { text: r.text, sourceStyle: "original" } }],
      })),
      warnings: [],
    }],
    entities: [
      { key: "entity-a", kind: "student", localId: "local-uuid-a", name: "合成学生甲", phones: ["13800000001"], grade: 3, sourceKeys: ["mofaxiao:id:1001"], gradeCorrection: { previewOnly: true } },
      { key: "entity-b", kind: "student", localId: "local-uuid-b", name: "合成学生乙", phones: ["13800000002"], grade: 2, sourceKeys: ["mofaxiao:id:1002"], gradeCorrection: null },
    ],
    matches: records.map((r) => ({ recordId: r.id, status: r.status, entityKey: r.entityKey, candidateKeys: r.entityKey ? [r.entityKey] : r.status === "review" ? ["entity-a", "entity-b"] : [], reason: "synthetic_match", anchorRecordId: null as string | null })),
    decisions: { gradeDecision: { candidates: [{}, {}] }, communicationDecision: { communicationIds: ["test-communication"] }, classDecision: { sourceRecords: [{}, {}, {}, {}, {}] } },
  };
}
function build() {
  const file = freshFile();
  const input = fixtures();
  const summary = buildHistoryArchiveDatabase(file, input);
  return { file, input, summary };
}

function requireDetail(file: string, id: string, relatedPage = 1) {
  const detail = readHistoryArchiveDetail(file, id, relatedPage);
  if (!detail) throw new Error(`Missing synthetic archive record: ${id}`);
  return detail;
}

describe("history archive isolated SQLite store", () => {
  it("searches Chinese text and treats SQL-like punctuation literally with parameterized matching", () => {
    const { file } = build();
    expect(readHistoryArchivePage(file, { q: "孩子 图形" }).rows.map((r: { id: string }) => r.id)).toEqual(["a"]);
    expect(readHistoryArchivePage(file, { q: "%_" }).rows.map((r: { id: string }) => r.id)).toEqual(["e"]);
    expect(readHistoryArchivePage(file, { q: "'" }).total).toBe(1);
    expect(readHistoryArchivePage(file, { q: "' OR 1=1 --" }).total).toBe(0);
    expect(readHistoryArchivePage(file, { q: "abc" }).rows.map((r: { id: string }) => r.id)).toEqual(["e"]);
    expect(readHistoryArchivePage(file, { table: "table-a' OR 1=1 --" }).total).toBe(0);
  });

  it("keeps the complete original cell and raw value in detail while bounding only list excerpts", () => {
    const { file, input } = build();
    const detail = requireDetail(file, "b");
    expect(detail.cells).toEqual(input.packages[0].records[1].cells);
    expect(detail.cells[0].text).toBe(longNarrative);
    expect(detail.record.excerpt.length).toBe(260);
    expect(detail.record.entity).not.toHaveProperty("localId");
    expect(detail.sourceHash).toBe("a".repeat(64));
    expect(readHistoryArchiveDetail(file, "unknown-record")).toBeNull();
  });

  it("keeps unmatched records searchable and exposes review candidates without merging families", () => {
    const { file } = build();
    const page = readHistoryArchivePage(file, { q: "联系电话未知", status: "unmatched" });
    expect(page.total).toBe(1);
    expect(page.rows[0]).toMatchObject({ id: "d", entity: null, matchStatus: "unmatched" });
    const detail = requireDetail(file, "c");
    expect(detail.candidates).toHaveLength(2);
    expect(detail.candidates.every((candidate: object) => !("localId" in candidate))).toBe(true);
    expect(detail.related).toEqual([]);
    expect(detail.relatedTotal).toBe(0);
  });

  it("limits related records to matched content sharing the exact entity", () => {
    const { file } = build();
    const detail = requireDetail(file, "a", 999);
    expect(detail.related.map((r: { id: string }) => r.id)).toEqual(["b"]);
    expect(detail.relatedTotal).toBe(1);
    expect(detail.relatedPage).toBe(1);
    expect(requireDetail(file, "g").relatedTotal).toBe(0);
  });

  it("rejects duplicate record IDs and duplicated or incomplete match coverage before creating a database", () => {
    const duplicatedRecords = fixtures();
    duplicatedRecords.packages[0].records.push(duplicatedRecords.packages[0].records[0]);
    const duplicateFile = freshFile();
    expect(() => buildHistoryArchiveDatabase(duplicateFile, duplicatedRecords)).toThrow("HISTORY_ARCHIVE_COVERAGE");
    expect(fs.existsSync(duplicateFile)).toBe(false);
    const duplicatedMatches = fixtures();
    duplicatedMatches.matches.push(duplicatedMatches.matches[0]);
    expect(() => buildHistoryArchiveDatabase(freshFile(), duplicatedMatches)).toThrow("HISTORY_ARCHIVE_COVERAGE");
    const missingMatch = fixtures();
    missingMatch.matches.pop();
    expect(() => buildHistoryArchiveDatabase(freshFile(), missingMatch)).toThrow("HISTORY_ARCHIVE_COVERAGE");
  });

  it("rejects dangling identity, candidate, and source anchor references and review rows carrying an entity", () => {
    for (const mutate of [
      (input: ReturnType<typeof fixtures>) => { input.matches[0].entityKey = "missing-entity"; },
      (input: ReturnType<typeof fixtures>) => { input.matches[2].candidateKeys = ["missing-candidate"]; },
      (input: ReturnType<typeof fixtures>) => { input.matches[3].anchorRecordId = "missing-record"; },
      (input: ReturnType<typeof fixtures>) => { input.matches[2].entityKey = "entity-a"; },
    ]) {
      const input = fixtures();
      mutate(input);
      const file = freshFile();
      expect(() => buildHistoryArchiveDatabase(file, input)).toThrow("HISTORY_ARCHIVE_IDENTITY_REFERENCE");
      expect(fs.existsSync(file)).toBe(false);
    }
  });

  it("keeps pagination, summary counts, actual corrections, and confirmed archive decisions consistent", () => {
    const { file, summary } = build();
    expect(summary).toMatchObject({
      recordCount: 7, contentRecordCount: 6, matchedCount: 3, reviewCount: 1, unmatchedCount: 2,
      gradeCorrectionCount: 1, excludedCommunicationCount: 1, archivedClassCount: 5,
    });
    expect(summary.tables.map((table: { records: number }) => table.records)).toEqual([3, 3]);
    const ids = [1, 2, 3].flatMap((page) => readHistoryArchivePage(file, { page, pageSize: 2 }).rows.map((r: { id: string }) => r.id));
    expect(new Set(ids).size).toBe(summary.contentRecordCount);
    expect(ids).not.toContain("f");
    expect(readHistoryArchivePage(file, { page: 99, pageSize: 2 })).toMatchObject({ total: 6, page: 3, pageSize: 2 });
    expect(readHistoryArchivePage(file, { page: -1, pageSize: 0 })).toMatchObject({ page: 1, pageSize: 25 });
    expect(readHistoryArchivePage(file, { status: "review", pageSize: 2 }).total).toBe(summary.reviewCount);
    expect(readHistoryArchivePage(file, { table: "table-b" }).total).toBe(summary.tables[1].records);
  });

  it("does not alter database bytes or file modification time during repeated readonly page and detail reads", () => {
    const { file } = build();
    const hash = () => createHash("sha256").update(fs.readFileSync(file)).digest("hex");
    const beforeHash = hash();
    const beforeStat = fs.statSync(file, { bigint: true });
    readHistoryArchivePage(file, { q: "历史" });
    readHistoryArchiveDetail(file, "a");
    readHistoryArchiveDetail(file, "c");
    expect(hash()).toBe(beforeHash);
    expect(fs.statSync(file, { bigint: true }).mtimeNs).toBe(beforeStat.mtimeNs);
    expect(fs.readdirSync(path.dirname(file))).toEqual(["synthetic.sqlite"]);
  });

  it("rejects source-table inconsistencies and protects an already built database from overwrite", () => {
    const input = fixtures();
    input.packages[0].records[0].sourceId = "different-source";
    expect(() => buildHistoryArchiveDatabase(freshFile(), input)).toThrow("HISTORY_ARCHIVE_SOURCE_REFERENCE");
    const { file } = build();
    const original = fs.readFileSync(file);
    expect(() => buildHistoryArchiveDatabase(file, fixtures())).toThrow("HISTORY_ARCHIVE_ALREADY_EXISTS");
    expect(fs.readFileSync(file)).toEqual(original);
  });
});
