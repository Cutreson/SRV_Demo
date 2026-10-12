import { test } from 'node:test';
import assert from 'node:assert/strict';
import { proposeSchedule, type SchedulerInput } from '../../src/lib/scheduler';
import { overlaps } from '../../src/lib/time';
import type { Task } from '../../src/lib/types';

const base: Task = {
  id: '', title: '', description: null, category_code: 'A', task_type: 'self', priority: 'normal', status: 'todo', needs_decision: false,
  due_at: null, next_follow_up_at: null, estimated_minutes: 60, next_action: null, expected_result: null, completion_result: null,
  completed_at: null, assignee_profile_id: null, assignee_person_id: null, watcher_profile_id: null, goal_id: null, source: 'user',
  notes: null, created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z', created_by: null, updated_by: null, version: 1,
};
const T = (p: Partial<Task>): Task => ({ ...base, ...p });
const weekStart = new Date('2026-10-11T17:00:00Z'); // T2 12/10 00:00 VN
const now = new Date('2026-10-12T00:30:00Z');       // T2 07:30 VN
const template = {
  '1': [['09:00', '10:30', 'A'], ['10:30', '12:00', 'B'], ['14:30', '16:45', 'buffer']],
  '4': [['09:00', '10:30', 'F'], ['10:30', '12:00', 'F']],
} as SchedulerInput['template'];
const minVN = (d: Date) => { const s = new Date(d.getTime() + 7 * 3600e3); return s.getUTCHours() * 60 + s.getUTCMinutes(); };
const dowVN = (d: Date) => new Date(d.getTime() + 7 * 3600e3).getUTCDay();

test('không trùng lịch có sẵn, không giờ trưa, không Chủ nhật, trong 08–17', () => {
  const events = [{ start_at: '2026-10-12T02:00:00Z', end_at: '2026-10-12T03:30:00Z', event_type: 'fixed' as const, status: 'confirmed' as const, task_id: null }];
  const tasks = Array.from({ length: 12 }, (_, i) => T({ id: 't' + i, title: 'Việc ' + i, estimated_minutes: 120 }));
  const r = proposeSchedule({ tasks, events, weekStart, now, bufferPercent: 25, maxBlock: 90, template });
  assert.ok(r.proposals.length > 0);
  for (const p of r.proposals) {
    assert.ok(!overlaps(p.start, p.end, events[0].start_at, events[0].end_at), 'trùng lịch cố định');
    const s = minVN(p.start), e = minVN(p.end);
    assert.ok(s >= 480 && e <= 1020, 'ngoài giờ làm');
    assert.ok(!(s < 780 && e > 720), 'chồng giờ trưa');
    assert.notEqual(dowVN(p.start), 0, 'xếp vào Chủ nhật');
    assert.ok(p.end.getTime() - p.start.getTime() <= 90 * 60_000, 'block > 90 phút');
  }
  for (let i = 0; i < r.proposals.length; i++) for (let j = i + 1; j < r.proposals.length; j++)
    assert.ok(!overlaps(r.proposals[i].start, r.proposals[i].end, r.proposals[j].start, r.proposals[j].end), 'đề xuất trùng nhau');
});

test('giữ tối thiểu 25% dự phòng mỗi ngày', () => {
  const tasks = Array.from({ length: 60 }, (_, i) => T({ id: 't' + i, estimated_minutes: 60 }));
  const r = proposeSchedule({ tasks, events: [], weekStart, now, bufferPercent: 25, maxBlock: 90, template });
  const perDay = new Map<number, number>();
  for (const p of r.proposals) perDay.set(dowVN(p.start), (perDay.get(dowVN(p.start)) ?? 0) + (p.end.getTime() - p.start.getTime()) / 60_000);
  for (const [, m] of perDay) assert.ok(m <= 480 * 0.75, `vượt sức chứa: ${m}`);
  assert.ok(r.unplaced.length > 0, 'phải có việc không xếp được');
  const r2 = proposeSchedule({ tasks, events: [], weekStart, now, bufferPercent: 25, maxBlock: 90, template, allowBuffer: true });
  assert.ok(r2.proposals.length > r.proposals.length, 'cho phép dùng buffer phải xếp được nhiều hơn');
});

test('ưu tiên quá hạn và deadline gần; deadline không khả thi được cảnh báo', () => {
  const tasks = [
    T({ id: 'late', priority: 'low', due_at: '2026-10-10T10:00:00Z', estimated_minutes: 60 }),
    T({ id: 'soon', priority: 'normal', due_at: '2026-10-13T10:00:00Z', estimated_minutes: 60 }),
    T({ id: 'later', priority: 'urgent', due_at: '2026-10-16T10:00:00Z', estimated_minutes: 60 }),
    T({ id: 'impossible', due_at: '2026-10-12T02:00:00Z', estimated_minutes: 600 }), // T2 09:00, cần 10 giờ
  ];
  const r = proposeSchedule({ tasks, events: [], weekStart, now, bufferPercent: 25, maxBlock: 90, template });
  assert.deepEqual(r.ranking.slice(0, 2).map((x) => x.taskId), ['late', 'impossible']);
  const soon = r.proposals.find((p) => p.taskId === 'soon')!;
  assert.ok(soon.end <= new Date('2026-10-13T10:00:00Z'), 'phải xong trước deadline');
  assert.ok(r.unplaced.some((u) => u.taskId === 'impossible' && /deadline/.test(u.reason)));
  assert.ok(r.warnings.length >= 1);
});

test('việc chiến lược F ưu tiên khung F buổi sáng thứ 5; chia block dài', () => {
  const r = proposeSchedule({ tasks: [T({ id: 'f', category_code: 'F', estimated_minutes: 240 })], events: [], weekStart, now, bufferPercent: 25, maxBlock: 90, template });
  const ps = r.proposals.filter((p) => p.taskId === 'f');
  assert.equal(ps.reduce((a, p) => a + (p.end.getTime() - p.start.getTime()) / 60_000, 0), 240);
  assert.ok(ps.every((p) => p.end.getTime() - p.start.getTime() >= 30 * 60_000));
  assert.ok(ps.some((p) => dowVN(p.start) === 4 && minVN(p.start) >= 540 && minVN(p.end) <= 720), 'nên vào khung F sáng thứ 5');
});

test('không xếp việc thiếu ước tính, việc giao, việc đã xong; trừ phần đã có lịch', () => {
  const tasks = [T({ id: 'noest', estimated_minutes: null }), T({ id: 'dg', task_type: 'delegated' }), T({ id: 'done', status: 'done', completion_result: 'x' }),
    T({ id: 'part', estimated_minutes: 120 })];
  const events = [{ start_at: '2026-10-13T02:00:00Z', end_at: '2026-10-13T03:30:00Z', event_type: 'focus' as const, status: 'confirmed' as const, task_id: 'part' }];
  const r = proposeSchedule({ tasks, events, weekStart, now, bufferPercent: 25, maxBlock: 90, template });
  assert.deepEqual([...new Set(r.proposals.map((p) => p.taskId))], ['part']);
  assert.equal(r.proposals.reduce((a, p) => a + (p.end.getTime() - p.start.getTime()) / 60_000, 0), 30);
  assert.ok(r.unplaced.some((u) => u.taskId === 'noest'));
});
