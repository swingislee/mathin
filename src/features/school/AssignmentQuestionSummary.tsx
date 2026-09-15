import { useTranslations } from "next-intl";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DashboardTableShell } from "./dashboard-page";
import { LearningCheckStatusMark } from "./LearningCheckStatusMark";
import { assignmentQuestionKey, type AssignmentQuestionWorkbook } from "./assignment-question-contract";

export function AssignmentQuestionSummary({ data }: { data: AssignmentQuestionWorkbook }) {
  const t = useTranslations("school.homeworkQuestions");
  const results = new Map(data.results.map(row => [assignmentQuestionKey(row.studentId, row.questionId), row]));
  if (data.questions.length === 0) return <p className="text-xs text-muted">{t("noQuestions")}</p>;
  return <DashboardTableShell><Table className="text-xs [&_td]:px-2 [&_td]:py-1.5 [&_th]:px-2">
    <TableHeader><TableRow><TableHead>{t("student")}</TableHead>{data.questions.map(question => <TableHead key={question.id} className="min-w-16 max-w-32 whitespace-normal text-center">{question.title}</TableHead>)}<TableHead>{t("recorded")}</TableHead></TableRow></TableHeader>
    <TableBody>{data.students.map(student => <TableRow key={student.id}>
      <TableCell className="font-medium">{student.name}</TableCell>
      {data.questions.map(question => {
        const result = results.get(assignmentQuestionKey(student.id, question.id));
        return <TableCell key={question.id} className="text-center"><LearningCheckStatusMark status={result?.status ?? "unchecked"} solid detail={`${student.name} · ${question.title}${result?.note ? ` · ${result.note}` : ""}`} /></TableCell>;
      })}
      <TableCell className="tabular-nums text-muted">{data.questions.filter(question => { const result = results.get(assignmentQuestionKey(student.id, question.id)); return result && result.status !== "unchecked"; }).length}/{data.questions.length}</TableCell>
    </TableRow>)}</TableBody>
  </Table></DashboardTableShell>;
}
