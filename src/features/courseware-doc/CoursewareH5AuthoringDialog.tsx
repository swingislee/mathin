"use client";

import { FileCode2, LoaderCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { MICROCOURSE_H5_CSP } from "./h5-shim";
import { CoursewareEditorToolbarButton } from "./CoursewareEditorWorkbench";

export const DEFAULT_COURSEWARE_H5 = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>课堂互动</title>
  <style>
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; font-family: system-ui; background: #fffaf1; color: #2d2a26; }
    button { padding: .75rem 1.25rem; border: 0; border-radius: 999px; background: #dd765c; color: white; font: inherit; }
  </style>
</head>
<body>
  <main><h1>课堂互动</h1><button id="start">开始</button></main>
  <script>document.querySelector('#start').addEventListener('click', () => alert('开始探索！'))</script>
</body>
</html>`;

function previewDocument(html: string) {
  const csp = `<meta http-equiv="Content-Security-Policy" content="${MICROCOURSE_H5_CSP}">`;
  return /<head[\s>]/i.test(html)
    ? html.replace(/<head([^>]*)>/i, `<head$1>${csp}`)
    : `${csp}${html}`;
}

export interface CoursewareH5SubmitResult<T> {
  ok: boolean;
  data?: T;
  code?: string;
}

export function CoursewareH5AuthoringDialog<T>({
  disabled = false,
  iconOnly = false,
  existing = false,
  loadHtml,
  submit,
  onSaved,
}: {
  disabled?: boolean;
  iconOnly?: boolean;
  existing?: boolean;
  loadHtml?: () => Promise<string>;
  submit: (html: string) => Promise<CoursewareH5SubmitResult<T>>;
  onSaved: (value: T) => void;
}) {
  const t = useTranslations("teacherMicrocourses");
  const [open, setOpen] = useState(false);
  const [html, setHtml] = useState(DEFAULT_COURSEWARE_H5);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!open || !existing || !loadHtml) return;
    let active = true;
    loadHtml().then((value) => {
      if (active) setHtml(value);
    }).catch(() => {
      if (active) setMessage(t("h5LoadFailed"));
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [existing, loadHtml, open, t]);

  const changeOpen = (nextOpen: boolean) => {
    setOpen(nextOpen);
    setMessage("");
    setLoading(Boolean(nextOpen && existing && loadHtml));
  };
  const save = () => startTransition(async () => {
    const result = await submit(html);
    if (!result.ok || result.data === undefined) {
      setMessage(t("actionFailed", { code: result.code ?? "UNKNOWN" }));
      return;
    }
    onSaved(result.data);
    setOpen(false);
  });
  const bytes = new TextEncoder().encode(html.replace(/\r\n?/g, "\n")).byteLength;

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogTrigger asChild>{iconOnly
        ? <CoursewareEditorToolbarButton aria-label={existing ? t("editH5Component") : t("componentH5")} title={existing ? t("editH5Component") : t("componentH5")} disabled={disabled}><FileCode2 className="size-4" /></CoursewareEditorToolbarButton>
        : <Button type="button" size="sm" variant="secondary" className={existing ? "w-full" : undefined} aria-label={existing ? t("editH5Component") : t("componentH5")} title={existing ? t("editH5Component") : t("componentH5")} disabled={disabled}><FileCode2 className="size-4" />{existing ? t("editH5Component") : t("componentH5")}</Button>}
      </DialogTrigger>
      <DialogContent className="max-w-5xl">
        <DialogHeader><DialogTitle>{existing ? t("editH5Component") : t("insertH5ComponentTitle")}</DialogTitle><DialogDescription>{t("h5SecurityHint")}</DialogDescription></DialogHeader>
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <Label className="grid gap-1"><span>{t("html")}</span><Textarea value={html} onChange={(event) => setHtml(event.target.value)} rows={20} className="font-mono text-xs" disabled={loading} /></Label>
          <div className="overflow-hidden rounded-lg border border-line bg-white"><iframe title={t("h5LivePreview")} sandbox="allow-scripts" srcDoc={previewDocument(html)} className="aspect-[4/3] w-full border-0" /></div>
        </div>
        <p className="text-xs text-muted">{bytes} / 5 MiB</p>
        {message && <p role="alert" className="text-sm text-rose">{message}</p>}
        <DialogFooter><Button type="button" variant="secondary" onClick={() => setOpen(false)}>{t("cancel")}</Button><Button type="button" disabled={pending || loading || !html.trim() || bytes > 5_242_880} onClick={save}>{pending && <LoaderCircle className="size-4 animate-spin" />}{existing ? t("saveNow") : t("insertComponent")}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
