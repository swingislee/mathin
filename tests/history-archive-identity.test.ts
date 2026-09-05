import { describe, expect, it } from "vitest";

import { buildHistoryIdentityIndex, matchHistoryRecords } from "../scripts/lib/history-archive-identity.mjs";

const phoneA = "13800000001";
const phoneB = "13800000002";
const fileHash = "a".repeat(64);

function fixtures() {
  return {
    students: [
      { id: "local-a", name: "样例甲", grade: 4, phone: phoneA, parent_phone: null },
      { id: "local-b", name: "样例乙", grade: 2, phone: phoneA, parent_phone: null },
      { id: "local-c", name: "样例丙", grade: 3, phone: phoneB, parent_phone: null },
      { id: "local-roster", name: "名册样例", grade: 2, phone: null, parent_phone: null },
      { id: "local-test", name: "验收虚构学生", grade: 2, phone: "13800000009", parent_phone: null },
      { id: "local-preview", name: "未完成导入", grade: 2, phone: "13800000008", parent_phone: null },
    ],
    leads: [{ id: "local-lead", provisional_student_name: "线索样例", phone: "13800000003", phone_normalized: "13800000003", grade_hint: 1 }],
    data_import_batches: [
      { id: "students-batch", status: "completed", import_kind: "students", source_system: "mofaxiao" },
      { id: "preview-batch", status: "validated", import_kind: "students", source_system: "mofaxiao" },
      { id: "roster-batch", status: "completed", import_kind: "enrollments", source_system: "mofaxiao", source_file_hash: fileHash, source_sheet_name: "名册" },
      { id: "leads-batch", status: "completed", import_kind: "leads", source_system: "xiaoditui" },
    ],
    data_import_rows: [
      { batch_id: "students-batch", row_status: "inserted", normalized_key: "mofaxiao:id:1001", target_id: "local-a" },
      { batch_id: "students-batch", row_status: "inserted", normalized_key: "mofaxiao:id:1002", target_id: "local-b" },
      { batch_id: "students-batch", row_status: "inserted", normalized_key: "mofaxiao:id:1003", target_id: "local-c" },
      { batch_id: "preview-batch", row_status: "inserted", normalized_key: "mofaxiao:id:1004", target_id: "local-preview" },
      { batch_id: "leads-batch", row_status: "inserted", normalized_key: "lead:13800000003:线索样例", target_id: "local-lead" },
      { batch_id: "roster-batch", row_status: "inserted", normalized_key: "class:local-class:student:local-a", target_id: "enrollment-a", payload: { decision: "link_existing", sourceCell: "A3", studentId: "local-a", classroomId: "local-class" } },
      { batch_id: "roster-batch", row_status: "inserted", normalized_key: "class:local-class:new:名册样例", target_id: "enrollment-r", payload: { decision: "create_student", sourceCell: "B3", studentId: "local-roster", classroomId: "local-class" } },
    ],
    enrollments: [
      { id: "enrollment-a", student_id: "local-a", classroom_id: "local-class" },
      { id: "enrollment-r", student_id: "local-roster", classroom_id: "local-class" },
    ],
  };
}

function record(id: string, names: string[] = [], phones: string[] = [], extra = {}) {
  return {
    id, sourceId: "source-file", tableId: "people", tableName: "学员资料", sourceRecordId: id,
    label: names[0] ?? id, names, phones, hasContent: true, links: [],
    cells: names.map((name) => ({ fieldId: "name", fieldName: "学员姓名", kind: "identity", type: "Text", text: name, rawValue: name })),
    ...extra,
  };
}

function linkedRecord(id: string, targetRecordId: string, fieldName = "关联学员", names: string[] = []) {
  return record(id, names, [], {
    tableId: "history", tableName: "沟通记录",
    cells: [{ fieldId: "person", fieldName, kind: "context", type: "Link", text: "", rawValue: targetRecordId }],
    links: [{ fieldId: "person", targetTableId: "people", targetRecordId }],
  });
}

