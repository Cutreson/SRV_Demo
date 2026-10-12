import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fromInputDate, fromInputDateTime, toInputDateTime, vnStartOfDay, vnWeekStart, vnDateKey, relativeDay, fmtVN } from '../../src/lib/time';
import { applyFilter, compareTasks, isDueToday, isDueWithin, isFollowUpDue, isOverdue, missingInfo } from '../../src/features/tasks/taskLogic';
import { changedFields } from '../../src/features/audit/diff';
import type { Task } from '../../src/lib/types';

test('giờ VN ↔ UTC', () => {
  assert.equal(fromInputDateTime('2026-10-12T09:00'), '2026-10-12T02:00:00.000Z');
  assert.equal(toInputDateTime('2026-10-12T02:00:00.000Z'), '2026-10-12T09:00');
  assert.equal(fromInputDate('2026-10-12', 17), '2026-10-12T10:00:00.000Z');
  // 23:30 UTC ngày 11 = 06:30 ngày 12 giờ VN
  assert.equal(vnDateKey('2026-10-11T23:30:00Z'), '2026-10-12');
  assert.equal(vnStartOfDay(new Date('2026-10-11T23:30:00Z')).toISOString(), '2026-10-11T17:00:00.000Z');
  assert.equal(fmtVN('2026-10-12T02:00:00Z'), 'T2 12/10 09:00');
});

test('đầu tuần là Thứ 2 (giờ VN)', () => {
  // CN 18/10/2026 10:00 VN → thứ 2 12/10
  assert.equal(vnDateKey(vnWeekStart(new Date('2026-10-18T03:00:00Z'))), '2026-10-12');
  assert.equal(vnDateKey(vnWeekStart(new Date('2026-10-12T01:00:00Z'))), '2026-10-12');
  assert.equal(vnDateKey(vnWeekStart(new Date('2026-10-17T09:00:00Z'))), '2026-10-12');
});

test('relativeDay', () => {
  const now = new Date('2026-10-12T03:00:00Z');
  assert.equal(relativeDay('2026-10-12T10:00:00Z', now), 'hôm nay');
  assert.equal(relativeDay('2026-10-13T10:00:00Z', now), 'ngày mai');
  assert.equal(relativeDay('2026-10-10T10:00:00Z', now), 'quá 2 ngày');
});

const base: Task = {
  id: '1', title: 'x', description: null, category_code: 'A', task_type: 'self', priority: 'normal', status: 'todo', needs_decision: false,
  due_at: null, next_follow_up_at: null, estimated_minutes: null, next_action: 'a', expected_result: null, completion_result: null,
  completed_at: null, assignee_profile_id: null, assignee_person_id: null, watcher_profile_id: null, goal_id: null, source: 'user',
  notes: null, created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z', created_by: null, updated_by: null, version: 1,
};
const T = (p: Partial<Task>): Task => ({ ...base, ...p });
const now = new Date('2026-10-12T03:00:00Z'); // 10:00 VN thứ 2

test('quá hạn / follow-up / sắp đến hạn', () => {
  assert.equal(isOverdue(T({ due_at: '2026-10-12T02:00:00Z' }), now), true);
  assert.equal(isOverdue(T({ due_at: '2026-10-12T02:00:00Z', status: 'done' }), now), false);
  assert.equal(isOverdue(T({ due_at: '2026-10-12T02:00:00Z', status: 'cancelled' }), now), false);
  assert.equal(isFollowUpDue(T({ next_follow_up_at: '2026-10-12T03:00:00Z' }), now), true);
  assert.equal(isFollowUpDue(T({ next_follow_up_at: '2026-10-13T03:00:00Z' }), now), false);
  assert.equal(isDueToday(T({ due_at: '2026-10-12T10:00:00Z' }), now), true);
  assert.equal(isDueToday(T({ due_at: '2026-10-12T17:30:00Z' }), now), false); // 00:30 ngày 13 VN
  assert.equal(isDueWithin(T({ due_at: '2026-10-15T10:00:00Z' }), 3, now), true);
  assert.equal(isDueWithin(T({ due_at: '2026-10-16T10:00:00Z' }), 3, now), false);
});

test('sắp xếp: quá hạn trước, rồi deadline gần, rồi ưu tiên', () => {
  const a = T({ id: 'a', due_at: '2026-10-20T00:00:00Z' });
  const b = T({ id: 'b', due_at: '2026-10-11T00:00:00Z' });
  const c = T({ id: 'c', due_at: '2026-10-20T00:00:00Z', priority: 'urgent' });
  const d = T({ id: 'd' });
  assert.deepEqual([a, b, c, d].sort((x, y) => compareTasks(x, y, now)).map((x) => x.id), ['b', 'c', 'a', 'd']);
});

