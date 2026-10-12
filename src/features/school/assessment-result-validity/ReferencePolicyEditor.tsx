"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { loadReferencePolicyAction, saveReferencePolicyAction } from "./actions";
import { referenceValidityMessages, type AssessmentReferencePolicy } from "./contract";

export function ReferencePolicyEditor() {
  const m = referenceValidityMessages(useLocale());
  const router = useRouter();
  const [policy, setPolicy] = useState<AssessmentReferencePolicy | null>(null);
  const [months, setMonths] = useState("");
  const [pending, setPending] = useState(false), [loading, setLoading] = useState(true);
  const [error, setError] = useState(""), [saved, setSaved] = useState(false);
  const lock = useRef(false);
  const errorMessage = (code: string) => code === "CONFLICT" ? m.conflict : code === "VALIDATION" ? m.validation : m.failed;
  async function reload() {
    if (lock.current) return;
    lock.current = true; setLoading(true); setError(""); setSaved(false);
    try {
      const result = await loadReferencePolicyAction();
      if (result.ok) { setPolicy(result.data); setMonths(String(result.data.validityMonths)); }
      else setError(errorMessage(result.code));
    } catch { setError(m.failed); }
    finally { lock.current = false; setLoading(false); }
  }
  useEffect(() => {
    let active = true;
    void loadReferencePolicyAction().then(result => {
      if (!active) return;
      if (result.ok) { setPolicy(result.data); setMonths(String(result.data.validityMonths)); }
      else setError(result.code);
      setLoading(false);
    }).catch(() => { if (active) { setError("FAILED"); setLoading(false); } });
    return () => { active = false; };
  }, []);
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!policy?.canManage || lock.current) return;
    const value = Number(months);
    if (!Number.isInteger(value) || value < 1 || value > 36) { setError(m.validation); return; }
    lock.current = true; setPending(true); setError(""); setSaved(false);
    try {
      const result = await saveReferencePolicyAction({ validityMonths: value, expectedUpdatedAt: policy.updatedAt });
      if (result.ok) { setPolicy(result.data); setMonths(String(result.data.validityMonths)); setSaved(true); router.refresh(); }
      else setError(errorMessage(result.code));
    } catch { setError(m.failed); }
    finally { lock.current = false; setPending(false); }
  }
  return <section className="max-w-2xl space-y-3 py-3">
    <p className="text-sm leading-6 text-muted">{m.policyHint}</p>
    {loading ? <p role="status" className="text-sm text-muted">{m.loading}</p> : policy && <form onSubmit={save} className="flex flex-wrap items-end gap-3">
      <label className="space-y-1 text-sm"><span className="block">{m.months}</span>
        <Input type="number" min={1} max={36} step={1} required className="w-28" value={months} disabled={!policy.canManage || pending}
          onChange={event => { setMonths(event.target.value); setSaved(false); }} />
      </label>
      {policy.canManage ? <Button type="submit" size="sm" disabled={pending || Number(months) === policy.validityMonths}>{pending ? m.saving : m.save}</Button>
        : <p className="text-xs text-muted">{m.forbidden}</p>}
    </form>}
    <p className="text-xs text-muted">{m.historyHint}</p>
    {saved && <p role="status" className="text-sm text-leaf-deep">{m.saved}</p>}
    {error && <div className="flex flex-wrap items-center gap-2"><p role="alert" className="text-sm text-rose">{/^[A-Z_]+$/.test(error) ? errorMessage(error) : error}</p>
      <Button size="sm" variant="secondary" disabled={pending || loading} onClick={() => void reload()}>{m.retry}</Button></div>}
  </section>;
}
