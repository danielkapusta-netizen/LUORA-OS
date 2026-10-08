import { describe, expect, it } from 'vitest';
import {
  addDays,
  addMonths,
  dayLabel,
  dayOf,
  daysBetween,
  isDay,
  isTime,
  monthGrid,
  monthTitle,
  shortDay,
  timeRange,
  validateSlot,
  weekDays,
  weekStart,
  weekdayIndex,
} from '@/lib/tasks/dates';
import {
  checklistProgress,
  compareTasks,
  completedPerDay,
  doneShare,
  dueState,
  groupForDay,
  initials,
  newChecklistItem,
  normalizeTag,
  onTimeRate,
  parseTags,
  projectColor,
  tagStyle,
} from '@/lib/tasks/model';

describe('days and times', () => {
  it('accepts only real days and 24-hour times', () => {
    expect(isDay('2026-10-07')).toBe(true);
    expect(isDay('2028-02-29')).toBe(true);
    expect(isDay('2026-02-30')).toBe(false);
    expect(isDay('2026-2-3')).toBe(false);
    expect(isDay(20261007)).toBe(false);
    expect(isTime('09:30')).toBe(true);
    expect(isTime('24:00')).toBe(false);
    expect(isTime('9:30')).toBe(false);
    expect(isTime('12:60')).toBe(false);
  });

  it('reads the day of a moment in Warsaw, summer and winter', () => {
    expect(dayOf(new Date('2026-10-06T22:30:00Z'))).toBe('2026-10-07'); // CEST, UTC+2
    expect(dayOf(new Date('2026-01-15T23:30:00Z'))).toBe('2026-01-16'); // CET, UTC+1
    expect(dayOf(new Date('2026-01-15T12:00:00Z'))).toBe('2026-01-15');
  });

  it('adds days across month ends, years, leap days and the clock change', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2026-03-29', 1)).toBe('2026-03-30'); // clocks go forward that night
    expect(addDays('2026-10-25', 1)).toBe('2026-10-26'); // and back
    expect(daysBetween('2026-10-07', '2026-10-14')).toBe(7);
    expect(daysBetween('2026-10-07', '2026-10-05')).toBe(-2);
    expect(daysBetween('2026-03-28', '2026-03-30')).toBe(2);
  });

  it('starts weeks on Monday', () => {
    expect(weekdayIndex('2026-10-07')).toBe(2); // a Wednesday
    expect(weekdayIndex('2026-10-11')).toBe(6); // a Sunday
    expect(weekStart('2026-10-07')).toBe('2026-10-05');
    expect(weekStart('2026-10-11')).toBe('2026-10-05');
    expect(weekStart('2026-10-12')).toBe('2026-10-12');
    expect(weekDays('2026-10-07')).toEqual(['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11']);
  });

  it('lays a month out in whole weeks', () => {
    const october = monthGrid('2026-10-15');
    expect(october).toHaveLength(5);
    expect(october.every((w) => w.length === 7)).toBe(true);
    expect(october[0][0]).toEqual({ day: '2026-09-28', inMonth: false });
    expect(october[0][3]).toEqual({ day: '2026-10-01', inMonth: true });
    expect(october[4][6]).toEqual({ day: '2026-11-01', inMonth: false });
    expect(october.flat().filter((c) => c.inMonth)).toHaveLength(31);

    // February 2027 starts on a Monday and has 28 days: exactly four weeks.
    const february = monthGrid('2027-02-10');
    expect(february).toHaveLength(4);
    expect(february.flat().every((c) => c.inMonth)).toBe(true);

    // March 2026 starts on a Sunday and needs six rows.
    expect(monthGrid('2026-03-20')).toHaveLength(6);
  });

  it('moves between months and names them', () => {
    expect(addMonths('2026-12-15', 1)).toBe('2027-01-01');
    expect(addMonths('2026-01-31', -1)).toBe('2025-12-01');
    expect(addMonths('2026-10-07', 0)).toBe('2026-10-01');
    expect(addMonths('2026-10-07', 15)).toBe('2028-01-01');
    expect(monthTitle('2026-10-07')).toBe('October 2026');
  });

  it('labels days the way people say them', () => {
    expect(dayLabel('2026-10-07', '2026-10-07')).toBe('Today');
    expect(dayLabel('2026-10-08', '2026-10-07')).toBe('Tomorrow');
    expect(dayLabel('2026-10-06', '2026-10-07')).toBe('Yesterday');
    expect(dayLabel('2026-10-13', '2026-10-07')).toBe('Tue, 13 Oct');
    expect(dayLabel('2027-01-05', '2026-10-07')).toBe('Tue, 5 Jan 2027');
    expect(shortDay('2026-10-13', '2026-10-07')).toBe('13 Oct');
  });

  it('shows and checks the time slot', () => {
    expect(timeRange('10:30', '12:30')).toBe('10:30 – 12:30');
    expect(timeRange('10:30', null)).toBe('10:30');
    expect(timeRange(null, null)).toBeNull();
    expect(validateSlot(null, null)).toBeNull();
    expect(validateSlot('09:00', '10:00')).toBeNull();
    expect(validateSlot('10:00', '09:00')).toMatch(/after the start/);
    expect(validateSlot('10:00', '10:00')).toMatch(/after the start/);
    expect(validateSlot(null, '10:00')).toMatch(/start time/);
    expect(validateSlot('25:00', null)).toMatch(/Start time/);
  });
});

