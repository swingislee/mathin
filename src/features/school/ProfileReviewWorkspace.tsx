'use client';

import { useRef, useState } from 'react';
import { Check, ChevronRight } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Link } from '@/i18n/navigation';
import { cn } from '@/lib/utils';
import { assignProfileReviewAction, readProfileReviewResponseAction, saveProfileReviewAction } from './actions/profile-review';
import { DashboardCommandActions, DashboardCommandFilters, DashboardCommandPanel, DashboardCommandState, DashboardPage } from './dashboard-page';
import { deferProfileReview, profileReviewFields, profileReviewProgress, profileReviewSourceValue,
  type ProfileReviewAnswers, type ProfileReviewData, type ProfileReviewField, type ProfileReviewGroup, type ProfileReviewResponse, type ProfileReviewScope } from './profile-review-contract';
import { getProfileReviewMessages, type ProfileReviewMessages } from './profile-review-messages';

type Draft = { answers: ProfileReviewAnswers; version: number };
const responseKey = (id: string, scope: ProfileReviewScope) => `${id}:${scope}`;
const scopesFor = (group: ProfileReviewGroup, data: ProfileReviewData): ProfileReviewScope[] =>
  (['teacher', 'support'] as const).filter(scope => data.admin || group[`${scope}_id`] === data.userId);

