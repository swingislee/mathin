import { setRequestLocale } from "next-intl/server";
import { getMyPerms, requireAnyPerm } from "@/lib/auth";
import { Link } from "@/i18n/navigation";
import { DashboardPage } from "@/features/school/dashboard-page";
import { HistoryWorkflowReview } from "@/features/school/HistoryWorkflowReview";
import { loadHistoryWorkflowReview } from "@/features/school/history-workflow-review";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export default async function ReviewPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [{ locale }, query] = await Promise.all([params, searchParams]); setRequestLocale(locale);
  const user = await requireAnyPerm(locale, ["student.view.all"]), perms = await getMyPerms(user.id);
  const en = locale.startsWith("en"), q = typeof query.q === "string" ? query.q.slice(0, 200) : "";
  const page = Math.max(1, Math.min(100000, Number(query.page) || 1));
  const status = query.status === "continue" || query.status === "archive" ? query.status : "pending";
  const data = await loadHistoryWorkflowReview(q, Math.floor(page), status);
  const href = (next: number, state = status) => `/dashboard/students/review?${new URLSearchParams({ q, page: String(next), status: state })}`;
  return <DashboardPage title={en ? "Historical records" : "历史资料"} summary={<p className="text-sm text-muted">{en ? `${data.pendingCount} saved items are provisionally historical based on import evidence. Check or correct these when working with the student.` : `已保存的资料中，有 ${data.pendingCount} 项按导入线索暂判为历史。老师实际办理到该学生时，可核对或修改；可以直接继续日常工作。`}</p>}>
    <div className="mb-4 flex flex-wrap gap-4"><Link href="/dashboard/students">{en ? "Students" : "返回学员"}</Link>{(["pending", "continue", "archive"] as const).map((value, index) => <Link key={value} href={href(1, value)} aria-current={status === value ? "page" : undefined}>{(en ? ["Inferred historical", "Restored", "Historical confirmed"] : ["暂按历史 · 待核对", "已恢复办理", "已核对历史"])[index]}</Link>)}</div>
    <form className="mb-4 flex gap-2"><input type="hidden" name="status" value={status} /><Input name="q" defaultValue={q} aria-label={en ? "Search name" : "搜索姓名"} /><Button type="submit">{en ? "Search" : "搜索"}</Button></form>
    <HistoryWorkflowReview rows={data.rows} canEdit={perms.has("student.edit")} locale={locale} />
    <div className="mt-4 flex gap-4 text-sm"><span>{data.count} {en ? "items" : "项"} · {page} / {Math.max(1, Math.ceil(data.count / 50))}</span>{page > 1 ? <Link href={href(page - 1)}>{en ? "Previous" : "上一页"}</Link> : null}{page * 50 < data.count ? <Link href={href(page + 1)}>{en ? "Next" : "下一页"}</Link> : null}</div>
  </DashboardPage>;
}
