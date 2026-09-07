/** 合并授权 HAR 观察，只增加已观察讲次，保留其他课程和原有缺失槽位事实。 */
export function mergeAixuexiCatalogCapture(base, incoming) {
  if (!base) return structuredClone(incoming);
  const fail = (reason) => { throw new Error(`AIXUEXI_CATALOG_MERGE: ${reason}`); };
  if (base.packageKey !== incoming.packageKey || base.sourceSystem !== incoming.sourceSystem
      || ["year", "term", "series", "textbook", "subject", "track"].some((key) => base.scope[key] !== incoming.scope[key])) {
    fail("课程包范围不一致");
  }
  const result = structuredClone(base);
  result.schemaVersion = "aixuexi-course-catalog-capture-v1";
  result.captureMode = "authorized_har";
  result.capturedAt = incoming.capturedAt;
  for (const grade of result.grades) {
    for (const course of grade.courses) {
      course.expectedLessonCount ??= course.lessons.length;
      course.missingLessons ??= [];
      course.coverageStatus ??= "complete";
    }
  }
  for (const observedGrade of incoming.grades) {
    let grade = result.grades.find((value) => value.grade === observedGrade.grade);
    if (!grade) { grade = { ...structuredClone(observedGrade), courses: [] }; result.grades.push(grade); }
    if (observedGrade.courses.length) { grade.captureStatus = "captured"; delete grade.errorCode; }
    for (const observed of observedGrade.courses) {
      let course = grade.courses.find((value) => value.courseKey === observed.courseKey);
      if (!course) { course = structuredClone(observed); course.position = grade.courses.length + 1; grade.courses.push(course); continue; }
      if (["classTypeId", "subjectId", "businessId", "businessType", "lectureRelationship", "newDiyFlag", "jiangYiType", "name"].some((key) => course[key] !== observed[key])) {
        fail(`课程 ${course.courseKey} 身份发生变化`);
      }
      for (const lesson of observed.lessons) {
        const existing = course.lessons.find((value) => value.index === lesson.index || value.lessonId === lesson.lessonId);
        if (existing && (existing.index !== lesson.index || existing.lessonId !== lesson.lessonId || existing.name !== lesson.name)) {
          fail(`第 ${lesson.index} 讲已有不同来源身份或名称`);
        }
        if (!existing) course.lessons.push(structuredClone(lesson));
      }
      course.lessons.sort((a, b) => a.index - b.index);
      course.expectedLessonCount = Math.max(course.expectedLessonCount, observed.expectedLessonCount ?? observed.lessons.length);
      const missing = new Map((observed.missingLessons ?? []).map((slot) => [slot.lessonIndex, slot]));
      for (const slot of course.missingLessons) missing.set(slot.lessonIndex, slot);
      for (const lesson of course.lessons) missing.delete(lesson.index);
      course.missingLessons = [...missing.values()].sort((a, b) => a.lessonIndex - b.lessonIndex);
      course.coverageStatus = course.lessons.length === course.expectedLessonCount && !course.missingLessons.length ? "complete" : "partial";
    }
  }
  result.scope.expectedGrades = [...new Set([...base.scope.expectedGrades, ...incoming.scope.expectedGrades])];
  result.grades.sort((a, b) => result.scope.expectedGrades.indexOf(a.grade) - result.scope.expectedGrades.indexOf(b.grade));
  result.scope.coverageStatus = result.scope.expectedGrades.every((name) => {
    const grade = result.grades.find((value) => value.grade === name);
    return grade && grade.captureStatus !== "failed" && grade.courses.every((course) => course.coverageStatus === "complete");
  }) ? "complete" : "partial";
  const allIds = result.grades.flatMap((grade) => grade.courses.flatMap((course) => course.lessons.map((lesson) => lesson.lessonId)));
  if (new Set(allIds).size !== allIds.length) fail("同一讲次出现在多个课程中");
  return result;
}
