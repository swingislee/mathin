"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Copy, ExternalLink, Laptop, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { classroomDisplayHref } from "./preparation-contract";

/** 候课和舞台共用入口，另一台设备以同一教师账号进入当前试讲。 */
export function RehearsalDevices() {
  const t = useTranslations("classroom.preparation");
  const [href, setHref] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  return <>
    <Button type="button" size="sm" variant="secondary" onClick={() => {
      const url = new URL(window.location.href);
      url.searchParams.delete("role");
      url.searchParams.set("entry", "prep");
      if (url.searchParams.get("rehearsal") === "1") url.searchParams.set("mode", "host");
      setCopied(false);
      setHref(url.toString());
    }}><Laptop size={15} />{t("connectDevices")}</Button>
    <Dialog open={href !== null} onOpenChange={(open) => { if (!open) setHref(null); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("connectDevices")}</DialogTitle>
          <DialogDescription>{t("connectDevicesHint")}</DialogDescription>
        </DialogHeader>
        <div className="flex gap-2">
          <Input data-rehearsal-link aria-label={t("rehearsalLink")} readOnly value={href ?? ""} onFocus={(event) => event.currentTarget.select()} />
          <Button variant="secondary" onClick={async () => {
            try { await navigator.clipboard.writeText(href ?? ""); setCopied(true); }
            catch { document.querySelector<HTMLInputElement>("[data-rehearsal-link]")?.select(); }
          }} aria-label={t("copyLink")} title={t("copyLink")}>{copied ? <Check size={16} /> : <Copy size={16} />}</Button>
        </div>
        <p className="text-xs leading-5 text-muted">{t("copyLinkHint")}</p>
        <Button variant="secondary" onClick={() => window.open(classroomDisplayHref(window.location.pathname, window.location.search), "_blank", "noopener")}>
          <ExternalLink size={15} />{t("openRehearsalDisplay")}
        </Button>
      </DialogContent>
    </Dialog>
  </>;
}
