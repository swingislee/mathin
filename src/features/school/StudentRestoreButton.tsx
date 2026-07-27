"use client";

import { useTranslations } from "next-intl";
import { useAction } from "@/components/action-form";
import { useRouter } from "@/i18n/navigation";
import { restoreStudentAction } from "./actions/students";

/**
 * 回收站列表里的行内恢复。与详情页的恢复不是同一个入口——列表要的是就地操作、
 * 不跳转，详情页那条住在 StudentActionsMenu 的危险区里。
 *
 * 原本和详情页那组生命周期按钮同住一个文件；那组按钮在 doc 23 §11 拆成
 * "主操作 + 溢出菜单"后被删除，这个仍在用的小组件搬来自己的文件。
 */
export function StudentRestoreButton({ studentId }: { studentId: string }) {
  const t = useTranslations("school.students");
  const router = useRouter();
  const { run, pending } = useAction(restoreStudentAction, {
    successMessage: t("restoreSuccess"),
    errorMessage: { default: t("actionFailed") },
    onSuccess: () => router.refresh(),
  });
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => run(studentId)}
      className="text-xs text-crater underline underline-offset-2 disabled:opacity-40"
    >
      {pending ? t("restoring") : t("restore")}
    </button>
  );
}
