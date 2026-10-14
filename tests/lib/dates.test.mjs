import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TZ, isYmd, muscatToday, utcMs, diffDays, addDays, monthKey, fmtDate, hijriDate,
  lastDate, isUpcoming, isOngoing, clampToToday, anchorDate, actionDate
} from '../../assets/lib/dates.js';

const TODAY = '2026-10-14';

test('TZ is Asia/Muscat', () => {
  assert.equal(TZ, 'Asia/Muscat');
});

test('muscatToday follows Muscat time (UTC+4), not the viewer', () => {
  assert.equal(muscatToday(new Date('2026-10-14T20:30:00Z')), '2026-10-15');
  assert.equal(muscatToday(new Date('2026-10-14T19:59:59Z')), '2026-10-14');
  assert.equal(muscatToday(new Date('2026-10-14T20:00:00Z')), '2026-10-15');
  assert.equal(muscatToday(new Date('2026-10-14T00:00:00Z')), '2026-10-14');
});

test('muscatToday crosses month and year boundaries', () => {
  assert.equal(muscatToday(new Date('2026-12-31T20:00:00Z')), '2027-01-01');
  assert.equal(muscatToday(new Date('2026-01-31T23:00:00Z')), '2026-02-01');
  assert.equal(muscatToday(new Date('2028-02-28T21:00:00Z')), '2028-02-29');
});

test('muscatToday accepts milliseconds and survives an invalid date', () => {
  assert.equal(muscatToday(Date.parse('2026-10-14T20:30:00Z')), '2026-10-15');
  assert.match(muscatToday(new Date('nonsense')), /^\d{4}-\d{2}-\d{2}$/);
  assert.match(muscatToday(), /^\d{4}-\d{2}-\d{2}$/);
});

test('isYmd accepts real dates only', () => {
  for (const ok of ['2026-10-14', '2028-02-29', '2026-12-31']) assert.equal(isYmd(ok), true, ok);
  for (const bad of ['2026-02-29', '2026-13-01', '2026-00-10', '2026-10-32', '2026-1-1', '26-10-14', '', null, undefined, 20261014, '2026-10-14T10:00:00Z']) {
    assert.equal(isYmd(bad), false, String(bad));
  }
});

test('utcMs, diffDays and addDays work on whole days', () => {
  assert.equal(utcMs('1970-01-02'), 86400000);
  assert.equal(diffDays('2026-10-14', '2026-10-21'), 7);
  assert.equal(diffDays('2026-10-21', '2026-10-14'), -7);
  assert.equal(diffDays(TODAY, TODAY), 0);
  assert.equal(diffDays('2026-02-28', '2026-03-01'), 1);
  assert.equal(diffDays('2028-02-28', '2028-03-01'), 2);
  assert.equal(diffDays('2026-01-01', '2027-01-01'), 365);
});

test('addDays moves across month, year and leap-day boundaries', () => {
  assert.equal(addDays('2026-01-31', 1), '2026-02-01');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2028-02-28', 1), '2028-02-29');
  assert.equal(addDays('2026-02-28', 1), '2026-03-01');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(addDays(TODAY, 0), TODAY);
  assert.equal(addDays(TODAY, 100), '2027-01-22');
});

test('bad input gives NaN, null or an empty string and never throws', () => {
  assert.ok(Number.isNaN(utcMs('2026-02-30')));
  assert.ok(Number.isNaN(utcMs(undefined)));
  assert.ok(Number.isNaN(diffDays('bad', TODAY)));
  assert.equal(addDays('bad', 1), null);
  assert.equal(addDays(TODAY, NaN), null);
  assert.equal(monthKey('2026-02-30'), null);
  assert.equal(fmtDate('bad', 'en'), '');
  assert.equal(hijriDate('bad', 'ar'), '');
});

test('monthKey is the YYYY-MM part', () => {
  assert.equal(monthKey('2026-10-14'), '2026-10');
  assert.equal(monthKey('2027-01-01'), '2027-01');
});

test('fmtDate formats in English and in Arabic with Latin digits', () => {
  assert.equal(fmtDate('2026-10-14', 'en'), '14 Oct 2026');
  assert.match(fmtDate('2026-10-14', 'en', { weekday: 'short', day: 'numeric', month: 'short' }), /^Wed,? 14 Oct$/);
  const ar = fmtDate('2026-10-14', 'ar');
  assert.match(ar, /2026/);
  assert.match(ar, /14/);
  assert.match(ar, /أكتوبر/);
  assert.doesNotMatch(ar, /[٠-٩]/);
});

test('fmtDate does not shift the day for any viewer time zone', () => {
  for (const day of ['2026-03-29', '2026-10-25', '2026-12-31', '2027-01-01']) {
    assert.match(fmtDate(day, 'en', { day: 'numeric' }), new RegExp(`^${Number(day.slice(8))}$`));
  }
});

test('hijriDate returns the Umm al-Qura date, or an empty string where unsupported', () => {
  for (const lang of ['en', 'ar']) {
    const h = hijriDate('2026-10-14', lang);
    assert.equal(typeof h, 'string');
    if (h) assert.match(h, /1448/);
  }
});

