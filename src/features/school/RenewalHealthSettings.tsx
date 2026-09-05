"use client";

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Check, RotateCcw } from 'lucide-react';
import { useAction } from '@/components/action-form';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useRouter } from '@/i18n/navigation';
import { renewalHealthLevel, renewalHealthSignals, type RenewalHealthFacts } from './renewal-health-contract';
import { DEFAULT_RENEWAL_HEALTH_POLICY, HEALTH_RULE_BOUNDS, HEALTH_RULE_KEYS, isRenewalHealthPolicy, type HealthRuleKey, type HealthRulePolicy, type RenewalHealthPolicy } from './renewal-health-policy';
import { saveRenewalHealthPolicyAction } from './renewal-health-actions';

export function RenewalHealthSettings({ open, onOpenChange, cycleId, cycleName, policy, revision, facts, now, sampleMode, onSaved }: {
  open: boolean; onOpenChange: (open: boolean) => void; cycleId: string; cycleName: string;
  policy: RenewalHealthPolicy; revision: number; facts: RenewalHealthFacts[]; now: number; sampleMode: boolean;
  onSaved: (policy: RenewalHealthPolicy, revision: number) => void;
}) {
  const t = useTranslations('school.renewals.healthSettings');
  const healthT = useTranslations('school.renewals.poolV2');
  const router = useRouter();
  const [draft, setDraft] = useState<RenewalHealthPolicy>(() => structuredClone(policy));
  const action = useAction(saveRenewalHealthPolicyAction, {
    successMessage: t('saved'), errorMessage: { default: t('failed'), POLICY_CHANGED: t('conflict') },
    onSuccess: value => { onSaved(draft, value); onOpenChange(false); router.refresh(); },
    onError: code => { if (code === 'POLICY_CHANGED') router.refresh(); },
  });
  const valid = isRenewalHealthPolicy(draft);
  const count = (value: RenewalHealthPolicy) => facts.filter(fact => renewalHealthLevel(renewalHealthSignals(fact, now, value)) === 'attention').length;
  const changed = JSON.stringify(draft) !== JSON.stringify(policy);
  const updateRule = (key: HealthRuleKey, patch: Partial<HealthRulePolicy>) => setDraft(value => ({ ...value, rules: { ...value.rules, [key]: { ...value.rules[key], ...patch } } }));
  return <Dialog open={open} onOpenChange={value => { if (!action.pending) onOpenChange(value); }}>
    <DialogContent className="max-w-4xl" showCloseButton={!action.pending}>
      <DialogHeader><DialogTitle>{t('title')}</DialogTitle><DialogDescription>{t('scope', { cycle: cycleName })}</DialogDescription></DialogHeader>
      <form onSubmit={event => { event.preventDefault(); if (valid && changed && !action.pending) action.run({ cycleId, policy: draft, revision }); }}>
        <div className="space-y-5" inert={action.pending || undefined}>
          <div className="flex flex-wrap items-center gap-3">
            <Label htmlFor="health-window">{t('window')}</Label><Select value={String(draft.windowDays)} onValueChange={value => setDraft(current => ({ ...current, windowDays: Number(value) as RenewalHealthPolicy['windowDays'] }))}>
              <SelectTrigger id="health-window" className="h-8 w-32"><SelectValue /></SelectTrigger><SelectContent>{[7, 14, 28].map(days => <SelectItem key={days} value={String(days)}>{t('days', { days })}</SelectItem>)}</SelectContent>
            </Select><p className="text-xs text-muted">{t('comparison', { days: draft.windowDays })}</p>
          </div>
          <div className="space-y-4">{HEALTH_RULE_KEYS.map(key => {
            const rule = draft.rules[key];
            return <div key={key} className="grid items-start gap-3 sm:grid-cols-[minmax(0,1fr)_9rem_10rem]">
              <div><Label className="flex items-center gap-2"><Checkbox checked={rule.enabled} onCheckedChange={checked => updateRule(key, { enabled: checked === true })} />{healthT(key)}</Label>
                <p className="mt-1 pl-6 text-xs leading-5 text-muted">{t('condition_' + key, { min: rule.minSamples, threshold: rule.threshold })}</p>
              </div>
              <Label className="block text-[11px] text-muted">{t('samples_' + key)}<Input className="mt-1 h-8 text-xs" type="number" min={1} max={100} step={1} required disabled={!rule.enabled} value={rule.minSamples} onChange={event => updateRule(key, { minSamples: Number(event.target.value) })} /></Label>
              <Label className="block text-[11px] text-muted">{t('threshold_' + key)}<Input className="mt-1 h-8 text-xs" type="number" min={HEALTH_RULE_BOUNDS[key].min} max={HEALTH_RULE_BOUNDS[key].max} step={1} required disabled={!rule.enabled} value={rule.threshold} onChange={event => updateRule(key, { threshold: Number(event.target.value) })} /></Label>
            </div>;
          })}</div>
          <div className="border-l-2 border-moon pl-3 text-xs leading-5" aria-live="polite">
            <p className="font-medium">{t(sampleMode ? 'previewSamples' : 'previewStudents')}</p>
            <p>{valid ? t('preview', { before: count(policy), after: count(draft), total: facts.length }) : t('invalid')}</p>
            <p className="text-muted">{t('missingData')}</p>
          </div>
        </div>
        <DialogFooter className="mt-5 gap-2 border-t border-line pt-4">
          <Button type="button" size="sm" variant="ghost" className="sm:mr-auto" disabled={action.pending} onClick={() => setDraft(structuredClone(DEFAULT_RENEWAL_HEALTH_POLICY))}><RotateCcw className="size-3.5" />{t('restore')}</Button>
          <Button type="button" size="sm" variant="secondary" disabled={action.pending} onClick={() => onOpenChange(false)}>{t('cancel')}</Button>
          <Button type="submit" size="sm" disabled={action.pending || !valid || !changed}><Check className="size-3.5" />{t('save')}</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}