export function ProfileReviewWorkspace({ locale, data }: { locale: string; data: ProfileReviewData }) {
  const m = getProfileReviewMessages(locale);
  const [groups, setGroups] = useState(data.groups);
  const [groupId, setGroupId] = useState(data.groups.find(group => group.label && data.items.some(item => item.group_id === group.id && item.name))?.id ?? data.groups[0]?.id ?? '');
  const group = groups.find(value => value.id === groupId);
  const availableScopes = group ? scopesFor(group, data) : [];
  const [preferredScope, setPreferredScope] = useState<ProfileReviewScope>('teacher');
  const scope = availableScopes.includes(preferredScope) ? preferredScope : availableScopes[0] ?? 'teacher';
  const [responses, setResponses] = useState<Record<string, ProfileReviewResponse>>(() => Object.fromEntries(data.responses.map(response => [responseKey(response.item_id, response.scope), response])));
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [corrections, setCorrections] = useState<Record<string, string>>({});
  const [selectedId, setSelectedId] = useState('');
  const [retainedKey, setRetainedKey] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const [notice, setNotice] = useState<{ key: string; text: string; error?: boolean } | null>(null);
  const [conflict, setConflict] = useState<ProfileReviewResponse | null>(null);
  const members = data.items.filter(item => item.group_id === groupId);
  const visible = members.filter(item => (!search || item.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))
    && (filter === 'all' || responseKey(item.id, scope) === retainedKey || Boolean(responses[responseKey(item.id, scope)]) === (filter === 'feedback')));
  const selected = selectedId === 'done' ? null : visible.find(item => item.id === selectedId) ?? visible[0];
  const key = selected ? responseKey(selected.id, scope) : '';
  const persisted = responses[key];
  const draft = drafts[key] ?? { answers: persisted?.answers ?? {}, version: persisted?.version ?? 0 };
  const fields = selected ? profileReviewFields(selected, scope) : [];
  const currentNotice = notice?.key === key || notice?.key === 'done' ? notice : null;
  const currentConflict = conflict && responseKey(conflict.item_id, conflict.scope) === key ? conflict : null;
  const feedbackCount = members.filter(item => responses[responseKey(item.id, scope)]).length;

  const updateAnswer = (field: ProfileReviewField, answer: 'yes' | 'correction' | 'unknown') => {
    setDrafts(previous => ({ ...previous, [key]: { ...draft, answers: { ...draft.answers, [field]: {
      answer, ...(answer === 'correction' ? { value: corrections[`${key}:${field}`] ?? draft.answers[field]?.value ?? '' } : {}),
    } } } }));
    setNotice(null);
  };

  const save = async (next: boolean, later = false) => {
    if (!selected || !group || saving.current || currentConflict) return;
    const answers = later ? deferProfileReview(draft.answers, fields) : draft.answers;
    if (!Object.keys(answers).length || Object.values(answers).some(answer => answer?.answer === 'correction' && !answer.value?.trim())) {
      setNotice({ key, text: m.validation, error: true }); return;
    }
    saving.current = true; setBusy(true); setNotice(null);
    try {
      const result = await saveProfileReviewAction({ locale, itemId: selected.id, scope, version: draft.version, answers });
      if (!result.ok) {
        if (result.code === 'VERSION_CONFLICT') {
          const fresh = await readProfileReviewResponseAction({ locale, itemId: selected.id, scope });
          if (fresh.ok && fresh.data) setConflict(fresh.data);
        }
        setNotice({ key, text: result.code === 'VERSION_CONFLICT' ? m.conflict : result.code === 'VALIDATION' ? m.validation : result.code === 'FORBIDDEN' ? m.forbidden : m.failed, error: true });
        return;
      }
      setResponses(previous => ({ ...previous, [key]: result.data }));
      setDrafts(previous => { const copy = { ...previous }; delete copy[key]; return copy; });
      setNotice({ key, text: m.saved });
      if (next) {
        setRetainedKey(null);
        const nextItem = visible[visible.findIndex(item => item.id === selected.id) + 1];
        setSelectedId(nextItem?.id ?? 'done');
        if (!nextItem) setNotice({ key: 'done', text: m.saved });
      } else { setRetainedKey(key); setSelectedId(selected.id); }
    } catch { setNotice({ key, text: m.failed, error: true }); }
    finally { saving.current = false; setBusy(false); }
  };

  return <DashboardPage title={m.title} meta={data.batch ? `${feedbackCount} / ${members.length} ${m.savedCount}` : undefined}
    commandPanel={<DashboardCommandPanel>
      <DashboardCommandState>
        <Select value={groupId} onValueChange={value => { setGroupId(value); setSelectedId(''); setRetainedKey(null); setSearch(''); setNotice(null); }} disabled={busy || !groups.length}>
          <SelectTrigger aria-label={m.group} className="w-72 max-w-full"><SelectValue placeholder={m.group} /></SelectTrigger>
          <SelectContent>{groups.map(value => <SelectItem value={value.id} key={value.id}>{value.label || m.unnamedGroup} · {value.teacher_name || m.unassigned}</SelectItem>)}</SelectContent>
        </Select>
      </DashboardCommandState>
      <DashboardCommandFilters>
        <Input aria-label={m.search} placeholder={m.search} value={search} onChange={event => { setSearch(event.target.value); setSelectedId(''); }} disabled={busy} className="w-36" />
        <Select value={filter} onValueChange={value => { setFilter(value); setSelectedId(''); setRetainedKey(null); }} disabled={busy}>
          <SelectTrigger aria-label={m.roster} className="w-36"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="all">{m.all}</SelectItem><SelectItem value="pending">{m.pendingFilter}</SelectItem><SelectItem value="feedback">{m.feedbackFilter}</SelectItem></SelectContent>
        </Select>
      </DashboardCommandFilters>
      <DashboardCommandActions><Link href="/dashboard/students" className="text-sm underline underline-offset-4">{m.back}</Link></DashboardCommandActions>
    </DashboardCommandPanel>}
  >
    <p className="text-sm leading-relaxed text-muted">{m.help}</p>
    {!data.batch || !group ? <p className="py-12 text-muted">{m.empty}</p> : <>
      <div className="flex flex-wrap items-start justify-between gap-3 py-4">
        <div className="min-w-0"><h2 className="font-semibold break-words">{group.label || m.unnamedGroup}</h2>
          <p className="mt-1 text-sm text-muted">{m.sourceTeacher}：{group.teacher_name || m.unassigned}</p>
        </div>
        {availableScopes.length > 1 ? <ToggleGroup type="single" value={scope} onValueChange={value => { if (value) { setPreferredScope(value as ProfileReviewScope); setSelectedId(''); setRetainedKey(null); setNotice(null); } }} aria-label={m.view} disabled={busy} className="flex-wrap justify-start">
          {availableScopes.map(value => <ToggleGroupItem value={value} key={value}>{m[value]}</ToggleGroupItem>)}
        </ToggleGroup> : <Badge variant="outline">{m[scope]}</Badge>}
      </div>
      {data.admin && <AssignmentPanel key={group.id} group={group} reviewers={data.reviewers} locale={locale} messages={m} disabled={busy}
        onSaved={value => setGroups(previous => previous.map(item => item.id === value.id ? value : item))} />}
      <p className="pb-4 text-sm text-muted">{data.admin ? m.adminHint : scope === 'teacher' ? m.teacherHint : m.supportHint}</p>
      <div className="grid min-w-0 gap-5 lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-0">
        <nav aria-label={m.roster} className="min-w-0 lg:border-r lg:border-line lg:pr-4">
          <div className="lg:hidden"><Select value={selected?.id ?? ''} onValueChange={setSelectedId} disabled={busy}>
            <SelectTrigger aria-label={m.roster}><SelectValue placeholder={m.roster} /></SelectTrigger>
            <SelectContent>{visible.map(item => <SelectItem value={item.id} key={item.id}>{item.name || m.unnamed}</SelectItem>)}</SelectContent>
          </Select></div>
          <div className="hidden max-h-[36rem] space-y-1 overflow-y-auto lg:block">
            {visible.map(item => {
              const itemKey = responseKey(item.id, scope);
              const progress = profileReviewProgress(responses[itemKey]?.answers ?? {}, profileReviewFields(item, scope));
              return <Button key={item.id} variant="ghost" disabled={busy} aria-current={item.id === selected?.id ? 'true' : undefined}
                className={cn('h-auto w-full justify-between gap-2 rounded-lg px-3 py-3 text-left whitespace-normal', item.id === selected?.id && 'bg-moon/30 ring-1 ring-inset ring-crater/60')}
                onClick={() => { setSelectedId(item.id); setNotice(null); }}>
                <span className="min-w-0"><span className="block">{item.name || m.unnamed}</span>
                  <span className="mt-1 block text-xs font-normal text-muted">{drafts[itemKey] ? m.drafts : m[progress]}</span></span>
                {item.id === selected?.id ? <ChevronRight className="size-4 shrink-0" /> : progress === 'responded' ? <Check className="size-4 shrink-0 text-leaf-deep" /> : null}
              </Button>;
            })}
          </div>
        </nav>
        <div className="min-w-0 lg:pl-6">
          {currentNotice && <p role={currentNotice.error ? 'alert' : 'status'} className={cn('mb-4 text-sm', currentNotice.error ? 'text-rose-deep' : 'text-leaf-deep')}>{currentNotice.text}</p>}
          {!selected ? <p className="py-10 text-muted">{selectedId === 'done' ? m.nextEmpty : m.noResults}</p> : <form
            onSubmit={event => { event.preventDefault(); void save(false); }}
            onKeyDown={event => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); void save(false); } }}>
            <div className="mb-4 flex flex-wrap items-center gap-3"><h3 className="text-xl font-semibold">{selected.name || m.unnamed}</h3>
              <Badge variant="outline">{m[profileReviewProgress(persisted?.answers ?? {}, fields)]}</Badge>
              {persisted && <span className="text-xs text-muted">{new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(persisted.recorded_at))}</span>}
            </div>
            {currentConflict && <div className="mb-5 border-l-2 border-crater pl-4 text-sm">
              <p className="font-semibold">{m.latest}</p>
              <ul className="mt-2 space-y-1">{fields.filter(field => currentConflict.answers[field]).map(field => <li key={field}>
                {m.fields[field]} {currentConflict.answers[field]?.answer === 'correction' ? currentConflict.answers[field]?.value : currentConflict.answers[field]?.answer === 'yes' ? m.yes : m.unknown}
              </li>)}</ul>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button type="button" variant="secondary" onClick={() => {
                  setResponses(previous => ({ ...previous, [key]: currentConflict }));
                  setDrafts(previous => { const copy = { ...previous }; delete copy[key]; return copy; }); setConflict(null); setNotice(null);
                }}>{m.useLatest}</Button>
                <Button type="button" variant="ghost" onClick={() => {
                  setResponses(previous => ({ ...previous, [key]: currentConflict }));
                  setDrafts(previous => ({ ...previous, [key]: { answers: { ...currentConflict.answers, ...draft.answers }, version: currentConflict.version } })); setConflict(null); setNotice(null);
                }}>{m.keepDraft}</Button>
              </div>
            </div>}
            <fieldset disabled={busy || Boolean(currentConflict)} className="space-y-5">
              {fields.map(field => {
                const sourceValue = profileReviewSourceValue(selected, group, field);
                const answer = draft.answers[field];
                const controlId = `review-${selected.id}-${scope}-${field}`;
                return <fieldset key={field} className="min-w-0">
                  <legend className="text-sm font-medium">{m.fields[field]}</legend>
                  <p className="mt-1 break-words text-sm text-muted">{field === 'enrollment' && sourceValue ? m[selected.enrollment_state] : sourceValue || m.missing}</p>
                  {field === 'grade' && selected.grade_attention && <p className="mt-1 text-sm text-muted">{m.attention}</p>}
                  {field === 'contact' && <p className="mt-1 text-sm text-muted">{m.contactHelp}</p>}
                  <ToggleGroup type="single" value={answer?.answer ?? ''} onValueChange={value => { if (value) updateAnswer(field, value as 'yes' | 'correction' | 'unknown'); }}
                    aria-label={m.fields[field]} className="mt-2 flex-wrap justify-start gap-2" variant="outline">
                    {sourceValue && <ToggleGroupItem value="yes" className="h-auto min-h-9 px-3 py-2 whitespace-normal">{m.yes}</ToggleGroupItem>}
                    <ToggleGroupItem value="correction" className="h-auto min-h-9 px-3 py-2 whitespace-normal">{m.correction}</ToggleGroupItem>
                    <ToggleGroupItem value="unknown" className="h-auto min-h-9 px-3 py-2 whitespace-normal">{m.unknown}</ToggleGroupItem>
                  </ToggleGroup>
                  {answer?.answer === 'correction' && <div className="mt-2">
                    <Label htmlFor={controlId} className="sr-only">{m.fields[field]}</Label>
                    <Textarea id={controlId} value={answer.value ?? ''} maxLength={500} rows={2} className="min-h-16"
                      placeholder={field === 'contact' ? m.contactPlaceholder : m.placeholders[field]}
                      onChange={event => {
                        const value = event.target.value;
                        setCorrections(previous => ({ ...previous, [`${key}:${field}`]: value }));
                        setDrafts(previous => ({ ...previous, [key]: { ...draft, answers: { ...draft.answers, [field]: { answer: 'correction', value } } } }));
                      }} />
                  </div>}
                </fieldset>;
              })}
              <div className="flex flex-wrap gap-2 pt-2">
                <Button type="button" onClick={() => void save(true)}>{busy ? m.saving : m.saveNext}</Button>
                <Button type="submit" variant="secondary">{m.save}</Button>
                <Button type="button" variant="ghost" onClick={() => void save(true, true)}>{m.defer}</Button>
              </div>
            </fieldset>
          </form>}
          <details className="mt-6 text-sm text-muted"><summary className="cursor-pointer">{m.source}</summary>
            <p className="mt-2">{data.batch.source_label}</p><p className="mt-1">{m.sourceHelp}</p>
          </details>
        </div>
      </div>
    </>}
  </DashboardPage>;
}

