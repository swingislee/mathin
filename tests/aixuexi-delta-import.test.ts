import { describe, expect, it } from "vitest";
import { mergeAixuexiCatalogCapture } from "../scripts/lib/aixuexi-catalog-merge.mjs";
import { assertIncrementalSourceState } from "../scripts/lib/aixuexi-source-snapshots.mjs";
import { sourceRuntimeImportFingerprint } from "../scripts/cw-import.mjs";

const lesson = (index: number) => ({ lessonId: String(100 + index), index, name: `lesson ${index}` });
function capture(indexes: number[]) {
  return {
    packageKey: "package", sourceSystem: "aixuexi_bsk", capturedAt: "2026-09-07", schemaVersion: "aixuexi-autumn-catalog-capture-v2",
    scope: { year: "2026", term: "秋季", series: "G+", textbook: "苏教版", subject: "数学", track: "能力强化", expectedGrades: ["五年级", "六年级"], coverageStatus: "partial" },
    grades: [{ grade: "五年级", captureStatus: "captured", courses: [{ courseKey: "course-5", position: 1, name: "course", classTypeId: "1", subjectId: "2", businessId: "3", businessType: "4", lectureRelationship: "5", newDiyFlag: "6", jiangYiType: "7", lessons: indexes.map(lesson), expectedLessonCount: 3, coverageStatus: "partial", missingLessons: [1, 2, 3].filter((index) => !indexes.includes(index)).map((index) => ({ lessonIndex: index, lessonId: String(100 + index), expectedName: null, status: "source_not_published" })) }] }],
  };
}
describe("catalog delta merge", () => {
  it("preserves other grades, old lessons, missing-slot evidence and source input", () => {
    const base = capture([1]);
    const other = structuredClone(base.grades[0]); other.grade = "六年级"; other.courses[0].courseKey = "course-6"; other.courses[0].lessons = [{ ...lesson(1), lessonId: "601" }];
    base.grades.push(other);
    const before = structuredClone(base);
    const merged = mergeAixuexiCatalogCapture(base, capture([2]));
    expect(merged.grades).toHaveLength(2);
    expect(merged.grades[0].courses[0].lessons.map((value: { index: number }) => value.index)).toEqual([1, 2]);
    expect(merged.grades[0].courses[0].missingLessons).toEqual([base.grades[0].courses[0].missingLessons[1]]);
    expect(merged.grades[1]).toEqual(other);
    expect(base).toEqual(before);
  });
  it("rejects conflicting lesson identity and scope", () => {
    const update = capture([1]); update.grades[0].courses[0].lessons[0].lessonId = "999";
    expect(() => mergeAixuexiCatalogCapture(capture([1]), update)).toThrow("不同来源身份");
    update.scope.term = "暑期";
    expect(() => mergeAixuexiCatalogCapture(capture([1]), update)).toThrow("范围不一致");
  });
  it("repeating the same observation adds no duplicate lesson", () => {
    const added = mergeAixuexiCatalogCapture(capture([1]), capture([2]));
    expect(mergeAixuexiCatalogCapture(added, capture([2]))).toEqual(added);
  });
});
describe("add-only source receipts", () => {
  it("uses per-lesson content independently from full-package observation hashes", () => {
    const plan = { lecture: { sourceRuntimePackageHash: "a".repeat(64), sourcePackageManifestSha256: "b".repeat(64) }, pages: [{ pageNo: 1, doc: { text: "one" } }], bindings: [], assets: [] };
    const changedPackage = { ...plan, lecture: { ...plan.lecture, sourcePackageManifestSha256: "c".repeat(64) } };
    expect(sourceRuntimeImportFingerprint(plan)).not.toBe(sourceRuntimeImportFingerprint(changedPackage));
    expect(sourceRuntimeImportFingerprint(plan, { snapshotIndependent: true })).toBe(sourceRuntimeImportFingerprint(changedPackage, { snapshotIndependent: true }));
    expect(sourceRuntimeImportFingerprint(plan, { snapshotIndependent: true })).not.toBe(sourceRuntimeImportFingerprint({ ...plan, pages: [{ pageNo: 1, doc: { text: "two" } }] }, { snapshotIndependent: true }));
  });
  it("adds only empty targets and reuses only matching receipts and mappings", () => {
    expect(assertIncrementalSourceState({ receiptCount: 0, pageCount: 0, releaseCount: 0 })).toBe("add");
    expect(assertIncrementalSourceState({ receiptCount: 1, contentMatches: true, mappingMatches: true, pageCount: 25 })).toBe("reuse");
    expect(() => assertIncrementalSourceState({ receiptCount: 1, contentMatches: false, mappingMatches: true })).toThrow("CONTENT_CHANGED");
    expect(() => assertIncrementalSourceState({ receiptCount: 1, contentMatches: true, mappingMatches: false })).toThrow("MAPPING_CHANGED");
    expect(() => assertIncrementalSourceState({ receiptCount: 0, pageCount: 1 })).toThrow("TARGET_HAS_CONTENT");
    expect(() => assertIncrementalSourceState({ receiptCount: 0, pageCount: 0, releaseCount: 1 })).toThrow("TARGET_HAS_CONTENT");
  });
});
