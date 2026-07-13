"use client";

import { Input } from "@/components/ui/input";

import { useEffect, useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Check, Copy, LoaderCircle, UserPlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import {
  listWhiteboardMembers,
  removeWhiteboardMember,
  setWhiteboardInvite,
  setWhiteboardMemberEdit,
} from "./actions";
import type { WhiteboardMemberInfo } from "./types";

export function InvitePanel({ boardId, ownerId, initialInviteCode }: {
  boardId: string;
  ownerId: string;
  initialInviteCode: string | null;
}) {
  const t = useTranslations("whiteboard.board.collab");
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [inviteCode, setInviteCode] = useState(initialInviteCode);
  const [members, setMembers] = useState<WhiteboardMemberInfo[] | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();

  const refreshMembers = () => {
    listWhiteboardMembers(boardId).then(setMembers).catch(() => setMembers([]));
  };

  useEffect(() => {
    if (open) refreshMembers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, boardId]);

  const inviteLink = inviteCode
    ? `${typeof window === "undefined" ? "" : window.location.origin}/${locale}/whiteboard/${boardId}?invite=${inviteCode}`
    : null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={t("invite")}
          title={t("invite")}
          className="rounded-full p-2 text-muted transition-colors hover:bg-moon/30 hover:text-ink"
        >
          <UserPlus size={17} />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-4">
        <h3 className="text-sm font-medium">{t("invite")}</h3>

        {inviteLink ? (
          <div className="mt-3 space-y-2">
            <div className="flex items-center gap-1.5">
              <Input
                readOnly
                value={inviteLink}
                aria-label={t("copyLink")}
                className="min-w-0 flex-1 rounded-full border border-line bg-transparent px-3 py-1.5 text-xs text-muted outline-none"
                onFocus={(event) => event.target.select()}
              />
              <button
                type="button"
                aria-label={t("copyLink")}
                title={t("copyLink")}
                className="rounded-full p-2 text-muted transition-colors hover:bg-moon/30 hover:text-ink"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(inviteLink);
                  } catch {
                    // 非安全上下文没有 clipboard API：退化为选中让用户手动复制
                    const input = document.querySelector<HTMLInputElement>("input[readonly]");
                    input?.select();
                    document.execCommand("copy");
                  }
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }}
              >
                {copied ? <Check size={14} className="text-leaf-deep" /> : <Copy size={14} />}
              </button>
            </div>
            <Button
              variant="ghost"
              size="sm"
              disabled={pending}
              onClick={() => startTransition(async () => {
                await setWhiteboardInvite(boardId, false);
                setInviteCode(null);
              })}
            >
              {t("disableInvite")}
            </Button>
          </div>
        ) : (
          <Button
            variant="secondary"
            size="sm"
            className="mt-3"
            disabled={pending}
            onClick={() => startTransition(async () => {
              setInviteCode(await setWhiteboardInvite(boardId, true));
            })}
          >
            {pending ? <LoaderCircle size={14} className="animate-spin motion-reduce:animate-none" /> : t("enableInvite")}
          </Button>
        )}

        <h3 className="mt-5 text-sm font-medium">{t("members")}</h3>
        {members === null ? (
          <LoaderCircle size={15} className="mt-3 animate-spin text-muted motion-reduce:animate-none" />
        ) : (
          <ul className="mt-2 space-y-1">
            {members.map((member) => {
              const isOwnerRow = member.userId === ownerId;
              return (
                <li key={member.userId} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm">
                  <span className="min-w-0 flex-1 truncate">{member.displayName || t("anonymous")}</span>
                  {isOwnerRow ? (
                    <span className="shrink-0 text-xs text-muted">{t("owner")}</span>
                  ) : (
                    <>
                      <button
                        type="button"
                        title={member.canEdit ? t("makeViewOnly") : t("makeEditor")}
                        className={cn(
                          "shrink-0 rounded-full px-2 py-0.5 text-xs transition-colors",
                          member.canEdit ? "bg-leaf/30 text-ink hover:bg-leaf/50" : "bg-line/60 text-muted hover:bg-line",
                        )}
                        onClick={() => {
                          void setWhiteboardMemberEdit(boardId, member.userId, !member.canEdit).then(refreshMembers);
                        }}
                      >
                        {member.canEdit ? t("canEdit") : t("viewOnly")}
                      </button>
                      <button
                        type="button"
                        aria-label={t("remove")}
                        title={t("remove")}
                        className="shrink-0 rounded-full p-1 text-muted transition-colors hover:bg-rose/10 hover:text-rose"
                        onClick={() => {
                          void removeWhiteboardMember(boardId, member.userId).then(refreshMembers);
                        }}
                      >
                        <X size={13} />
                      </button>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
