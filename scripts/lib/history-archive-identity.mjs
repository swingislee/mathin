import { createHash } from "node:crypto";

const unique = (values) => [...new Set(values)].sort();
const text = (value) => (typeof value === "string" || typeof value === "number" ? String(value).normalize("NFKC").trim() : "");
const normalizedName = (value) => text(value).replace(/\s+/gu, " ");
const digest = (value) => createHash("sha256").update(value, "utf8").digest("hex");

function normalizedPhone(value) {
  const compact = text(value).replace(/[\s()-]/gu, "");
  const domestic = compact.replace(/^(?:\+86|0086)/u, "");
  if (/^1[3-9]\d{9}$/u.test(domestic)) return domestic;
  return /^\+[1-9]\d{7,14}$/u.test(compact) ? compact : "";
}

function phoneList(values) {
  return unique(values.flatMap((value) => text(value).split(/[;,，；、/\n]/u)).map(normalizedPhone).filter(Boolean));
}

function addIndex(index, value, key) {
  if (!value) return;
  if (!index.has(value)) index.set(value, new Set());
  index.get(value).add(key);
}

function sourcePriority(key) {
  return key.startsWith("mofaxiao:id:") ? 0 : key.startsWith("xiaoditui:lead:") ? 1 : 2;
}

/**
 * Build a read-only preview index from completed source import ledgers.
 * Local UUIDs locate snapshot evidence; stable keys depend only on source keys.
 * The caller keeps this PII-bearing result in an ignored local rehearsal store.
 */
export function buildHistoryIdentityIndex({ tables = {}, decisions = {} } = {}) {
  const students = new Map((tables.students ?? []).map((row) => [row.id, row]));
  const leads = new Map((tables.leads ?? []).map((row) => [row.id, row]));
  const enrollments = new Map((tables.enrollments ?? []).map((row) => [row.id, row]));
  const batches = new Map((tables.data_import_batches ?? []).filter((row) => row.status === "completed").map((row) => [row.id, row]));
  const eligible = new Map();
  let ignoredLedgerRows = 0;

  function include(kind, localId, sourceKey) {
    const rows = kind === "student" ? students : leads;
    if (!rows.has(localId) || !sourceKey) return false;
    const localKey = `${kind}:${localId}`;
    if (!eligible.has(localKey)) eligible.set(localKey, { kind, localId, row: rows.get(localId), sourceKeys: new Set() });
    eligible.get(localKey).sourceKeys.add(sourceKey);
    return true;
  }

  for (const row of tables.data_import_rows ?? []) {
    const batch = batches.get(row.batch_id);
    if (!batch || row.row_status !== "inserted" || !row.target_id) {
      ignoredLedgerRows += 1;
      continue;
    }
    const key = text(row.normalized_key);
    let included = false;
    if (batch.import_kind === "students" && batch.source_system === "mofaxiao" && /^mofaxiao:id:\d+$/u.test(key)) {
      included = include("student", row.target_id, key);
    } else if (batch.import_kind === "leads" && batch.source_system === "xiaoditui" && /^lead:[^:]+:.+$/u.test(key)) {
      included = include("lead", row.target_id, `xiaoditui:${key}`);
    } else if (batch.import_kind === "enrollments" && batch.source_system === "mofaxiao") {
      const payload = row.payload ?? {};
      const enrollment = enrollments.get(row.target_id);
      const cell = text(payload.sourceCell).toUpperCase();
      const sheet = text(batch.source_sheet_name);
      const fileHash = text(batch.source_file_hash).toLowerCase();
      if (
        ["create_student", "link_existing"].includes(payload.decision) &&
        enrollment?.student_id === payload.studentId &&
        enrollment?.classroom_id === payload.classroomId &&
        /^[a-f0-9]{64}$/u.test(fileHash) && sheet && /^[A-Z]{1,3}[1-9]\d*$/u.test(cell)
      ) {
        included = include("student", payload.studentId, `roster:sha256:${fileHash}:sheet:${encodeURIComponent(sheet)}:cell:${cell}`);
      }
    }
    if (!included) ignoredLedgerRows += 1;
  }

  const sourceOwners = new Map();
  for (const [localKey, entity] of eligible) {
    for (const key of entity.sourceKeys) addIndex(sourceOwners, key, localKey);
  }
  const conflicts = [...sourceOwners].filter(([, owners]) => owners.size > 1);
  const conflictedLocals = new Set(conflicts.flatMap(([, owners]) => [...owners]));
  const gradeCandidates = decisions.gradeDecision?.classification === "user_confirmed_accidental_school_year_promotion"
    ? decisions.gradeDecision.candidates ?? [] : [];
  const skippedGradeCorrections = [];
  const entities = [];
  for (const [localKey, entry] of eligible) {
    // A reused source ID cannot choose a local target by iteration order.
    if (conflictedLocals.has(localKey)) continue;
    const { kind, localId, row } = entry;
    const sourceKeys = [...entry.sourceKeys].sort((a, b) => sourcePriority(a) - sourcePriority(b) || a.localeCompare(b, "en"));
    let grade = Number.isInteger(kind === "student" ? row.grade : row.grade_hint) ? (kind === "student" ? row.grade : row.grade_hint) : null;
    let gradeCorrection = null;
    const candidates = gradeCandidates.filter((candidate) => candidate.studentId === localId && sourceKeys.includes(candidate.sourceKey));
    if (kind === "student" && candidates.length) {
      const candidate = candidates[0];
      const sourceGrade = candidate.sourceGrade ?? candidate.proposedGrade;
      if (candidates.length === 1 && Number.isInteger(sourceGrade) && candidate.snapshotStudent?.grade === grade) {
        gradeCorrection = {
          classification: decisions.gradeDecision.classification,
          decisionVersion: decisions.version ?? null,
          sourceKey: candidate.sourceKey,
          sourceRow: candidate.sourceRow ?? null,
          snapshotGrade: grade,
          sourceGrade,
          previewOnly: true,
        };
        grade = sourceGrade;
      } else {
        skippedGradeCorrections.push({ localId, reason: "grade_decision_does_not_match_snapshot" });
      }
    }
    entities.push({
      key: `history:${kind}:${digest(sourceKeys[0])}`,
      kind,
      sourceKeys,
      localId,
      name: text(kind === "student" ? row.name : row.provisional_student_name),
      phones: phoneList(kind === "student" ? [row.phone, row.parent_phone] : [row.phone_normalized, row.phone]),
      grade,
      gradeCorrection,
    });
  }
  entities.sort((a, b) => a.key.localeCompare(b.key, "en"));
  const byName = new Map();
  const byPhone = new Map();
  const bySourceKey = new Map();
  const byKey = new Map();
  for (const entity of entities) {
    byKey.set(entity.key, entity);
    addIndex(byName, normalizedName(entity.name), entity.key);
    entity.phones.forEach((phone) => addIndex(byPhone, phone, entity.key));
    entity.sourceKeys.forEach((key) => addIndex(bySourceKey, key, entity.key));
  }
  return {
    entities, byKey, byName, byPhone, bySourceKey,
    diagnostics: {
      ignoredLedgerRows,
      conflictingSourceKeyCount: conflicts.length,
      excludedConflictingEntities: conflictedLocals.size,
      skippedGradeCorrections,
      eligibleStudents: entities.filter((entity) => entity.kind === "student").length,
      eligibleLeads: entities.filter((entity) => entity.kind === "lead").length,
      gradeCorrections: entities.filter((entity) => entity.gradeCorrection).length,
    },
  };
}

