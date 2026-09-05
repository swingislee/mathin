"use client";

import { FilterSearchInput } from "../FilterBar";

import { useState } from "react";
import { BookPlus, Check, GitBranch, GitCommitHorizontal, Save } from "lucide-react";
import { useTranslations } from "next-intl";
import { useAction, type ActionErrorMessages } from "@/components/action-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { DashboardSection, DashboardTableShell } from "@/features/school/dashboard-page";
import { useRouter } from "@/i18n/navigation";
import {
  addTeacherMicrocourseCatalogLectureAction,
  commitTeacherMicrocourseMaintenanceBranchAction,
  createTeacherMicrocourseMaintenanceBranchAction,
  selectTeacherMicrocourseDefaultCommitAction,
  setTeacherMicrocourseBranchMembersAction,
} from "../actions/teacher-microcourse-maintenance";
import type { StaffOption } from "../classes";
import type { TeacherMicrocourseBranchMembers, TeacherMicrocourseCatalogCourse } from "./teacher-microcourse-maintenance";

function useMaintenanceErrors() {
  const t = useTranslations("school.teacherMicrocourseBrowser");
  return {
    ALL_LECTURES_REQUIRE_PUBLISHED_RELEASES: t("allLecturesRequireRelease"),
    PUBLISHED_COMMIT_REQUIRED: t("publishedCommitRequired"),
    LECTURE_LIMIT: t("lectureLimit"),
    INVALID_COLLABORATORS: t("invalidCollaborators"),
    MAINTAINER_HAS_BRANCH: t("maintainerHasBranch"),
    FORBIDDEN: t("forbidden"),
    default: t("actionFailed"),
  } satisfies ActionErrorMessages;
}

export function TeacherMicrocourseAddLectureDialog({ familyId, course }: { familyId: string; course: TeacherMicrocourseCatalogCourse }) {
  const t = useTranslations("school.teacherMicrocourseBrowser");
  const router = useRouter();
  const errors = useMaintenanceErrors();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [objectives, setObjectives] = useState("");
  const add = useAction(addTeacherMicrocourseCatalogLectureAction, {
    successMessage: t("lectureAdded"), errorMessage: errors,
    onSuccess: () => { setOpen(false); setName(""); setObjectives(""); router.refresh(); },
  });
  if (!course.capabilities.canAddLecture) return null;
  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogTrigger asChild><Button size="sm"><BookPlus className="h-4 w-4" />{t("addLecture")}</Button></DialogTrigger>
    <DialogContent><DialogHeader><DialogTitle>{t("addLecture")}</DialogTitle><DialogDescription>{t("addLectureHint")}</DialogDescription></DialogHeader><div className="space-y-4"><div><Label htmlFor="microcourse-lecture-name">{t("lectureName")}</Label><Input id="microcourse-lecture-name" value={name} maxLength={120} onChange={(event) => setName(event.target.value)} /></div><div><Label htmlFor="microcourse-lecture-objectives">{t("lectureObjectives")}</Label><Textarea id="microcourse-lecture-objectives" value={objectives} maxLength={1000} onChange={(event) => setObjectives(event.target.value)} /></div></div><DialogFooter><Button variant="secondary" disabled={add.pending} onClick={() => setOpen(false)}>{t("cancel")}</Button><Button disabled={add.pending || !name.trim()} onClick={() => add.run({ courseFamilyId: familyId, courseId: course.course.id, name, objectives })}><Save className="h-4 w-4" />{t("save")}</Button></DialogFooter></DialogContent>
  </Dialog>;
}

