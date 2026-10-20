// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StudentStageRow } from '@/features/school/student-stage-contract';
import type { StatusEvidence } from '@/features/school/record-status/contract';
import { summarizeRecordStatus } from '@/features/school/record-status/summary';
import { recordStatusFacets } from '@/features/school/record-status/stage-focus';
import { communicationFactTags } from '@/features/school/record-status/communication-facts';
import { useRecordStatusEvidence } from '@/features/school/record-status/useRecordStatusEvidence';
import { RecordStatusEvidenceContent } from '@/features/school/record-status/RecordStatusEvidenceContent';

const actions = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock('@/features/school/record-status/actions', () => ({ getRecordStatusEvidenceAction: actions.read }));
const facts: StatusEvidence[] = [
  { type: 'wechat', value: 'yes', field: '登记', excerpt: '依据原文', priority: 400, certainty: 'confirmed', date: '2026-10-01', recordId: 'contact-a' },
  { type: 'wechat', value: 'no', field: '登记', excerpt: '冲突原文', priority: 400, certainty: 'confirmed', date: '2026-10-01', recordId: 'contact-b' },
  { type: 'concern', value: 'cost', field: '备注', excerpt: '费用原文', priority: 100, certainty: 'review', date: null },
];
const full: StudentStageRow = {
  key: 'student:00000000-0000-4000-8000-000000000001', studentId: '00000000-0000-4000-8000-000000000001', leadId: null,
  name: '示例', phone: '', grade: null, gradeText: '', ownerId: null, ownerName: '',
  stage: 'awaiting_assessment', detail: 'following', note: '名单备注', lastContactAt: null, nextContactAt: null,
  score: null, assessmentBand: null, assessmentAt: null, registrationId: null, courseTitle: '', termName: '', courseId: null, termId: null,
  createdAt: '2026-10-01T00:00:00Z', canWrite: false, canContact: false, invitation: null, statusEvidence: facts,
};
const compact = summarizeRecordStatus(full);
let container: HTMLDivElement, root: Root;
function Probe({ row }: { row: StudentStageRow }) {
  const evidence = useRecordStatusEvidence(row);
  return createElement('div', null,
    createElement('button', { onClick: () => evidence.onOpenChange(true) }, '打开'),
    createElement('button', { onClick: () => evidence.onOpenChange(false) }, '关闭'),
    // This component accepts a render function, not a ReactNode child.
    // eslint-disable-next-line react/no-children-prop
    createElement(RecordStatusEvidenceContent, {
      evidence, locale: 'zh', children: rows => createElement('p', { 'data-facts': true }, rows.map(f => f.excerpt).join('|')),
    }));
}
async function render(row = compact) { await act(async () => root.render(createElement(Probe, { row }))); }
async function click(text: string) {
  const button = [...container.querySelectorAll('button')].find(button => button.textContent === text);
  expect(button).toBeTruthy();
  await act(async () => button!.click());
}
function pending<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  actions.read.mockReset();
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

describe('名单状态摘要与按需原文', () => {
  it('保留冲突、未知、存储值和全部沟通标签，首屏不携带依据原文', () => {
    for (const row of [full, { ...full, lifecycle: { wechat: 'yes' as const, interest: 'A', visit: null, visitOn: null } },
      { ...full, stage: 'awaiting_first_contact' as const }, { ...full, stage: 'awaiting_enrollment' as const }]) {
      const light = summarizeRecordStatus(row);
      const triggers = (value: StudentStageRow) => recordStatusFacets(value).map(({ facet, status, tone }) =>
        ({ facet, value: status.value, review: status.review, stored: status.stored, tone }));
      expect(triggers(light)).toEqual(triggers(row));
      expect(light.statusSummary?.communicationTags).toEqual(communicationFactTags(facts));
      expect(light.statusEvidence).toBeUndefined();
      expect(JSON.stringify(light)).not.toContain('依据原文');
      expect(light.note).toBe(row.note);
    }
    // 保存后带回完整事实，即使调用方合并了旧摘要，也优先使用新事实。
    expect(recordStatusFacets({ ...compact, statusEvidence: [facts[0]] })[0].status.value).toBe('yes');
    const empty = { ...full, statusEvidence: [] };
    expect(summarizeRecordStatus(empty)).toBe(empty);
  });

  it('首次渲染不请求，打开后读取一次，重新打开复用同一行结果', async () => {
    const request = pending<{ ok: true; data: StatusEvidence[] }>();
    actions.read.mockReturnValue(request.promise);
    await render();
    expect(actions.read).not.toHaveBeenCalled();
    await click('打开');
    expect(actions.read).toHaveBeenCalledTimes(1);
    expect(actions.read).toHaveBeenCalledWith({ studentId: full.studentId, leadId: null });
    expect(container.querySelector('[role=status]')).not.toBeNull();
    await click('关闭'); await click('打开');
    expect(actions.read).toHaveBeenCalledTimes(1);
    await act(async () => request.resolve({ ok: true, data: facts }));
    expect(container.textContent).toContain('依据原文');
    await click('关闭'); await click('打开');
    expect(actions.read).toHaveBeenCalledTimes(1);
  });

  it('读取失败保留明确重试，不把失败显示成没有依据', async () => {
    actions.read.mockResolvedValueOnce({ ok: false, code: 'FORBIDDEN_SCOPE' }).mockResolvedValueOnce({ ok: true, data: facts });
    await render(); await click('打开');
    expect(container.querySelector('[role=alert]')).not.toBeNull();
    await click('重新读取');
    expect(actions.read).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain('依据原文');
  });

  it('行快照变化时重新校验，旧请求晚到不会覆盖新结果', async () => {
    const first = pending<{ ok: true; data: StatusEvidence[] }>();
    const second = pending<{ ok: true; data: StatusEvidence[] }>();
    actions.read.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    await render(); await click('打开');
    const other = { ...compact, studentId: '00000000-0000-4000-8000-000000000002' };
    await render(other);
    expect(actions.read).toHaveBeenCalledTimes(2);
    await act(async () => second.resolve({ ok: true, data: [{ ...facts[0], excerpt: '新记录原文' }] }));
    await act(async () => first.resolve({ ok: true, data: facts }));
    expect(container.textContent).toContain('新记录原文');
    expect(container.textContent).not.toContain('依据原文');
  });

  it('已有完整事实的单人和保存回执不增加读取请求', async () => {
    await render(full); await click('打开');
    expect(actions.read).not.toHaveBeenCalled();
    expect(container.textContent).toContain('依据原文');
  });
});