describe('tags, colours and checklists', () => {
  it('cleans tags typed by hand', () => {
    expect(parseTags('posters, #Ideas , figma plugins;posters')).toEqual(['posters', 'ideas', 'figma-plugins']);
    expect(parseTags(['A b', '', '#', 'a-b'])).toEqual(['a-b']);
    expect(parseTags(null)).toEqual([]);
    expect(normalizeTag('#Zażółć gęślą')).toBe('zażółć-gęślą');
    expect(normalizeTag('a!b?')).toBe('ab');
    expect(parseTags(Array.from({ length: 14 }, (_, i) => `t${i}`))).toHaveLength(10);
    expect(normalizeTag('x'.repeat(50))).toHaveLength(30);
  });

  it('gives a tag the same colour every time, whatever the case', () => {
    expect(tagStyle('posters')).toBe(tagStyle('Posters'));
    expect(tagStyle('posters')).toMatch(/^bg-/);
  });

  it('falls back to a neutral project colour and builds initials', () => {
    expect(projectColor('lime').dot).toBe('bg-lime-400');
    expect(projectColor('nonsense')).toEqual(projectColor('slate'));
    expect(projectColor(null)).toEqual(projectColor('slate'));
    expect(initials('Ola Nowak')).toBe('ON');
    expect(initials('anna')).toBe('A');
    expect(initials('  ')).toBe('?');
    expect(initials('Jan Maria Kowalski')).toBe('JM');
  });

  it('counts finished checklist items and trims new ones', () => {
    const a = newChecklistItem('  Print posters  ');
    expect(a.text).toBe('Print posters');
    expect(a.done).toBe(false);
    expect(a.id).not.toBe(newChecklistItem('x').id);
    expect(checklistProgress([{ ...a, done: true }, newChecklistItem('b'), newChecklistItem('c')])).toEqual({ done: 1, total: 3 });
    expect(checklistProgress([])).toEqual({ done: 0, total: 0 });
    expect(newChecklistItem('y'.repeat(400)).text).toHaveLength(200);
  });
});

const task = (over: Partial<{ title: string; status: string; priority: string; dueDate: string | null; startTime: string | null }> = {}) => ({
  title: 'T',
  status: 'todo',
  priority: 'normal',
  dueDate: null as string | null,
  startTime: null as string | null,
  ...over,
});