function AssignmentPanel({ group, reviewers, locale, messages: m, onSaved, disabled }: {
  group: ProfileReviewGroup; reviewers: ProfileReviewData['reviewers']; locale: string; messages: ProfileReviewMessages;
  onSaved: (group: ProfileReviewGroup) => void; disabled: boolean;
}) {
  const [teacherId, setTeacherId] = useState(group.teacher_id ?? 'none');
  const [supportId, setSupportId] = useState(group.support_id ?? 'none');
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const [message, setMessage] = useState('');
  return <details className="mb-4 text-sm">
    <summary className="cursor-pointer text-muted">{m.assignment} · {reviewers.find(person => person.id === group.teacher_id)?.name || m.unassigned} / {reviewers.find(person => person.id === group.support_id)?.name || m.unassigned}</summary>
    <form className="mt-3 space-y-3" onSubmit={async event => {
      event.preventDefault(); if (pendingRef.current) return; pendingRef.current = true; setPending(true); setMessage('');
      try {
        const result = await assignProfileReviewAction({ locale, groupId: group.id, teacherId: teacherId === 'none' ? null : teacherId, supportId: supportId === 'none' ? null : supportId, version: group.version });
        if (!result.ok) setMessage(result.code === 'VERSION_CONFLICT' ? m.conflict : result.code === 'REVIEWER_UNAVAILABLE' ? m.unavailable : m.failed);
        else { onSaved({ ...group, teacher_id: teacherId === 'none' ? null : teacherId, support_id: supportId === 'none' ? null : supportId, version: result.data }); setMessage(m.assignmentSaved); }
      } catch { setMessage(m.failed); }
      finally { setPending(false); pendingRef.current = false; }
    }}>
      <p className="text-muted">{m.assignmentHelp}</p>
      <fieldset disabled={disabled || pending} className="flex flex-wrap items-end gap-3">
        {(['teacher', 'support'] as const).map(scope => <div key={scope} className="space-y-1">
          <Label htmlFor={`assign-${scope}`}>{m[scope]}</Label>
          <Select value={scope === 'teacher' ? teacherId : supportId} onValueChange={scope === 'teacher' ? setTeacherId : setSupportId}>
            <SelectTrigger id={`assign-${scope}`} className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="none">{m.unassigned}</SelectItem>{reviewers.map(person => <SelectItem key={person.id} value={person.id}>{person.name}</SelectItem>)}</SelectContent>
          </Select>
        </div>)}
        <Button type="submit" variant="secondary">{pending ? m.saving : m.assignmentSave}</Button>
      </fieldset>
      {message && <p role="status" className="text-muted">{message}</p>}
    </form>
  </details>;
}
