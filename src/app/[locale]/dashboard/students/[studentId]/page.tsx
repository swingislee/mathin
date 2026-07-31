import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { buttonVariants } from "@/components/ui/button";
import { getStudentAccount, getStudentOrders } from "@/features/school/finance";
import {
  DashboardAside,
  DashboardCommandActions,
  DashboardCommandPanel,
  DashboardCommandState,
  DashboardCommandTabs,
  DashboardContentGrid,
  DashboardMainColumn,
  DashboardPage,
} from "@/features/school/dashboard-page";
import { listStaffMembers } from "@/features/school/staff";
import { StudentActionsMenu } from "@/features/school/StudentActionsMenu";
import {
  StudentAccountStatus,
  StudentCurrentClasses,
  StudentNextFollowUp,
  StudentSummary,
} from "@/features/school/StudentAsidePanels";
import { StudentFollowUpsTab, StudentLearningTab, StudentVideosTab } from "@/features/school/StudentDetailTabs";
import { StudentFinancePanel } from "@/features/school/StudentFinancePanel";
import { StudentProfileEditor } from "@/features/school/StudentProfileEditor";
import { GuardianInvitePanel } from "@/features/school/GuardianInvitePanel";
import { GuardianScopePanel } from "@/features/school/GuardianScopePanel";
import { StudentMergePanel } from "@/features/school/StudentMergePanel";
import { parseReturnTo, preserveReturnTo } from "@/features/school/object-workspace";
import { getStudentDetail, getStudentLearning } from "@/features/school/students";
import { listSchoolTerms } from "@/features/school/courses";
import { listLearningResultsForStaff } from "@/features/school/learning-results";
import { Link } from "@/i18n/navigation";
import { getActiveEnvironment, getMyPerms, requireAnyPerm } from "@/lib/auth";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const BASE_TABS = ["overview", "followups", "learning", "videos", "guardians"] as const;
type StudentTab = (typeof BASE_TABS)[number] | "finance";

/**
 * 学生 360° 档案（doc 23 §11）。
 *
 * 重建前是一条超长纵向主栏（档案 → 跟进 → 一张塞了七块内容的"学习"大卡 → 财务），
 * 加上一个装着三个操作面板的侧栏。侧栏被当作"表单塞不下就往这儿放"，于是这一页
 * 没有任何位置回答"这个学生现在什么情况"；而真正高频的动作——记一条跟进——
 * 和"删除档案"在命令面板里是同级按钮。
 *
 * 现在：正文按事情分 Tab，侧栏是跨 Tab 不变的稳定摘要，命令面板只有一个主操作
 * 加一个溢出菜单。
 */
