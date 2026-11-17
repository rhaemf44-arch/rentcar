import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const section = (start, end) => html.slice(html.indexOf(start), html.indexOf(end, html.indexOf(start)));
const code = [
  section('function koreanNow(', 'function moneyNumber('),
  section('function scheduleDateKey(', 'function scheduleRows('),
  section('function pastReservation(', 'function renderPast('),
  'function todayStr(){return koreanNow().slice(0,10)}',
  section('function dashboardDayOffset(', 'function renderDashboard('),
  section('function reservationListRows(', 'function renderReservationList('),
  section('function updateDashboardStats(', 'function render(){'),
  section("let _lastClockMinute=", 'function paintHeaderClock('),
].join('\n');

function setup(at = '2026-11-14T02:35:00+09:00') {
  let now = Date.parse(at);
  const listeners = {};
  const elements = new Map();
  const ctx = vm.createContext({
    Date: class extends Date {
      constructor(...args) { super(...(args.length ? args : [now])); }
      static now() { return now; }
    },
    Intl, data: [], PLATE_MAP: {}, dashboardPeriod: 'week', dashboardMetric: 'all', renders: 0,
    document: {
      hidden: false,
      getElementById: id => {if(!elements.has(id))elements.set(id,{value:'',classList:{contains:()=>false}});return elements.get(id)},
      querySelectorAll: () => [],
      addEventListener: (event, fn) => { listeners[event] = fn; },
    },
    window: {addEventListener: (event, fn) => { listeners[event] = fn; }},
    reservationCustomerName: r => r.name || r.id,
    reservationBalance: r => r.balance ?? null,
    reservationVehicleId: r => r.vehicleId || '',
    hasConflict: () => false,
    isDriverReservation: () => false,
    scheduleNow: () => now,
    paintHeaderClock: () => {},
    autoReturnExpiredReservations: () => {},
    render: () => { ctx.renders++; },
  });
  vm.runInContext(code, ctx);
  return {ctx, setTime: value => { now = Date.parse(value); }, listeners, elements};
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

test('ordinary reservation periods hide past pickup dates even when the rental returns later', () => {
  const {ctx} = setup();
  ctx.data = [
    row('old-completed', '2026-11-07T09:00', '2026-11-09T20:00', 'done'),
    row('old-waiting', '2026-11-07T08:00', '2026-11-15T20:00'),
    row('new', '2026-11-14T08:00', '2026-11-20T20:00'),
    row('throughout-week', '2026-11-01T09:00', '2026-11-30T20:00', 'active'),
  ];
  const original = JSON.stringify(ctx.data);
  assert.deepEqual(ids(ctx), ['new']);
  const events = Array.from(ctx.reservationListRows(), r => ({...ctx.reservationListEvent(r)}));
  assert.deepEqual(events, [
    {type: 'pickup', time: '2026-11-14T08:00'},
  ]);
  ctx.dashboardPeriod='upcoming';assert.deepEqual(ids(ctx),['new']);
  ctx.dashboardPeriod='all';assert.deepEqual(ids(ctx),['new']);
  assert.deepEqual(ctx.data.filter(r=>ctx.pastReservationForDisplay(r)).map(r=>r.id),['old-completed','old-waiting','throughout-week']);
  assert.equal(JSON.stringify(ctx.data), original);
});

test('today and tomorrow hide earlier pickups while the explicit return filter keeps return work accessible', () => {
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
  assert.deepEqual(ids(ctx), ['today-pickup']);
  ctx.dashboardPeriod = 'tomorrow';
  assert.deepEqual(ids(ctx), ['tomorrow-pickup']);
  ctx.dashboardPeriod='today';ctx.dashboardMetric='return';
  assert.deepEqual(ids(ctx),['today-return']);
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

test('earlier pickups remain accessible through operational filters and the past view without changing their status', () => {
  const {ctx} = setup();
  ctx.data = [row('active', '2026-11-01T08:00', '2026-11-30T20:00', 'active')];
  assert.deepEqual(ids(ctx), []);
  ctx.dashboardPeriod = 'all'; ctx.dashboardMetric = 'active';
  assert.deepEqual(ids(ctx), ['active']);
  ctx.dashboardMetric = 'all';
  assert.deepEqual(ids(ctx), []);
  assert.equal(ctx.pastReservationForDisplay(ctx.data[0]),true);
  assert.equal(ctx.pastReservation(ctx.data[0],ctx.todayStr()),false,'a past pickup does not mean the vehicle has returned');
  ctx.data[0].balance=350000;ctx.dashboardMetric='unpaid';
  assert.deepEqual(ids(ctx),['active']);
  assert.equal(ctx.data[0].status,'active');
});

test('expired waiting rentals disappear from upcoming and unassigned filters at their return time', () => {
  const {ctx, setTime} = setup('2026-11-16T22:48:00+09:00');
  ctx.data = [
    row('old-waiting', '2026-11-07T08:00', '2026-11-15T20:00'),
    row('today-waiting', '2026-11-16T08:00', '2026-11-16T22:00'),
    row('today-active', '2026-11-16T08:00', '2026-11-16T22:00', 'active'),
    row('upcoming', '2026-11-17T08:00', '2026-11-18T20:00'),
    row('returning', '2026-11-16T08:00', '2026-11-16T23:00', 'active'),
  ];
  ctx.dashboardPeriod = 'upcoming';
  assert.deepEqual(ids(ctx), ['returning', 'upcoming']);
  ctx.dashboardMetric = 'unassigned'; ctx.dashboardPeriod = 'all';
  assert.deepEqual(ids(ctx), ['returning', 'upcoming']);
  ctx.dashboardMetric = 'active';
  assert.deepEqual(ids(ctx), ['returning']);
  assert.equal(ctx.pastReservation(ctx.data[1], ctx.todayStr()), true);
  assert.equal(ctx.dashboardAttentionReasons(ctx.data[0]).length, 0);
  setTime('2026-11-16T23:00:00+09:00');
  assert.deepEqual(ids(ctx), []);
  ctx.dashboardMetric = 'unassigned';
  assert.deepEqual(ids(ctx), ['upcoming']);
  ctx.dashboardMetric = 'all';
  assert.equal(ids(ctx).length, 4, 'ordinary all hides old pickup dates');
  assert.equal(ctx.data.length,5,'display filtering preserves every reservation');
});

test('Korean pickup dates and midnight rollover update the list and both navigation counts without writes',()=>{
  const {ctx,setTime,elements}=setup('2026-11-17T23:59:00+09:00');
  ctx.dashboardPeriod='upcoming';
  ctx.data=[
    row('old','2026-11-16T08:00','2026-11-19T20:00'),
    row('today','2026-11-17T08:00','2026-11-19T20:00'),
    row('tomorrow','2026-11-18T08:00','2026-11-19T20:00'),
    row('korean-tomorrow','2026-11-17T15:30:00Z','2026-11-19T20:00'),
  ];
  const before=JSON.stringify(ctx.data);
  assert.deepEqual(ids(ctx),['today','korean-tomorrow','tomorrow']);
  ctx.updateDashboardStats();assert.equal(elements.get('nav-res').textContent,3);assert.equal(elements.get('nav-past').textContent,1);
  setTime('2026-11-18T00:00:00+09:00');
  assert.deepEqual(ids(ctx),['korean-tomorrow','tomorrow']);
  ctx.updateDashboardStats();assert.equal(elements.get('nav-res').textContent,2);assert.equal(elements.get('nav-past').textContent,2);
  assert.equal(JSON.stringify(ctx.data),before);
});

test('missing or invalid pickup dates remain visible for review and deleted records stay excluded',()=>{
  const {ctx}=setup('2026-11-17T18:46:00+09:00');
  ctx.dashboardPeriod='upcoming';ctx.data=[row('missing','','2026-11-19T20:00'),row('invalid','2026-02-30T09:00','2026-11-19T20:00'),{...row('deleted','2026-11-18T09:00','2026-11-19T20:00'),deletedAt:'2026-11-17'}];
  assert.deepEqual(ids(ctx),['missing','invalid']);
  assert.equal(ctx.pastReservationForDisplay(ctx.data[2]),false);
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
