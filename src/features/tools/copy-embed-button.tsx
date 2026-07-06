"use client";

import { Check, Code } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

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
  return (
    <button
      type="button"
      onClick={copy}
      className="inline-flex items-center gap-1.5 rounded-full border border-crater px-3 py-1.5 text-xs transition duration-200 hover:bg-moon/50"
    >
      {copied ? <Check size={13} /> : <Code size={13} />}
      {copied ? t("copied") : t("copyEmbed")}
    </button>
  );
}
