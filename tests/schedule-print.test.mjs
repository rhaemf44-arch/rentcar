import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, writeFileSync} from 'node:fs';
import vm from 'node:vm';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const section=(start,end)=>html.slice(html.indexOf(start),html.indexOf(end,html.indexOf(start)));
const code=section('function fmtSheetDT(', 'function exportScheduleExcel(')+
  section('function printSchedule(', 'function exportExcel(');
const dayOffset=(day,offset)=>{
  const date=new Date(day+'T00:00:00Z');
  date.setUTCDate(date.getUTCDate()+offset);
  return date.toISOString().slice(0,10);
};
const fixture=(day,index,extra={})=>({
  id:day+'-'+index,start:day+'T08:00',end:dayOffset(day,1)+'T20:00',
  car:index%3===0?'쏠라티':'스타리아 11인승',vehicleId:'TEST-'+index,
  name:'검수 '+String(index+1).padStart(2,'0'),phone:'',pickup:'대구광역시 동구 신암남로 146 1층 경일렌트카',
  ret:'대구광역시 수성구 화랑로 100 주차장',total:300000,paid:100000,balance:200000,
  ...extra,
});
function setup(records){
  let printed='';
  const ctx=vm.createContext({
    Date,Intl,URL,location:{href:'http://127.0.0.1:4173/'},PLATE_MAP:{},scheduleNow:()=>Date.parse('2026-11-17T10:30:00+09:00'),
    scheduleClock:{serverTime:1},scheduleRows:()=>records,scheduleDateKey:value=>value,
    dashboardDayOffset:dayOffset,reservationVehicleId:r=>r.vehicleId,
    reservationVehicleName:r=>r.car,reservationCustomerName:r=>r.name,
    reservationBalance:r=>r.balance,moneyNumber:value=>value??null,
    reservationBookingOwner:r=>records.find(record=>record.id===r.bookingId),recordPaymentBalance:r=>r.balance,
    normalizedLocationPair:(pickup,ret)=>({pickup,ret}),isDriverReservation:r=>r.driverService==='driver',
    koreanNow:date=>new Date(date.getTime()+9*3600000).toISOString().slice(0,16),
    scheduleRangeText:()=> '배차일시 기준 · 2026-11-17 10:30부터',
    esc:value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;'),
    toast:()=>{},window:{open:()=>({document:{write:value=>printed=value,close:()=>{}}})},
  });
  vm.runInContext(code,ctx);
  return {ctx,print:(mode)=>{ctx.printSchedule(mode);return printed;}};
}

test('Friday through Sunday stay together, with other days and later weekends kept in order',()=>{
  const dates=['2026-11-18','2026-11-20','2026-11-21','2026-11-22','2026-11-23','2026-11-27','2026-11-29'];
  const {ctx}=setup(dates.map((day,i)=>fixture(day,i)));
  const rows=ctx.buildSheetRows();
  const groups=ctx.schedulePrintGroups(rows);
  assert.deepEqual(Array.from(groups,g=>g.weekend),['','2026-11-20','','2026-11-27']);
  assert.deepEqual(Array.from(groups,g=>g.rows.filter(Boolean).length),[1,3,1,2]);
  assert.deepEqual(Array.from(groups).flatMap(g=>Array.from(g.rows).filter(Boolean).map(r=>r.배차일)),dates);
  const yearEnd=setup(['2027-01-01','2027-01-02','2027-01-03'].map((day,i)=>fixture(day,i)));
  assert.equal(yearEnd.ctx.schedulePrintGroups(yearEnd.ctx.buildSheetRows()).length,1);
});

const weightedUnits=(weekdayCount,weekendHeight)=>[
  ...Array.from({length:weekdayCount},(_,i)=>({id:'weekday-'+i,height:10})),
  {id:'Fri-Sun',height:weekendHeight,weekend:true},
];
function pack(units,capacity){
  const {ctx}=setup([]),resized=[];
  const pages=ctx.packSchedulePrintUnits(units,items=>items.reduce((sum,item)=>sum+item.height,5)<=capacity,unit=>{
    resized.push(unit.id);unit.height=capacity-5;
  });
  return {pages:Array.from(pages,p=>Array.from(p,u=>u.id)),resized};
}