function explicitSourceKeys(record, index) {
  return unique((record.cells ?? []).flatMap((cell) => {
    const value = text(cell.text || cell.rawValue);
    if (cell.kind === "external_id" && index.bySourceKey.has(value)) return [value];
    if (cell.kind === "external_id" && /^(?:mofaxiao:id:|xiaoditui:lead:|roster:sha256:)/u.test(value)) return [value];
    if (/^(?:魔法校(?:学员|学生)?(?:ID|编号)|mofaxiao[_ -]?(?:student[_ -]?)?id)$/iu.test(text(cell.fieldName)) && /^\d+$/u.test(value)) {
      return [`mofaxiao:id:${value}`];
    }
    return [];
  }));
}

function directMatch(record, index) {
  const names = unique((record.names ?? []).map(normalizedName).filter(Boolean));
  const phones = phoneList(record.phones ?? []);
  const externalKeys = explicitSourceKeys(record, index);
  const lookup = (map, values) => unique(values.flatMap((value) => [...(map.get(value) ?? [])]));
  const nameKeys = lookup(index.byName, names);
  const phoneKeys = lookup(index.byPhone, phones);
  const externalCandidates = lookup(index.bySourceKey, externalKeys);
  const allCandidates = unique([...nameKeys, ...phoneKeys, ...externalCandidates]);
  const base = { recordId: record.id, status: "unmatched", entityKey: null, candidateKeys: allCandidates, reason: "no_identity_candidate", anchorRecordId: null };
  const compatible = (entity) => names.every((name) => name === normalizedName(entity.name)) && phones.every((phone) => entity.phones.includes(phone));

  if (externalKeys.length) {
    const complete = externalKeys.every((key) => (index.bySourceKey.get(key)?.size ?? 0) === 1);
    if (complete && externalCandidates.length === 1 && compatible(index.byKey.get(externalCandidates[0]))) {
      return { ...base, status: "matched", entityKey: externalCandidates[0], candidateKeys: externalCandidates, reason: "unique_explicit_source_id" };
    }
    return { ...base, status: "review", reason: "external_id_missing_ambiguous_or_conflicting" };
  }
  const exact = nameKeys.filter((key) => phoneKeys.includes(key));
  if (names.length && phones.length && exact.length === 1 && compatible(index.byKey.get(exact[0]))) {
    return { ...base, status: "matched", entityKey: exact[0], candidateKeys: exact, reason: "unique_exact_name_and_phone" };
  }
  if (allCandidates.length || names.length > 1) {
    return {
      ...base,
      status: "review",
      reason: names.length && phones.length ? "identity_ambiguous_or_conflicting" : names.length ? "name_only" : "phone_only",
    };
  }
  return base;
}

