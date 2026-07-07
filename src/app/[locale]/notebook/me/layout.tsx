import { setRequestLocale } from "next-intl/server";
import { requireUser } from "@/lib/auth";
import { listNoteMetas } from "@/features/notebook/actions";
import { WorkspaceFrame } from "@/features/notebook/workspace/WorkspaceFrame";

export default async function NotebookWorkspaceLayout({ children, params }: { children: React.ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const user = await requireUser(locale);
  const notes = await listNoteMetas();
  return <WorkspaceFrame userId={user.id} initialNotes={notes}>{children}</WorkspaceFrame>;
}
