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
    Date,Intl,PLATE_MAP:{},scheduleNow:()=>Date.parse('2026-11-17T10:30:00+09:00'),
    scheduleClock:{serverTime:1},scheduleRows:()=>records,scheduleDateKey:value=>value,
    dashboardDayOffset:dayOffset,reservationVehicleId:r=>r.vehicleId,
    reservationVehicleName:r=>r.car,reservationCustomerName:r=>r.name,
    reservationBalance:r=>r.balance,moneyNumber:value=>value??null,
    normalizedLocationPair:(pickup,ret)=>({pickup,ret}),isDriverReservation:r=>r.driverService==='driver',
    koreanNow:date=>new Date(date.getTime()+9*3600000).toISOString().slice(0,16),
    scheduleRangeText:()=> '배차일시 기준 · 2026-11-17 10:30부터',
    esc:value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;'),
    toast:()=>{},window:{open:()=>({document:{write:value=>printed=value,close:()=>{}}})},
  });
  vm.runInContext(code,ctx);
  return {ctx,print:()=>{ctx.printSchedule();return printed;}};
}

test('Friday through Sunday stay together, with other days and later weekends kept in order',()=>{
  const dates=['2026-11-18','2026-11-20','2026-11-21','2026-11-22','2026-11-23','2026-11-27','2026-11-29'];
  const {ctx}=setup(dates.map((day,i)=>fixture(day,i)));
  const rows=ctx.buildSheetRows();
  const pages=ctx.schedulePrintPages(rows);
  assert.deepEqual(Array.from(pages,p=>p.weekend),['','2026-11-20','','2026-11-27']);
  assert.deepEqual(Array.from(pages,p=>p.rows.filter(Boolean).length),[1,3,1,2]);
  assert.deepEqual(Array.from(pages).flatMap(p=>Array.from(p.rows).filter(Boolean).map(r=>r.배차일)),dates);
  const yearEnd=setup(['2027-01-01','2027-01-02','2027-01-03'].map((day,i)=>fixture(day,i)));
  assert.equal(yearEnd.ctx.schedulePrintPages(yearEnd.ctx.buildSheetRows()).length,1);
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
  assert.match(output,/11\.20\(금\) ~ 11\.22\(일\)/);
  assert.match(output,/300,000원/);
  assert.match(output,/0원 \(완납\)/);
  assert.doesNotMatch(output,/미확인|undefined|NaN/);
  assert.match(output,/beforeprint',fitWeekendPages/);
  assert.match(output,/document\.fonts\.ready/);
});

if(process.env.PRINT_PREVIEW_PATH){
  const records=[];
  for(const [day,count] of [['2026-11-20',5],['2026-11-21',11],['2026-11-22',6]]){
    for(let index=0;index<count;index++)records.push(fixture(day,index,{driverService:index===10?'driver':'self'}));
  }
  writeFileSync(process.env.PRINT_PREVIEW_PATH,setup(records).print());
}
