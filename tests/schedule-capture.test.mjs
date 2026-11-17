import test from 'node:test';
import assert from 'node:assert/strict';
import capture from '../schedule-capture.js';
const {PHONE_PROFILES,packCaptureRows,renderCaptureRow}=capture;

test('phone page ratios match the iPhone, S21 and both Fold7 screen rectangles',()=>{
  assert.deepEqual(Object.keys(PHONE_PROFILES),['iphone17pro','galaxy-s21','fold7-cover','fold7-open']);
  for(const profile of Object.values(PHONE_PROFILES)){
    assert.equal(profile.width/profile.height,profile.pixels[0]/profile.pixels[1]);
    assert(profile.width>=360);assert(profile.height>profile.width);
  }
});

test('capture pagination keeps every reservation in order without changing its financial fields',()=>{
  const rows=Array.from({length:8},(_,i)=>({id:i,height:160,total:300000,paid:i===3?null:0,balance:300000}));
  const before=JSON.stringify(rows);
  const pages=packCaptureRows(rows,page=>page.reduce((sum,row)=>sum+row.height,80)<=874,()=>assert.fail('ordinary rows must not be reduced'));
  assert.deepEqual(pages.map(page=>page.length),[4,4]);
  assert.deepEqual(pages.flat().map(row=>row.id),rows.map(row=>row.id));assert.equal(JSON.stringify(rows),before);
});

test('an unusually long address moves to its own page and is fitted without dropping the reservation',()=>{
  const rows=[{id:1,height:160},{id:2,height:1200},{id:3,height:160}],fitted=[];
  const pages=packCaptureRows(rows,page=>page.reduce((sum,row)=>sum+row.height,80)<=800,row=>{fitted.push(row.id);row.height=720});
  assert.deepEqual(pages.map(page=>page.map(row=>row.id)),[[1],[2],[3]]);assert.deepEqual(fitted,[2]);
});

test('phone rows preserve both locations, driver marking and blank versus zero amounts while escaping text',()=>{
  const html=renderCaptureRow({차량:'쏠라티 <검수>',차량번호:'702호1265',임차인명:'검수 & 고객',임차인연락처:'',대여예정일시:'11.20 07:00',반납예정일시:'11.21 20:00',배차:'배차 <장소>',회차:'반납 & 장소',인쇄장소Html:'<b class="driver-mark">[운행기사]</b>',총금액:null,계약금:0,잔금:0},0);
  assert.match(html,/capture-row solati/);assert.match(html,/쏠라티 &lt;검수&gt;/);assert.match(html,/검수 &amp; 고객/);
  assert.match(html,/\[운행기사\] 배차 &lt;장소&gt;/);assert.match(html,/반납 &amp; 장소/);
  assert.match(html,/<span>총금액<\/span><b><\/b>/);assert.match(html,/<span>계약금<\/span><b>0원<\/b>/);assert.match(html,/0원 \(완납\)/);
  assert.doesNotMatch(html,/undefined|NaN|미확인/);
});