describe('ordering and grouping', () => {
  it('puts open tasks first, then by day, time, priority and title', () => {
    const list = [
      task({ title: 'done early', status: 'done', dueDate: '2026-10-01' }),
      task({ title: 'no day' }),
      task({ title: 'later', dueDate: '2026-10-09' }),
      task({ title: 'b normal', dueDate: '2026-10-07', startTime: '09:00' }),
      task({ title: 'a urgent', dueDate: '2026-10-07', startTime: '09:00', priority: 'urgent' }),
      task({ title: 'afternoon', dueDate: '2026-10-07', startTime: '14:00' }),
      task({ title: 'whole day', dueDate: '2026-10-07' }),
    ];
    expect([...list].sort(compareTasks).map((t) => t.title)).toEqual(['a urgent', 'b normal', 'afternoon', 'whole day', 'later', 'no day', 'done early']);
  });

  it('says how urgent a day is', () => {
    const now = '2026-10-07';
    expect(dueState(task({ status: 'done', dueDate: '2026-10-01' }), now)).toBe('done');
    expect(dueState(task(), now)).toBe('none');
    expect(dueState(task({ dueDate: '2026-10-06' }), now)).toBe('overdue');
    expect(dueState(task({ dueDate: '2026-10-07' }), now)).toBe('today');
    expect(dueState(task({ dueDate: '2026-10-09' }), now)).toBe('soon');
    expect(dueState(task({ dueDate: '2026-10-10' }), now)).toBe('later');
  });

  it('splits a day into overdue, planned and undated, overdue only when looking at today', () => {
    const items = [
      task({ title: 'late', dueDate: '2026-10-05' }),
      task({ title: 'late but done', dueDate: '2026-10-05', status: 'done' }),
      task({ title: 'today b', dueDate: '2026-10-07', startTime: '11:00' }),
      task({ title: 'today a', dueDate: '2026-10-07', startTime: '09:00' }),
      task({ title: 'today done', dueDate: '2026-10-07', status: 'done' }),
      task({ title: 'tomorrow', dueDate: '2026-10-08' }),
      task({ title: 'someday' }),
      task({ title: 'someday done', status: 'done' }),
    ];
    const today = groupForDay(items, '2026-10-07', '2026-10-07');
    expect(today.overdue.map((t) => t.title)).toEqual(['late']);
    expect(today.planned.map((t) => t.title)).toEqual(['today a', 'today b', 'today done']);
    expect(today.undated.map((t) => t.title)).toEqual(['someday']);
    const tomorrow = groupForDay(items, '2026-10-08', '2026-10-07');
    expect(tomorrow.overdue).toEqual([]);
    expect(tomorrow.planned.map((t) => t.title)).toEqual(['tomorrow']);
  });
});

describe('productivity figures', () => {
  it('shares done tasks of a day, or nothing when none are planned', () => {
    expect(doneShare([])).toBeNull();
    expect(doneShare([{ status: 'done' }, { status: 'todo' }, { status: 'in_progress' }, { status: 'done' }])).toBe(0.5);
    expect(doneShare([{ status: 'done' }])).toBe(1);
  });

  it('counts how many finished tasks were on time, ignoring tasks without a day', () => {
    expect(onTimeRate([])).toBeNull();
    expect(onTimeRate([{ dueDate: null, doneDay: '2026-10-07' }])).toBeNull();
    expect(
      onTimeRate([
        { dueDate: '2026-10-07', doneDay: '2026-10-07' },
        { dueDate: '2026-10-07', doneDay: '2026-10-06' },
        { dueDate: '2026-10-07', doneDay: '2026-10-09' },
        { dueDate: null, doneDay: '2026-10-09' },
        { dueDate: '2026-10-01', doneDay: '2026-10-02' },
      ]),
    ).toBe(0.5);
  });

  it('counts finished tasks per day for the last week, empty days included', () => {
    const days = completedPerDay(['2026-10-07', '2026-10-07', '2026-10-05', '2026-09-20'], '2026-10-07');
    expect(days).toHaveLength(7);
    expect(days[0]).toEqual({ day: '2026-10-01', count: 0 });
    expect(days[4]).toEqual({ day: '2026-10-05', count: 1 });
    expect(days[6]).toEqual({ day: '2026-10-07', count: 2 });
    expect(completedPerDay([], '2026-10-07', 3).map((d) => d.day)).toEqual(['2026-10-05', '2026-10-06', '2026-10-07']);
  });
});