export function TeacherMicrocourseMaintenanceWorkspace({ familyId, course, memberManagement, staffOptions, section = "all" }: { familyId: string; course: TeacherMicrocourseCatalogCourse; memberManagement: TeacherMicrocourseBranchMembers; staffOptions: StaffOption[]; section?: "branches" | "history" | "all" }) {
  const t = useTranslations("school.teacherMicrocourseBrowser");
  const router = useRouter();
  const errors = useMaintenanceErrors();
  const [branchOpen, setBranchOpen] = useState(false);
  const [branchName, setBranchName] = useState("");
  const [commitBranchId, setCommitBranchId] = useState<string | null>(null);
  const [commitMessage, setCommitMessage] = useState("");
  const [historyQuery, setHistoryQuery] = useState("");
  const [memberBranchId, setMemberBranchId] = useState<string | null>(null);
  const [memberOwnerId, setMemberOwnerId] = useState("");
  const [memberCollaboratorIds, setMemberCollaboratorIds] = useState<Set<string>>(() => new Set());
  const createBranch = useAction(createTeacherMicrocourseMaintenanceBranchAction, {
    successMessage: t("branchReady"), errorMessage: errors,
    onSuccess: () => { setBranchOpen(false); setBranchName(""); router.refresh(); },
  });
  const commit = useAction(commitTeacherMicrocourseMaintenanceBranchAction, {
    successMessage: t("commitCreated"), errorMessage: errors,
    onSuccess: () => { setCommitBranchId(null); setCommitMessage(""); router.refresh(); },
  });
  const selectDefault = useAction(selectTeacherMicrocourseDefaultCommitAction, {
    successMessage: t("defaultChanged"), errorMessage: errors,
    onSuccess: () => router.refresh(),
  });
  const saveMembers = useAction(setTeacherMicrocourseBranchMembersAction, {
    successMessage: t("branchMembersSaved"), errorMessage: errors,
    onSuccess: () => { setMemberBranchId(null); router.refresh(); },
  });
  const editMembers = (branchId: string) => {
    const members = memberManagement.branches.find((item) => item.branchId === branchId);
    if (!members) return;
    setMemberBranchId(branchId);
    setMemberOwnerId(members.ownerId);
    setMemberCollaboratorIds(new Set(members.collaboratorIds));
  };
  const filteredCommits = course.commits.filter((item) => {
    const query = historyQuery.trim().toLocaleLowerCase();
    return !query || `${item.message} ${item.branchName} ${item.createdByName} ${item.status}`.toLocaleLowerCase().includes(query);
  });

  return <div className="space-y-5">
     {section !== "history" && <DashboardSection title={t("maintenanceDirections")} description={t("maintenanceDirectionsHint")} actions={course.capabilities.canCreateBranch ? <Dialog open={branchOpen} onOpenChange={setBranchOpen}><DialogTrigger asChild><Button size="sm"><GitBranch className="h-4 w-4" />{t("createMaintenanceBranch")}</Button></DialogTrigger><DialogContent><DialogHeader><DialogTitle>{t("createMaintenanceBranch")}</DialogTitle><DialogDescription>{t("branchFromDefaultHint")}</DialogDescription></DialogHeader><div><Label htmlFor="branch-name">{t("branchName")}</Label><Input id="branch-name" value={branchName} maxLength={120} onChange={(event) => setBranchName(event.target.value)} /></div><DialogFooter><Button variant="secondary" onClick={() => setBranchOpen(false)}>{t("cancel")}</Button><Button disabled={createBranch.pending || !branchName.trim()} onClick={() => createBranch.run({ courseFamilyId: familyId, courseId: course.course.id, name: branchName })}><GitBranch className="h-4 w-4" />{t("create")}</Button></DialogFooter></DialogContent></Dialog> : undefined}><DashboardTableShell><Table><TableHeader><TableRow><TableHead>{t("maintenanceDirection")}</TableHead><TableHead>{t("maintainer")}</TableHead><TableHead>{t("proposalCountLabel")}</TableHead><TableHead>{t("headCommit")}</TableHead><TableHead className="text-right">{t("actions")}</TableHead></TableRow></TableHeader><TableBody>{course.branches.map((branch) => <TableRow key={branch.id}><TableCell><div className="font-medium">{branch.name}</div>{branch.basedOnCommitId && <div className="text-xs text-muted">{t("basedOnCommit")}</div>}</TableCell><TableCell>{branch.ownerName}</TableCell><TableCell>{branch.proposalCount}</TableCell><TableCell>{branch.headCommitId ? <Badge variant="secondary">{t("committed")}</Badge> : <Badge variant="outline">{t("draftOnly")}</Badge>}</TableCell><TableCell><div className="flex justify-end gap-2">{memberManagement.canManage && <Button variant="ghost" size="sm" onClick={() => editMembers(branch.id)}>{t("manageMembers")}</Button>}{course.capabilities.canCommit && branch.canManage && <Button variant="secondary" size="sm" onClick={() => setCommitBranchId(branch.id)}><GitCommitHorizontal className="h-4 w-4" />{t("commitVersion")}</Button>}</div></TableCell></TableRow>)}{course.branches.length === 0 && <TableRow><TableCell colSpan={5} className="py-10 text-center text-muted">{t("noMaintenanceDirections")}</TableCell></TableRow>}</TableBody></Table></DashboardTableShell></DashboardSection>}

     {section !== "branches" && <DashboardSection title={t("maintenanceHistory")} description={t("historyLinearHint")} actions={<FilterSearchInput value={historyQuery} onChange={(event) => setHistoryQuery(event.target.value)} placeholder={t("searchHistory")} className="w-72" />}><DashboardTableShell><Table><TableHeader><TableRow><TableHead>{t("version")}</TableHead><TableHead>{t("maintenanceDirection")}</TableHead><TableHead>{t("commitMessage")}</TableHead><TableHead>{t("committedBy")}</TableHead><TableHead>{t("status")}</TableHead><TableHead className="text-right">{t("actions")}</TableHead></TableRow></TableHeader><TableBody>{filteredCommits.map((item) => <TableRow key={item.id}><TableCell className="font-medium">#{item.commitNo}</TableCell><TableCell>{item.branchName}</TableCell><TableCell className="max-w-80 whitespace-normal">{item.message}</TableCell><TableCell>{item.createdByName}</TableCell><TableCell>{item.isDefault ? <Badge variant="secondary"><Check className="h-3.5 w-3.5" />{t("currentDefault")}</Badge> : <Badge variant="outline">{t("published")}</Badge>}</TableCell><TableCell className="text-right">{course.capabilities.canSelectDefault && !item.isDefault && <Button variant="secondary" size="sm" disabled={selectDefault.pending} onClick={() => selectDefault.run({ courseFamilyId: familyId, courseId: course.course.id, commitId: item.id, reason: t("manualDefaultReason") })}>{t("setAsDefault")}</Button>}</TableCell></TableRow>)}{filteredCommits.length === 0 && <TableRow><TableCell colSpan={6} className="py-10 text-center text-muted">{t("noCommits")}</TableCell></TableRow>}</TableBody></Table></DashboardTableShell></DashboardSection>}

    <Dialog open={commitBranchId !== null} onOpenChange={(open) => { if (!open) setCommitBranchId(null); }}><DialogContent><DialogHeader><DialogTitle>{t("commitVersion")}</DialogTitle><DialogDescription>{t("commitPublishedOnlyHint")}</DialogDescription></DialogHeader><div><Label htmlFor="commit-message">{t("commitMessage")}</Label><Textarea id="commit-message" value={commitMessage} maxLength={500} onChange={(event) => setCommitMessage(event.target.value)} /></div><DialogFooter><Button variant="secondary" disabled={commit.pending} onClick={() => setCommitBranchId(null)}>{t("cancel")}</Button><Button disabled={commit.pending || !commitMessage.trim() || !commitBranchId} onClick={() => commitBranchId && commit.run({ courseFamilyId: familyId, courseId: course.course.id, branchId: commitBranchId, message: commitMessage })}><GitCommitHorizontal className="h-4 w-4" />{t("commitVersion")}</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={memberBranchId !== null} onOpenChange={(open) => { if (!open) setMemberBranchId(null); }}><DialogContent><DialogHeader><DialogTitle>{t("manageMembers")}</DialogTitle><DialogDescription>{t("manageMembersHint")}</DialogDescription></DialogHeader><div className="space-y-4"><div><Label>{t("maintainer")}</Label><Select value={memberOwnerId} onValueChange={setMemberOwnerId}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{staffOptions.map((staff) => <SelectItem key={staff.id} value={staff.id}>{staff.name}</SelectItem>)}</SelectContent></Select></div><fieldset className="space-y-2"><legend className="text-sm font-medium">{t("collaborators")}</legend><div className="grid gap-2 @2xl/page:grid-cols-2">{staffOptions.filter((staff) => staff.id !== memberOwnerId).map((staff) => <Label key={staff.id} className="flex items-center gap-2 rounded-lg border border-line px-3 py-2"><Checkbox checked={memberCollaboratorIds.has(staff.id)} onCheckedChange={(checked) => setMemberCollaboratorIds((current) => { const next = new Set(current); if (checked) next.add(staff.id); else next.delete(staff.id); return next; })} />{staff.name}</Label>)}</div></fieldset></div><DialogFooter><Button variant="secondary" onClick={() => setMemberBranchId(null)}>{t("cancel")}</Button><Button disabled={saveMembers.pending || !memberBranchId || !memberOwnerId} onClick={() => memberBranchId && saveMembers.run({ courseFamilyId: familyId, courseId: course.course.id, branchId: memberBranchId, ownerId: memberOwnerId, collaboratorIds: [...memberCollaboratorIds] })}><Save className="h-4 w-4" />{t("save")}</Button></DialogFooter></DialogContent></Dialog>
  </div>;
}
