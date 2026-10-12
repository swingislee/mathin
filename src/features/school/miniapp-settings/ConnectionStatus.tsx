"use client";
import { useEffect, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { inspectExperienceConnection } from "./connection-actions";
export function ConnectionStatus({ id, en }: { id: string; en: boolean }) {
  const [status, setStatus] = useState(""), [busy, start] = useTransition();
  useEffect(() => { let active = true; void inspectExperienceConnection(id).then(r => { if (active) setStatus(r.ok && r.data.configured ? (en ? "Server binding found; run a connection check." : "已找到服务端绑定，可执行连接检查。") : (en ? "Protocol defined; a server binding is needed." : "已定义接入合同，尚未绑定服务端地址与凭据。")); }); return () => { active = false; }; }, [id, en]);
  return <div className="space-y-2 rounded-lg border border-line p-4"><p className="text-sm">{status}</p><p className="text-xs text-muted">{en ? "Connection identifier" : "连接标识"}: <code>{id}</code></p><Button variant="secondary" size="sm" disabled={busy} onClick={() => start(async () => { const r = await inspectExperienceConnection(id, true); setStatus(r.ok && r.data.connected ? (en ? `Connected. ${r.data.capabilities.length} provider capabilities confirmed.` : `已接通，提供方确认了 ${r.data.capabilities.length} 项能力。`) : (en ? "Connection not ready. Check its server binding and protocol." : "连接尚未就绪，请核对服务端绑定与接口合同。")); })}>{en ? "Check connection" : "检查连接"}</Button></div>;
}
