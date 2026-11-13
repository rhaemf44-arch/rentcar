import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const section = (start, end) => html.slice(html.indexOf(start), html.indexOf(end, html.indexOf(start)));
const code = [
  section('function koreanNow(', 'function reservationTime('),
  'function todayStr(){return koreanNow().slice(0,10)}',
  section('function dashboardDayOffset(', 'function renderDashboard('),
  section('function reservationListRows(', 'function renderReservationList('),
  section("let _lastClockMinute=", 'function paintHeaderClock('),
].join('\n');

function setup(at = '2026-11-14T02:35:00+09:00') {
  let now = Date.parse(at);
  const listeners = {};
  const ctx = vm.createContext({
    Date: class extends Date {
      constructor(...args) { super(...(args.length ? args : [now])); }
      static now() { return now; }
    },
    Intl, data: [], dashboardPeriod: 'week', dashboardMetric: 'all', renders: 0,
    document: {
      hidden: false,
      getElementById: () => ({value: '', classList: {contains: () => false}}),
      addEventListener: (event, fn) => { listeners[event] = fn; },
    },
    window: {addEventListener: (event, fn) => { listeners[event] = fn; }},
    reservationCustomerName: r => r.name || r.id,
    reservationBalance: r => r.balance ?? null,
    reservationVehicleId: r => r.vehicleId || '',
    hasConflict: () => false,
    isDriverReservation: () => false,
    pastReservation: r => r.end && r.end.slice(0, 10) < new Date(now + 9 * 3600000).toISOString().slice(0, 10),
    paintHeaderClock: () => {},
    autoReturnExpiredReservations: () => {},
    render: () => { ctx.renders++; },
  });
  vm.runInContext(code, ctx);
  return {ctx, setTime: value => { now = Date.parse(value); }, listeners};
}
const row = (id, start, end, status = 'wait') => ({id, start, end, status});
const ids = ctx => Array.from(ctx.reservationListRows(), r => r.id);

test('this week uses Korean Monday–Sunday dates across month and year boundaries', () => {
  const {ctx, setTime} = setup();
  assert.deepEqual(Array.from(ctx.dashboardRange()), ['2026-11-09', '2026-11-15']);
  setTime('2026-11-15T23:59:00+09:00');
  assert.deepEqual(Array.from(ctx.dashboardRange()), ['2026-11-09', '2026-11-15']);
  setTime('2026-11-16T00:00:00+09:00');
  assert.deepEqual(Array.from(ctx.dashboardRange()), ['2026-11-16', '2026-11-22']);
  setTime('2027-01-01T00:00:00+09:00');
  assert.deepEqual(Array.from(ctx.dashboardRange()), ['2026-12-28', '2027-01-03']);
});

test('an old pickup returning this week appears under its return date, not November 7', () => {
  const {ctx} = setup();
  ctx.data = [
    row('old-completed', '2026-11-07T09:00', '2026-11-09T20:00', 'done'),
    row('old-waiting', '2026-11-07T08:00', '2026-11-15T20:00'),
    row('new', '2026-11-14T08:00', '2026-11-20T20:00'),
    row('throughout-week', '2026-11-01T09:00', '2026-11-30T20:00', 'active'),
  ];
  const original = JSON.stringify(ctx.data);
  assert.deepEqual(ids(ctx), ['old-completed', 'new', 'old-waiting']);
  const events = Array.from(ctx.reservationListRows(), r => ({...ctx.reservationListEvent(r)}));
  assert.deepEqual(events, [
    {type: 'return', time: '2026-11-09T20:00'},
    {type: 'pickup', time: '2026-11-14T08:00'},
    {type: 'return', time: '2026-11-15T20:00'},
  ]);
  assert.equal(JSON.stringify(ctx.data), original);
});

test('today and tomorrow include actual dispatch/return days, with no overlap-only or deleted rows', () => {
  const {ctx} = setup();
  ctx.data = [
    row('today-pickup', '2026-11-14T09:00', '2026-11-17T20:00'),
    row('today-return', '2026-11-07T09:00', '2026-11-14T17:00', 'active'),
    row('tomorrow-return', '2026-11-07T09:00', '2026-11-15T20:00'),
    row('tomorrow-pickup', '2026-11-15T08:00', '2026-11-16T20:00'),
    row('overlap', '2026-11-01T08:00', '2026-11-30T20:00', 'active'),
    row('cancelled', '2026-11-14T08:00', '2026-11-14T20:00', 'cancelled'),
    {...row('deleted', '2026-11-14T08:00', '2026-11-14T20:00'), deletedAt: '2026-11-13'},
  ];
  ctx.dashboardPeriod = 'today';
  assert.deepEqual(ids(ctx), ['today-pickup', 'today-return']);
  ctx.dashboardPeriod = 'tomorrow';
  assert.deepEqual(ids(ctx), ['tomorrow-pickup', 'tomorrow-return']);
});

test('a rental with both events in the period is listed once and grouped consistently', () => {
  const {ctx} = setup();
  ctx.dashboardPeriod = 'today';
  ctx.data = [row('same-day', '2026-11-14T08:00', '2026-11-14T20:00', 'active')];
  assert.deepEqual(ids(ctx), ['same-day']);
  assert.equal(ctx.reservationListEvent(ctx.data[0]).type, 'pickup');
  ctx.dashboardMetric = 'return';
  assert.equal(ctx.reservationListEvent(ctx.data[0]).type, 'return');
  assert.equal(ctx.reservationListEvent(ctx.data[0]).time, '2026-11-14T20:00');
});

test('long running rentals remain accessible through active and all filters', () => {
  const {ctx} = setup();
  ctx.data = [row('active', '2026-11-01T08:00', '2026-11-30T20:00', 'active')];
  assert.deepEqual(ids(ctx), []);
  ctx.dashboardPeriod = 'all'; ctx.dashboardMetric = 'active';
  assert.deepEqual(ids(ctx), ['active']);
  ctx.dashboardMetric = 'all';
  assert.deepEqual(ids(ctx), ['active']);
});

test('foreground restoration and midnight refresh date filters without reloading or editing reservations', () => {
  const {ctx, setTime, listeners} = setup('2026-11-15T23:59:00+09:00');
  ctx.tick();
  assert.equal(ctx.renders, 1);
  setTime('2026-11-16T00:00:00+09:00');
  listeners.visibilitychange();
  assert.equal(ctx.renders, 2);
  assert.equal(ctx.todayStr(), '2026-11-16');
  assert.deepEqual(Array.from(ctx.dashboardRange()), ['2026-11-16', '2026-11-22']);
  listeners.pageshow();
  assert.equal(ctx.renders, 2);
  ctx.document.hidden = true;
  setTime('2026-11-17T00:00:00+09:00'); listeners.visibilitychange();
  assert.equal(ctx.renders, 2);
  ctx.document.hidden = false; listeners.pageshow();
  assert.equal(ctx.todayStr(), '2026-11-17');
  assert.equal(ctx.renders, 3);
});
