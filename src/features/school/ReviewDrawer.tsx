"use client";

import { LoaderCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { useAction } from "@/components/action-form";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useRouter } from "@/i18n/navigation";
import { fromSelectValue, inputClass, toSelectValue } from "./controls";
import { DashboardTableShell } from "./dashboard-page";
import { getReviewDrawerData, saveSessionReviewsAction, type ReviewRecord } from "./review-actions";

export function ReviewDrawer({ sessionId }: { sessionId: string }) {
  const t = useTranslations("school.reviews");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<ReviewRecord[]>([]);
  const [error, setError] = useState(false);
  const [loading, startLoad] = useTransition();

  const load = () => {
    setOpen(true);
    startLoad(async () => {
      try {
        const data = await getReviewDrawerData(sessionId);
        setRows(data.records);
      } catch {
        setError(true);
      }
    });
  };

  const set = <K extends keyof ReviewRecord>(index: number, key: K, value: ReviewRecord[K]) => {
    setRows((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, [key]: value } : row));
  };

  const { run: saveRun, pending } = useAction(
    (nextRows: ReviewRecord[]) => saveSessionReviewsAction(sessionId, nextRows),
    {
      successMessage: t("saved"),
      errorMessage: { default: t("failed") },
      onSuccess: () => {
        setOpen(false);
        router.refresh();
      },
    },
  );

  return (
    <>
      <Button size="sm" variant="secondary" disabled={loading} onClick={load}>{t("button")}</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85dvh] max-w-5xl overflow-y-auto">
          <DialogHeader><DialogTitle>{t("title")}</DialogTitle></DialogHeader>
          <DashboardTableShell>
            <Table className="w-full min-w-[850px] text-left text-xs">
              <TableHeader>
                <TableRow>
                  {["student", "entry", "exit", "focus", "participation", "mastery", "comment"].map((key) => (
                    <TableHead key={key} className="p-2">{t(key)}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row, index) => (
                  <TableRow key={row.studentId}>
                    <TableCell className="p-2 font-medium">{row.studentName}</TableCell>
                    <TableCell className="p-2"><Score value={row.entryScore} set={(value) => set(index, "entryScore", value)} /></TableCell>
                    <TableCell className="p-2"><Score value={row.exitScore} set={(value) => set(index, "exitScore", value)} /></TableCell>
                    {(["focus", "participation", "mastery"] as const).map((key) => (
                      <TableCell key={key} className="p-2">
                        <Select
                          value={toSelectValue(String(row[key] ?? ""))}
                          onValueChange={(value) => {
                            const raw = fromSelectValue(value);
                            set(index, key, raw ? Number(raw) : null);
                          }}
                        >
                          <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value={toSelectValue("")}>—</SelectItem>
                            {[1, 2, 3, 4, 5].map((value) => <SelectItem key={value} value={String(value)}>{value}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </TableCell>
                    ))}
                    <TableCell className="p-2">
                      <Input value={row.comment} onChange={(event) => set(index, "comment", event.target.value)} className={inputClass} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </DashboardTableShell>
          {error && <p className="text-xs text-rose">{t("failed")}</p>}
          <DialogFooter>
            <Button size="sm" variant="secondary" onClick={() => setOpen(false)}>{t("cancel")}</Button>
            <Button size="sm" disabled={pending} onClick={() => saveRun(rows)}>
              {pending && <LoaderCircle size={15} className="animate-spin" />}{t("save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function Score({ value, set }: { value: number | null; set: (value: number | null) => void }) {
  return (
    <Input
      type="number"
      min={0}
      max={100}
      step={0.5}
      value={value ?? ""}
      onChange={(event) => set(event.target.value ? Number(event.target.value) : null)}
      className={`${inputClass} w-20`}
    />
  );
}
