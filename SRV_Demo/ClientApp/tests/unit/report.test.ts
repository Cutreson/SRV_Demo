import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toCsv, weeklyReport } from '../../src/lib/report';
import type { CalendarEvent, Task } from '../../src/lib/types';

const base = {
  description: null, category_code: 'A', task_type: 'self', priority: 'normal', status: 'todo', needs_decision: false, due_at: null,
  next_follow_up_at: null, estimated_minutes: null, next_action: null, expected_result: null, completion_result: null, completed_at: null,
  assignee_profile_id: null, assignee_person_id: null, watcher_profile_id: null, goal_id: null, source: 'user', notes: null,
  created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z', created_by: null, updated_by: null, version: 1,
} as const;
const T = (p: Partial<Task> & { id: string }): Task => ({ ...base, title: p.id, ...p } as Task);
const E = (p: Partial<CalendarEvent>): CalendarEvent => ({ id: Math.random() + '', title: 'e', event_type: 'flexible', category_code: null, task_id: null, locked: false,
  recurrence_rule: null, recurrence_parent_id: null, timezone: 'Asia/Ho_Chi_Minh', status: 'confirmed', notes: null, source: 'user', version: 1,
  created_by: null, updated_by: null, updated_at: '', start_at: '', end_at: '', ...p });
const weekStart = new Date('2026-10-11T17:00:00Z'); // T2 12/10
const now = new Date('2026-10-16T10:00:00Z');       // T6 17:00

test('báo cáo tuần: đếm việc và giờ theo nhóm', () => {
  const tasks = [
    T({ id: 'new', created_at: '2026-10-12T03:00:00Z' }),
    T({ id: 'done', status: 'done', completion_result: 'ok', completed_at: '2026-10-14T03:00:00Z' }),
    T({ id: 'doneOld', status: 'done', completion_result: 'ok', completed_at: '2026-10-05T03:00:00Z' }),
    T({ id: 'late', due_at: '2026-10-13T10:00:00Z' }),
    T({ id: 'dg', task_type: 'delegated', next_follow_up_at: '2026-10-13T02:00:00Z' }),
    T({ id: 'dgOk', task_type: 'delegated', next_follow_up_at: '2026-10-13T02:00:00Z' }),
    T({ id: 'f', category_code: 'F' }),
  ];
  const events = [
    E({ start_at: '2026-10-12T02:00:00Z', end_at: '2026-10-12T04:00:00Z', category_code: 'A', status: 'done' }), // 2h A thực tế
    E({ start_at: '2026-10-13T02:00:00Z', end_at: '2026-10-13T04:00:00Z', task_id: 'f' }),                      // 2h F
    E({ start_at: '2026-10-13T07:00:00Z', end_at: '2026-10-13T09:00:00Z', event_type: 'buffer' }),              // không tính
  ];
  const r = weeklyReport({ tasks, updates: [{ task_id: 'dgOk', created_at: '2026-10-13T03:00:00Z' }], events, weekStart, now, bufferPercent: 25 });
  assert.deepEqual(r.created.map((t) => t.id), ['new']);
  assert.deepEqual(r.completed.map((t) => t.id), ['done']);
  assert.deepEqual(r.overdueOpen.map((t) => t.id), ['late']);
  assert.deepEqual(r.delegatedPending.map((t) => t.id).sort(), ['dg', 'dgOk']);
  assert.deepEqual(r.missedFollowUps.map((t) => t.id), ['dg']);
  assert.equal(r.scheduledByCat.A, 120); assert.equal(r.scheduledByCat.F, 120); assert.equal(r.actualByCat.A, 120);
  assert.equal(r.strategicShare, 50);
  assert.equal(r.bufferUsedShare, 0);
});

test('CSV: BOM, escape, chống công thức', () => {
  const csv = toCsv([['a,b', 'x"y', '=SUM(A1)'], [1, null]]);
  assert.ok(csv.startsWith('﻿'));
  assert.equal(csv.slice(1), '"a,b","x""y",\'=SUM(A1)\r\n1,');
});