test('lọc', () => {
  const list = [T({ id: '1' }), T({ id: '2', status: 'done', completion_result: 'ok' }), T({ id: '3', task_type: 'delegated', assignee_person_id: 'p1' }),
    T({ id: '4', title: 'Gặp khách hàng Bắc Ninh', category_code: 'D' })];
  assert.deepEqual(applyFilter(list, {}, now).map((t) => t.id), ['1', '3', '4']);
  assert.deepEqual(applyFilter(list, { status: 'all' }, now).length, 4);
  assert.deepEqual(applyFilter(list, { assignee: 'x:p1' }, now).map((t) => t.id), ['3']);
  assert.deepEqual(applyFilter(list, { q: 'bắc ninh' }, now).map((t) => t.id), ['4']);
  assert.deepEqual(applyFilter(list, { category: 'D' }, now).map((t) => t.id), ['4']);
});

test('thiếu thông tin', () => {
  assert.deepEqual(missingInfo(T({ task_type: 'delegated', next_action: null, category_code: null })),
    ['nhóm', 'người thực hiện', 'ngày follow-up', 'hành động tiếp theo', 'deadline / ngày kiểm tra']);
  assert.deepEqual(missingInfo(T({ status: 'done', completion_result: 'x' })), []);
});

test('diff audit bỏ qua trường kỹ thuật', () => {
  const ch = changedFields({ action: 'UPDATE', before_data: { title: 'a', version: 1, updated_at: 'x' }, after_data: { title: 'b', version: 2, updated_at: 'y' } });
  assert.deepEqual(ch, [{ field: 'title', before: 'a', after: 'b' }]);
});

import { occurrences, parseRule, buildRule, expandEvents } from '../../src/lib/recurrence';
import { freeMinutes, mergeIntervals, checkWorkingHours } from '../../src/features/calendar/calendarRules';
import type { CalendarEvent } from '../../src/lib/types';

test('RRULE hằng tuần thứ 2, giữ giờ VN', () => {
  // T2 05/10/2026 09:00 VN = 02:00Z
  const occ = occurrences(new Date('2026-10-05T02:00:00Z'), new Date('2026-10-05T03:30:00Z'), 'FREQ=WEEKLY;BYDAY=MO',
    new Date('2026-10-10T00:00:00Z'), new Date('2026-10-27T00:00:00Z'));
  assert.deepEqual(occ.map((o) => o.start.toISOString()), ['2026-10-12T02:00:00.000Z', '2026-10-19T02:00:00.000Z', '2026-10-26T02:00:00.000Z']);
});

test('RRULE COUNT/UNTIL/DAILY', () => {
  const s = new Date('2026-10-12T01:00:00Z'), e = new Date('2026-10-12T01:15:00Z'), from = new Date('2026-10-01T00:00:00Z'), to = new Date('2026-11-30T00:00:00Z');
  assert.equal(occurrences(s, e, 'FREQ=DAILY;COUNT=3', from, to).length, 3);
  assert.equal(occurrences(s, e, 'FREQ=DAILY;BYDAY=MO,TU,WE,TH,FR,SA;UNTIL=20261018', from, to).length, 6); // bỏ CN 18/10
  assert.equal(occurrences(s, e, 'FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,TH', from, new Date('2026-10-27T00:00:00Z')).length, 3); // 12,15,26
  const r = parseRule('FREQ=WEEKLY;BYDAY=MO,WE;COUNT=4')!;
  assert.equal(buildRule(r), 'FREQ=WEEKLY;BYDAY=MO,WE;COUNT=4');
});

test('ngoại lệ lịch lặp: bỏ một lần', () => {
  const ev = { id: 'p', title: 'Họp', start_at: '2026-10-05T02:00:00Z', end_at: '2026-10-05T03:00:00Z', recurrence_rule: 'FREQ=WEEKLY;BYDAY=MO', status: 'confirmed' } as CalendarEvent;
  const list = expandEvents([ev], [{ parent_event_id: 'p', occurrence_start_at: '2026-10-12T02:00:00Z', action: 'skip', replacement_event_id: null }],
    new Date('2026-10-01T00:00:00Z'), new Date('2026-10-20T00:00:00Z'));
  assert.deepEqual(list.map((x) => x.start_at), ['2026-10-05T02:00:00.000Z', '2026-10-19T02:00:00.000Z']);
  assert.equal(list[0].parentId, 'p');
});

test('thời gian trống trừ nghỉ trưa và 25% dự phòng', () => {
  assert.deepEqual(mergeIntervals([[540, 600], [570, 630], [700, 720]]), [[540, 630], [700, 720]]);
  // 480 phút làm việc, bận 09:00–10:30 và 11:30–13:30 (30p rơi vào trưa) → bận 90+30+30=150, dự phòng 120 → trống 210
  assert.deepEqual(freeMinutes([[540, 630], [690, 810]], 25, true), { total: 480, busy: 150, reserve: 120, free: 210 });
  assert.equal(freeMinutes([], 25, false).free, 0);
  assert.equal(checkWorkingHours(new Date('2026-10-12T04:30:00Z'), new Date('2026-10-12T05:30:00Z')).length, 1); // 11:30–12:30 chồng trưa
});