export default async function StudentDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; studentId: string }>;
  searchParams: Promise<{ tab?: string; returnTo?: string | string[] }>;
}) {
  const [{ locale, studentId }, rawSearchParams] = await Promise.all([params, searchParams]);
  setRequestLocale(locale);
  const user = await requireAnyPerm(locale, ["student.view.all", "student.view.assigned"]);
  if (!UUID_PATTERN.test(studentId)) notFound();

  const [t, student, learning, perms, environment] = await Promise.all([
    getTranslations("school.students"),
    getStudentDetail(studentId),
    getStudentLearning(studentId),
    getMyPerms(user.id),
    // requireAnyPerm 已经过了 staff 环境闸门，这里读的是同一次 cache 结果，不额外查库。
    getActiveEnvironment(user.id),
  ]);
  if (!student) notFound();

  const canEdit = perms.has("student.edit");
  const canAssign = perms.has("student.assign");
  const showFinance = perms.has("finance.order.view");

  const assignees = canAssign
    ? (await listStaffMembers()).filter((member) => member.canFollowUp).map((member) => ({ userId: member.userId, displayName: member.displayName }))
    : [];

  const tabs: StudentTab[] = showFinance ? [...BASE_TABS, "finance"] : [...BASE_TABS];
  const requested = rawSearchParams.tab as StudentTab | undefined;
  const activeTab: StudentTab = requested && tabs.includes(requested) ? requested : "overview";

  const canWriteStageReports = perms.has("review.write");
  const [stageReports, schoolTerms] = activeTab === "learning"
    ? await Promise.all([
        listLearningResultsForStaff({ studentId, kind: "stage_report" }),
        canWriteStageReports ? listSchoolTerms() : Promise.resolve([]),
      ])
    : [[], []];

  const [orders, account] = showFinance && activeTab === "finance"
    ? await Promise.all([getStudentOrders(studentId), getStudentAccount(studentId)])
    : [[], { studentId, balance: 0, ledger: [], lessonBalance: 0, lessonLedger: [] }];

  // doc24 §6：学生详情有四个真实入口——学生列表、跟进队列、财务订单、班级名单。
  // 只有列表那一条的"回到上一级"和"回到来的地方"是同一个答案，其余三条以前都把学辅
  // 甩回学生列表，再自己找一遍刚才处理到哪一行。
  const returnTo = environment ? parseReturnTo({ returnTo: rawSearchParams.returnTo, environment }) : null;
  const tabHref = (tab: StudentTab) => preserveReturnTo(`/dashboard/students/${studentId}?tab=${tab}`, returnTo);

  return (
    <DashboardPage
      title={student.name}
      backHref={returnTo ?? (student.deletedAt ? "/dashboard/students?tab=recycle" : "/dashboard/students")}
      backLabel={t("back")}
      // §11 强制删除"Header meta 完整状态串"：年级 · 状态 · 跟进状态 · 绑定码全塞在标题下，
      // 既压不住信息量又没有层级。年级和负责人留在这里，其余归 Aside 摘要。
      meta={<span>{student.grade ? t("grade", { grade: student.grade }) : "—"} · {student.assignedName || t("none")}</span>}
      commandPanel={
        <DashboardCommandPanel>
          <DashboardCommandState>
            <DashboardCommandTabs
              items={tabs.map((tab) => ({ value: tab, label: t(`tab_${tab}`), href: tabHref(tab) }))}
              activeValue={activeTab}
              ariaLabel={t("tabsLabel")}
            />
          </DashboardCommandState>
          <DashboardCommandActions>
            {perms.has("followup.write") && !student.deletedAt && (
              <Link href={tabHref("followups")} className={buttonVariants({ size: "sm" })}>{t("logFollowUp")}</Link>
            )}
            <StudentActionsMenu
              studentId={studentId}
              status={student.status}
              assignedTo={student.assignedTo}
              deleted={Boolean(student.deletedAt)}
              phone={student.phone}
              hasAccount={Boolean(student.userId)}
              canEdit={canEdit}
              canAssign={canAssign}
              canDelete={perms.has("student.delete")}
              assignees={assignees}
              ariaLabel={t("moreActions")}
            />
          </DashboardCommandActions>
        </DashboardCommandPanel>
      }
    >
      <DashboardContentGrid>
        <DashboardMainColumn className="flex flex-col gap-6">
          {student.deletedAt && (
            <div className="rounded-xl border border-rose/30 bg-rose/5 p-4 text-sm text-rose">
              {t("deletedBanner", { date: new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(student.deletedAt)) })}
            </div>
          )}

          {activeTab === "overview" && (
            <>
              <StudentProfileEditor student={student} canEdit={canEdit} />
              {/* 合并只在真的查到疑似重复时才渲染（组件自己返回 null），所以它是一个
                  按需出现的档案维护区，而不是一张常驻侧栏的空卡。 */}
              {!student.deletedAt && canEdit && <StudentMergePanel studentId={studentId} name={student.name} phone={student.phone} />}
            </>
          )}

          {activeTab === "followups" && perms.has("followup.view") && (
            <StudentFollowUpsTab student={student} locale={locale} canWrite={perms.has("followup.write") && !student.deletedAt} />
          )}

          {activeTab === "learning" && (
            <StudentLearningTab
              studentId={studentId}
              learning={learning}
              locale={locale}
              stageReports={stageReports}
              terms={schoolTerms}
              canWriteStageReports={canWriteStageReports}
            />
          )}

          {activeTab === "videos" && <StudentVideosTab videos={learning.videos} />}

          {activeTab === "guardians" && !student.deletedAt && canEdit && (
            <>
              <GuardianInvitePanel studentId={studentId} />
              <GuardianScopePanel studentId={studentId} />
            </>
          )}

          {activeTab === "finance" && showFinance && (
            <StudentFinancePanel
              studentId={studentId}
              orders={orders}
              account={account}
              perms={{
                canCreateOrder: perms.has("finance.order.create"),
                canRecordPayment: perms.has("finance.payment.record"),
                canRequestRefund: perms.has("finance.refund.request"),
                canApproveRefund: perms.has("finance.refund.approve"),
                canGrantScholarship: perms.has("finance.scholarship.grant"),
                canAdjustAccount: perms.has("finance.account.adjust"),
              }}
            />
          )}
        </DashboardMainColumn>

        <DashboardAside>
          <StudentSummary student={student} ownerName={student.assignedName || null} />
          <StudentNextFollowUp student={student} locale={locale} />
          <StudentCurrentClasses enrollments={learning.enrollments} returnTo={tabHref(activeTab)} />
          <StudentAccountStatus student={student} learning={learning} />
        </DashboardAside>
      </DashboardContentGrid>
    </DashboardPage>
  );
}
