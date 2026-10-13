type GradeRange = { grade: number; gradeEnd?: number | null };

export function courseGradeLabel(course: GradeRange): string {
  return course.gradeEnd && course.gradeEnd > course.grade
    ? `${course.grade}–${course.gradeEnd}` : String(course.grade);
}

export function courseGrades(course: GradeRange): number[] {
  return Array.from({ length: (course.gradeEnd ?? course.grade) - course.grade + 1 }, (_, i) => course.grade + i);
}