function personAnchor(record) {
  return !/(?:班级|班表|课程|课表|活动表|场次|工作台|classroom|course|event)/iu.test(text(record.tableName)) &&
    (record.cells ?? []).some((cell) => cell.kind === "identity" && /^(?:姓名|学员姓名|学生姓名|孩子姓名|儿童姓名|child_?name|student_?name)$/iu.test(text(cell.fieldName)) && text(cell.text));
}

function personLink(record, link) {
  const cell = (record.cells ?? []).find((value) => value.fieldId === link.fieldId);
  return Boolean(cell && /^(?:关联)?(?:学员|学生|孩子|儿童|线索)(?:姓名|档案|信息|记录)?$/u.test(text(cell.fieldName)));
}

/**
 * Match direct identity facts, then follow one explicitly named person link.
 * Shared classes/events and graph chains never establish family identity.
 */
export function matchHistoryRecords(records, index) {
  const results = records.map((record) => directMatch(record, index));
  const bySourceRecord = new Map();
  records.forEach((record, position) => {
    const key = JSON.stringify([record.sourceId, record.tableId, record.sourceRecordId]);
    if (!bySourceRecord.has(key)) bySourceRecord.set(key, []);
    bySourceRecord.get(key).push({ record, result: results[position] });
  });

  return records.map((record, position) => {
    const direct = results[position];
    const personLinks = (record.links ?? []).filter((link) => personLink(record, link));
    const anchors = personLinks.flatMap((link) => {
      const targets = bySourceRecord.get(JSON.stringify([record.sourceId, link.targetTableId, link.targetRecordId])) ?? [];
      return targets.length === 1 && personAnchor(targets[0].record) ? targets : [];
    });
    const distinctAnchors = [...new Map(anchors.map((anchor) => [anchor.record.id, anchor])).values()];
    if (!distinctAnchors.length) return direct;
    const distinctReferences = unique(personLinks.map((link) => JSON.stringify([link.targetTableId, link.targetRecordId])));
    if (distinctAnchors.length !== 1 || distinctReferences.length !== 1) {
      return { ...direct, status: "review", entityKey: null, candidateKeys: unique([...direct.candidateKeys, ...distinctAnchors.flatMap((anchor) => anchor.result.candidateKeys)]), reason: "multiple_person_anchors" };
    }
    const anchor = distinctAnchors[0];
    const linked = { ...direct, anchorRecordId: anchor.record.id };
    const names = unique((record.names ?? []).map(normalizedName).filter(Boolean));
    const phones = phoneList(record.phones ?? []);
    const anchorNames = unique((anchor.record.names ?? []).map(normalizedName).filter(Boolean));
    const anchorPhones = phoneList(anchor.record.phones ?? []);
    const sourceConflict = (names.length && anchorNames.length && names.some((name) => !anchorNames.includes(name))) ||
      (phones.length && anchorPhones.length && phones.some((phone) => !anchorPhones.includes(phone)));
    if (sourceConflict) {
      return { ...direct, status: "review", entityKey: null, candidateKeys: unique([...direct.candidateKeys, ...anchor.result.candidateKeys]), reason: "person_anchor_identity_conflict" };
    }
    if (anchor.result.status !== "matched") return linked;
    const entity = index.byKey.get(anchor.result.entityKey);
    const externalKeys = explicitSourceKeys(record, index);
    const compatible = names.every((name) => name === normalizedName(entity.name)) &&
      phones.every((phone) => entity.phones.includes(phone)) &&
      externalKeys.every((key) => entity.sourceKeys.includes(key));
    if (!compatible || (direct.status === "matched" && direct.entityKey !== entity.key)) {
      return { ...linked, status: "review", entityKey: null, candidateKeys: unique([...direct.candidateKeys, entity.key]), reason: "person_anchor_identity_conflict" };
    }
    return { ...linked, status: "matched", entityKey: entity.key, candidateKeys: [entity.key], reason: direct.status === "matched" ? direct.reason : "unique_direct_person_anchor" };
  });
}