describe("history archive source identities", () => {
  it("includes completed precise source targets and retains roster aliases while excluding samples and previews", () => {
    const index = buildHistoryIdentityIndex({ tables: fixtures() });
    expect(index.diagnostics).toMatchObject({ eligibleStudents: 4, eligibleLeads: 1, conflictingSourceKeyCount: 0 });
    expect(index.entities.map((entity: { localId: string }) => entity.localId)).not.toContain("local-test");
    expect(index.entities.map((entity: { localId: string }) => entity.localId)).not.toContain("local-preview");
    expect(index.entities.find((entity: { localId: string }) => entity.localId === "local-a")?.sourceKeys).toHaveLength(2);
    expect(index.entities.flatMap((entity: { sourceKeys: string[] }) => entity.sourceKeys).some((key: string) => key.includes("local-class"))).toBe(false);
  });

  it("produces stable keys after local UUIDs and input ordering change", () => {
    const original = fixtures();
    const rewritten = JSON.parse(JSON.stringify(original).replaceAll("local-", "different-db-"));
    rewritten.data_import_rows.reverse();
    const before = buildHistoryIdentityIndex({ tables: original });
    const after = buildHistoryIdentityIndex({ tables: rewritten });
    expect(after.entities.map((entity: { key: string }) => entity.key)).toEqual(before.entities.map((entity: { key: string }) => entity.key));
    expect(buildHistoryIdentityIndex({ tables: original }).entities).toEqual(before.entities);
  });

  it("applies only confirmed grade corrections to a matching snapshot without mutating source rows", () => {
    const tables = fixtures();
    const original = structuredClone(tables);
    const decisions = { version: 2, gradeDecision: {
      classification: "user_confirmed_accidental_school_year_promotion",
      candidates: [{ studentId: "local-a", sourceKey: "mofaxiao:id:1001", proposedGrade: 3, snapshotStudent: { grade: 4 } }],
    } };
    const index = buildHistoryIdentityIndex({ tables, decisions });
    expect(index.entities.find((entity: { localId: string }) => entity.localId === "local-a")).toMatchObject({
      grade: 3, gradeCorrection: { sourceGrade: 3, snapshotGrade: 4, previewOnly: true, decisionVersion: 2 },
    });
    expect(tables).toEqual(original);
    decisions.gradeDecision.candidates[0].snapshotStudent.grade = 5;
    const stale = buildHistoryIdentityIndex({ tables, decisions });
    expect(stale.diagnostics.skippedGradeCorrections).toHaveLength(1);
    expect(stale.entities.find((entity: { localId: string }) => entity.localId === "local-a")?.grade).toBe(4);
  });

  it("fails closed for a reused source ID and a roster ledger with a conflicting actual membership", () => {
    const tables = fixtures();
    tables.data_import_rows.push({ batch_id: "students-batch", row_status: "inserted", normalized_key: "mofaxiao:id:1001", target_id: "local-test" });
    tables.enrollments[1].student_id = "local-test";
    const index = buildHistoryIdentityIndex({ tables });
    expect(index.diagnostics).toMatchObject({ conflictingSourceKeyCount: 1, excludedConflictingEntities: 2, eligibleStudents: 2 });
    expect(index.entities.map((entity: { localId: string }) => entity.localId)).not.toContain("local-roster");
  });
});