test('a Monday through Sunday schedule stays on one page when it fits',()=>{
  const {pages,resized}=pack(weightedUnits(4,45),90);
  assert.deepEqual(pages,[['weekday-0','weekday-1','weekday-2','weekday-3','Fri-Sun']]);
  assert.deepEqual(resized,[]);
});

test('only an overflowing weekend moves to the next page, without splitting or shrinking it',()=>{
  const {pages,resized}=pack(weightedUnits(4,46),90);
  assert.deepEqual(pages,[['weekday-0','weekday-1','weekday-2','weekday-3'],['Fri-Sun']]);
  assert.deepEqual(resized,[]);
});

test('weekday overflow fills successive pages and later reservations reuse the space after a weekend',()=>{
  const units=[...weightedUnits(9,20),{id:'Monday-next',height:10}];
  const {pages,resized}=pack(units,55);
  assert.deepEqual(pages,[['weekday-0','weekday-1','weekday-2','weekday-3','weekday-4'],['weekday-5','weekday-6','weekday-7','weekday-8'],['Fri-Sun','Monday-next']]);
  assert.equal(pages.flat().length,units.length);
  assert.deepEqual(resized,[]);
});

test('a weekend taller than a whole sheet is fitted only after moving it to a fresh page',()=>{
  const {pages,resized}=pack(weightedUnits(2,100),90);
  assert.deepEqual(pages,[['weekday-0','weekday-1'],['Fri-Sun']]);
  assert.deepEqual(resized,['Fri-Sun']);
  assert.deepEqual(pack([],90).pages,[]);
});

