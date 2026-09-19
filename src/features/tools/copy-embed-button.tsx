"use client";

import { Check, Code } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { ToolToolbarButton } from "./ToolToolbarButton";

export function CopyEmbedButton({ toolId, locale }: { toolId: string; locale: string }) {
  const t = useTranslations("tools");
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    const code = `<iframe src="${window.location.origin}/embed/${toolId}?locale=${locale}" width="100%" height="620" style="border:none;"></iframe>`;
    let ok = false;
    // navigator.clipboard 仅在 HTTPS/localhost 可用；局域网 HTTP 访问走 execCommand 降级
    try {
      await navigator.clipboard.writeText(code);
      ok = true;
    } catch {
      try {
        const ta = document.createElement("textarea");
        ta.value = code;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        ok = document.execCommand("copy");
        ta.remove();
      } catch {
        ok = false;
      }
    }
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    }
  };
  return <ToolToolbarButton onClick={copy} icon={copied ? Check : Code} label={copied ? t("copied") : t("copyEmbed")} />;
}