describe("history identity matching", () => {
  it("uses the exact name and phone combination to distinguish siblings sharing a phone", () => {
    const index = buildHistoryIdentityIndex({ tables: fixtures() });
    const result = matchHistoryRecords([
      record("a", ["样例甲"], ["+86 138-0000-0001"]), record("b", ["样例乙"], [phoneA]), record("p", [], [phoneA]),
    ], index);
    expect(result.map((row: { status: string }) => row.status)).toEqual(["matched", "matched", "review"]);
    expect(result[0].entityKey).not.toBe(result[1].entityKey);
    expect(result[2]).toMatchObject({ reason: "phone_only", entityKey: null });
    expect(result[2].candidateKeys).toHaveLength(2);
  });

  it("keeps name-only, conflicting, multiple-child, and unknown identities for review or source-only search", () => {
    const index = buildHistoryIdentityIndex({ tables: fixtures() });
    const result = matchHistoryRecords([
      record("name", ["样例甲"]), record("conflict", ["样例甲"], [phoneB]),
      record("children", ["样例甲", "样例乙"], [phoneA]), record("unknown", ["历史未匹配人"], ["13800000007"]),
      record("two-phones", ["样例甲"], [phoneA, phoneB]),
    ], index);
    expect(result.map((row: { status: string }) => row.status)).toEqual(["review", "review", "review", "unmatched", "review"]);
    expect(result.every((row: { entityKey: unknown }) => row.entityKey === null)).toBe(true);
  });

  it("does not deduplicate different student and lead identities with the same name and phone", () => {
    const tables = fixtures();
    tables.leads[0] = { ...tables.leads[0], provisional_student_name: "样例甲", phone: phoneA, phone_normalized: phoneA };
    const [result] = matchHistoryRecords([record("a", ["样例甲"], [phoneA])], buildHistoryIdentityIndex({ tables }));
    expect(result.status).toBe("review");
    expect(result.candidateKeys.length).toBeGreaterThan(1);
  });

  it("accepts a unique explicitly named external ID and rejects contradictory or unknown external IDs", () => {
    const index = buildHistoryIdentityIndex({ tables: fixtures() });
    const cell = (value: string) => ({ fieldId: "external", fieldName: "魔法校学员ID", kind: "context", text: value, rawValue: value });
    const result = matchHistoryRecords([
      record("id", [], [], { cells: [cell("1001")] }),
      record("conflict", ["样例丙"], [], { cells: [cell("1001")] }),
      record("unknown", ["样例甲"], [phoneA], { cells: [cell("9999")] }),
      record("generic", [], [], { cells: [{ ...cell("1001"), fieldName: "学员ID" }] }),
    ], index);
    expect(result.map((row: { status: string }) => row.status)).toEqual(["matched", "review", "review", "unmatched"]);
    expect(result[0].reason).toBe("unique_explicit_source_id");
  });

  it("never extracts identity clues from narrative mentions", () => {
    const index = buildHistoryIdentityIndex({ tables: fixtures() });
    const [result] = matchHistoryRecords([record("note", [], [], {
      cells: [{ fieldId: "note", fieldName: "沟通记录", kind: "narrative", text: `备注提到了样例甲 ${phoneA}` }],
    })], index);
    expect(result).toMatchObject({ status: "unmatched", candidateKeys: [] });
  });

  it("propagates only one direct person anchor and blocks conflicting identity and shared classes", () => {
    const index = buildHistoryIdentityIndex({ tables: fixtures() });
    const result = matchHistoryRecords([
      record("person", ["样例甲"], [phoneA]),
      linkedRecord("history", "person"),
      linkedRecord("conflict", "person", "关联学员", ["样例乙"]),
      linkedRecord("class-link", "person", "关联班级"),
      record("shared-class", ["样例甲"], [phoneA], { tableName: "班级表" }),
      linkedRecord("unsafe-anchor", "shared-class"),
      linkedRecord("chain", "history"),
    ], index);
    expect(result[1]).toMatchObject({ status: "matched", anchorRecordId: "person", reason: "unique_direct_person_anchor" });
    expect(result[2]).toMatchObject({ status: "review", entityKey: null, reason: "person_anchor_identity_conflict" });
    expect(result[3]).toMatchObject({ status: "unmatched", anchorRecordId: null });
    expect(result[5]).toMatchObject({ status: "unmatched", anchorRecordId: null });
    expect(result[6]).toMatchObject({ status: "unmatched", anchorRecordId: null });
  });

  it("retains an unmatched source person anchor without claiming a matched family", () => {
    const index = buildHistoryIdentityIndex({ tables: fixtures() });
    const result = matchHistoryRecords([record("old-person", ["历史未匹配人"]), linkedRecord("history", "old-person")], index);
    expect(result[1]).toMatchObject({ status: "unmatched", entityKey: null, anchorRecordId: "old-person" });
  });

  it("keeps conflicting source-only identities out of the same source-person group", () => {
    const index = buildHistoryIdentityIndex({ tables: fixtures() });
    const result = matchHistoryRecords([
      record("old-person", ["历史未匹配人"]), linkedRecord("history", "old-person", "关联学员", ["另一位历史人"]),
    ], index);
    expect(result[1]).toMatchObject({ status: "review", entityKey: null, anchorRecordId: null, reason: "person_anchor_identity_conflict" });
  });

  it("requires unique person links and respects source-file boundaries", () => {
    const index = buildHistoryIdentityIndex({ tables: fixtures() });
    const link = linkedRecord("history", "person-a");
    const result = matchHistoryRecords([
      record("person-a", ["样例甲"], [phoneA]), record("person-b", ["样例乙"], [phoneA]),
      { ...link, links: [...link.links, { fieldId: "person", targetTableId: "people", targetRecordId: "person-b" }] },
      { ...linkedRecord("other-source", "person-a"), sourceId: "other-file" },
      { ...linkedRecord("missing-second-person", "person-a"), links: [...link.links, { fieldId: "person", targetTableId: "people", targetRecordId: "missing-person" }] },
    ], index);
    expect(result[2]).toMatchObject({ status: "review", entityKey: null, reason: "multiple_person_anchors" });
    expect(result[3]).toMatchObject({ status: "unmatched", anchorRecordId: null });
    expect(result[4]).toMatchObject({ status: "review", entityKey: null, reason: "multiple_person_anchors" });
  });
});
