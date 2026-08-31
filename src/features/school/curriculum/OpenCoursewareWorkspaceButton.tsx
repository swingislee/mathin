"use client";

import { ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useRouter } from "@/i18n/navigation";

/**
 * The preview changes pages with history.replaceState to avoid refetching the
 * surrounding course page. Read that live page number at click time so the
 * unified workspace opens the exact page the researcher was inspecting.
 */
export function OpenCoursewareWorkspaceButton({ href, label }: { href: string; label: string }) {
  const router = useRouter();
  return (
    <Button
      type="button"
      size="sm"
      variant="secondary"
      onClick={() => {
        const target = new URL(href, window.location.origin);
        target.searchParams.set("page", new URLSearchParams(window.location.search).get("page") ?? "1");
        router.push(`${target.pathname}${target.search}`);
      }}
    >
      {label}
      <ExternalLink className="size-4" />
    </Button>
  );
}