test('the yellow class covers the complete Solati row and print fitting preserves all cells and amounts',()=>{
  const records=[fixture('2026-11-20',0),fixture('2026-11-21',1,{total:null,paid:null,balance:null}),fixture('2026-11-22',2,{balance:0})];
  const output=setup(records).print();
  assert.match(output,/@page\{size:A4 landscape;margin:8mm\}/);
  assert.match(output,/tr\.solati>td\{background-color:#ffeb3b/);
  const yellow=output.match(/<tr class="dstart solati">([\s\S]*?)<\/tr>/);
  assert(yellow);
  assert.equal((yellow[1].match(/<td(?:\s|>)/g)||[]).length,10);
  assert.match(output,/data-weekend="2026-11-20"/);
  assert.match(output,/data-first-day="2026-11-20" data-last-day="2026-11-22"/);
  assert.match(output,/300,000원/);
  assert.match(output,/0원 \(완납\)/);
  assert.doesNotMatch(output,/미확인|undefined|NaN/);
  assert.match(output,/beforeprint',paginateSchedule/);
  assert.match(output,/document\.fonts\.ready/);
  assert.doesNotMatch(output,/weekend-page|\n\s*\.print-page\{[^}]*break-before/);
  assert.doesNotMatch(output,/\.weekend-group\{[^}]*height:/);
});

test('the on-screen schedule remains one full-width table with one heading across weekdays and weekends',()=>{
  const dates=['2026-11-18','2026-11-20','2026-11-21','2026-11-22','2026-11-23'];
  const output=setup(dates.map((day,i)=>fixture(day,i))).print();
  const screen=output.match(/<div class="screen-sheet">([\s\S]*?)<template id="print-source">/)[1];
  assert.equal((screen.match(/<h1>/g)||[]).length,1);
  assert.equal((screen.match(/<table>/g)||[]).length,1);
  assert.equal((screen.match(/class="vehicle"/g)||[]).length,5);
  assert.match(screen,/총 5건/);
  assert.match(output,/\.screen-sheet\{width:100%\}/);
  assert.match(output,/\.print-sheets,\.print-measure\{[^}]*visibility:hidden/);
  assert.match(output,/@media print\{[\s\S]*\.screen-sheet\{display:none\}/);
});

test('a booking shares matching cells and one combined payment while differing return times stay separate',()=>{
  const day='2026-11-23',common={bookingId:'group-a',name:'묶음 예약',phone:'010-0000-0123'};
  const output=setup([
    fixture(day,0,{...common,id:'group-a',car:'검수 차량 1'}),
    fixture(day,2,{car:'별도 예약 차량'}),
    fixture(day,1,{...common,car:'검수 차량 2',end:'2026-11-24T21:00'}),
  ]).print();
  const screen=output.match(/<div class="screen-sheet">([\s\S]*?)<template id="print-source">/)[1];
  assert.match(screen,/rowspan="2">11\.23 08:00\(월\)/);
  assert.match(screen,/rowspan="2">묶음 예약/);
  assert.match(screen,/rowspan="2">010\.0000\.0123/);
  assert.match(screen,/rowspan="2">300,000원/);
  assert.match(screen,/<td>11\.24 20:00<\/td>/);
  assert.match(screen,/<td>11\.24 21:00<\/td>/);
  assert.match(screen,/검수 차량 1[\s\S]*검수 차량 2[\s\S]*별도 예약 차량/);
  const units=Array.from(output.matchAll(/<tbody class="print-group"[^>]*>([\s\S]*?)<\/tbody>/g));
  assert.equal(units.length,2);
  assert.match(units[0][1],/검수 차량 1[\s\S]*검수 차량 2/);
});

test('legacy rows share matching renter information without collapsing separately recorded prices',()=>{
  const day='2026-11-23',common={name:'기존 예약',phone:'010-0000-0456'};
  const output=setup([
    fixture(day,0,{...common,car:'기존 차량 1',total:350000}),
    fixture(day,1,{...common,car:'기존 차량 2',total:360000}),
    fixture(day,2,{...common,car:'다른 연락처 차량',phone:'010-0000-0789'}),
  ]).print();
  const screen=output.match(/<div class="screen-sheet">([\s\S]*?)<template id="print-source">/)[1];
  assert.equal((screen.match(/rowspan="2">기존 예약/g)||[]).length,1);
  assert.match(screen,/기존 차량 1[\s\S]*<td class="money">350,000원<\/td>/);
  assert.match(screen,/기존 차량 2[\s\S]*<td class="money">360,000원<\/td>/);
  assert.match(screen,/<td>010\.0000\.0789<\/td>/);
});

test('phone capture opens with all source records and safe JSON, without automatic A4 printing',()=>{
  const output=setup([fixture('2026-11-20',0,{car:'차량 </script><img src=x>'}),fixture('2026-11-21',1,{total:null,paid:0,balance:null})]).print('capture');
  const json=output.match(/<script type="application\/json" id="schedule-capture-config">([\s\S]*?)<\/script>/)[1];
  const config=JSON.parse(json);assert.equal(config.mode,'capture');assert.equal(config.rows.length,2);
  assert.equal(config.rows[0].차량,'차량 </script><img src=x>');assert.equal(config.rows[1].총금액,null);assert.equal(config.rows[1].계약금,0);
  assert.doesNotMatch(json,/<\/script>|<img/);assert.match(output,/http:\/\/127\.0\.0\.1:4173\/schedule-capture\.js\?v=/);
  assert.doesNotMatch(output,/setTimeout\(\(\)=>window\.print\(\),400\)/);
});

if(process.env.PRINT_PREVIEW_PATH){
  const records=[];
  const scenario=process.env.PRINT_PREVIEW_SCENARIO;
  const counts=scenario==='week-fit'?Array.from({length:7},(_,index)=>[dayOffset('2026-11-16',index),1]):[
    ...(scenario==='week-overflow'?[['2026-11-16',2],['2026-11-17',2],['2026-11-18',2],['2026-11-19',2]]:[]),
    ['2026-11-20',5],['2026-11-21',11],['2026-11-22',6],
  ];
  for(const [day,count] of counts){
    for(let index=0;index<count;index++)records.push(fixture(day,index,{driverService:index===10?'driver':'self'}));
  }
  writeFileSync(process.env.PRINT_PREVIEW_PATH,setup(records).print(process.env.PRINT_PREVIEW_MODE));
}