test('lastDate is the latest of end, start and deadline', () => {
  assert.equal(lastDate({ start: '2026-11-01', end: '2026-11-03', deadline: '2026-10-20' }), '2026-11-03');
  assert.equal(lastDate({ deadline: '2026-12-01', start: '2026-11-01' }), '2026-12-01');
  assert.equal(lastDate({ start: '2026-11-01' }), '2026-11-01');
  assert.equal(lastDate({}), null);
  assert.equal(lastDate(null), null);
  assert.equal(lastDate({ start: 'soon', end: '2026-13-01', deadline: '2026-11-02' }), '2026-11-02');
});

test('isUpcoming: undated items count, past items do not', () => {
  assert.equal(isUpcoming({}, TODAY), true);
  assert.equal(isUpcoming({ start: '2026-10-14' }, TODAY), true);
  assert.equal(isUpcoming({ start: '2026-10-13' }, TODAY), false);
  assert.equal(isUpcoming({ start: '2026-10-01', end: '2026-10-14' }, TODAY), true);
  assert.equal(isUpcoming({ start: '2026-10-01', deadline: '2026-10-20' }, TODAY), true);
});

test('isOngoing: started before today and still running today', () => {
  assert.equal(isOngoing({ start: '2026-10-10', end: '2026-10-20' }, TODAY), true);
  assert.equal(isOngoing({ start: '2026-10-10', end: '2026-10-14' }, TODAY), true);
  assert.equal(isOngoing({ start: '2026-10-10', end: '2026-10-13' }, TODAY), false);
  assert.equal(isOngoing({ start: '2026-10-14', end: '2026-10-20' }, TODAY), false);
  assert.equal(isOngoing({ start: '2026-10-10' }, TODAY), false);
  assert.equal(isOngoing({}, TODAY), false);
});

test('clampToToday moves past dates to today and keeps the rest', () => {
  assert.equal(clampToToday('2026-10-01', TODAY), TODAY);
  assert.equal(clampToToday('2026-10-20', TODAY), '2026-10-20');
  assert.equal(clampToToday(TODAY, TODAY), TODAY);
  assert.equal(clampToToday(null, TODAY), null);
  assert.equal(clampToToday('bad', TODAY), null);
});

test('anchorDate: events and competitors use start, else deadline', () => {
  assert.equal(anchorDate({ category: 'event', start: '2026-11-01', deadline: '2026-10-20' }, TODAY), '2026-11-01');
  assert.equal(anchorDate({ category: 'competitor', deadline: '2026-10-20' }, TODAY), '2026-10-20');
  assert.equal(anchorDate({ category: 'event' }, TODAY), null);
});

test('anchorDate: competitions and funding use the earliest date still ahead', () => {
  const comp = { category: 'competition', start: '2026-11-05', deadline: '2026-10-30' };
  assert.equal(anchorDate(comp, TODAY), '2026-10-30');
  assert.equal(anchorDate({ ...comp, deadline: '2026-10-01' }, TODAY), '2026-11-05');
  assert.equal(anchorDate({ category: 'funding', start: '2026-09-01', deadline: '2026-09-30' }, TODAY), '2026-09-01');
  assert.equal(anchorDate({ category: 'funding', deadline: '2026-09-30' }, TODAY), '2026-09-30');
  assert.equal(anchorDate({ category: 'competition' }, TODAY), null);
});

test('actionDate: a future deadline for competitions and funding, otherwise the start', () => {
  const comp = { category: 'competition', start: '2026-11-05', deadline: '2026-10-30' };
  assert.equal(actionDate(comp, TODAY), '2026-10-30');
  assert.equal(actionDate({ ...comp, deadline: '2026-10-01' }, TODAY), '2026-11-05');
  assert.equal(actionDate({ category: 'funding', deadline: '2026-11-30' }, TODAY), '2026-11-30');
  assert.equal(actionDate({ category: 'event', start: '2026-11-05', deadline: '2026-10-30' }, TODAY), '2026-11-05');
  assert.equal(actionDate({ category: 'event' }, TODAY), null);
});

test('actionDate falls back to a future deadline when the start is behind, and to the past when nothing is ahead', () => {
  assert.equal(actionDate({ category: 'event', start: '2026-10-01', deadline: '2026-10-30' }, TODAY), '2026-10-30');
  assert.equal(actionDate({ category: 'event', deadline: '2026-10-30' }, TODAY), '2026-10-30');
  assert.equal(actionDate({ category: 'event', start: '2026-10-01', end: '2026-10-20' }, TODAY), '2026-10-01');
  assert.equal(actionDate({ category: 'competition', deadline: '2026-10-01' }, TODAY), '2026-10-01');
});

test('item helpers tolerate missing or malformed items', () => {
  for (const bad of [null, undefined, 42, 'x', [], { start: {} }, { deadline: 12 }]) {
    assert.doesNotThrow(() => {
      lastDate(bad); isUpcoming(bad, TODAY); isOngoing(bad, TODAY); anchorDate(bad, TODAY); actionDate(bad, TODAY);
    });
  }
});
