import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const section=(start,end)=>html.slice(html.indexOf(start),html.indexOf(end,html.indexOf(start)));
const code=section('function koreanNow(', 'function moneyNumber(')+
  section('const autoReturnState=', '/* 개발 점검용: 화면 너비별');
const at=Date.parse('2026-11-14T02:47:00+09:00');
const rental=(id,extra={})=>({id,status:'active',start:'2026-11-10T06:00',end:'2026-11-11T20:00',total:300000,paid:100000,memo:'보존할 메모',...extra});
const copy=value=>JSON.parse(JSON.stringify(value));

function setup(records=[rental('expired')]){
  const remote=new Map(records.map(r=>[r.id,copy(r)])),writes=[],messages=[];
  let elapsed=1000,fail=false,beforeRead=null;
  const ctx=vm.createContext({
    Date,Intl,Number,console:{error(){}},performance:{now:()=>elapsed},
    data:copy(records),_firestoreReady:true,_currentUser:{uid:'test-device'},
    _pendingWrites:{},editId:null,editingCell:null,mSheetEditing:false,document:{hidden:false,getElementById:()=>({classList:{contains:()=>true}})},
    scheduleClock:{serverTime:at,sampledAt:1000},scheduleNow:()=>at,
    syncScheduleClock:async()=>{},toast:message=>messages.push(message),
    RESERVATIONS_COL:'reservations',
    db:{collection:()=>({doc:id=>({id})}),runTransaction:async callback=>{
      if(fail)throw {code:'unavailable'};
      const staged=[];
      const result=await callback({
        get:async ref=>{if(beforeRead)await beforeRead(ref);const value=remote.get(ref.id);return{exists:!!value,data:()=>copy(value)}},
        update:(ref,patch)=>staged.push({id:ref.id,patch:copy(patch)}),
      });
      for(const {id,patch} of staged){remote.set(id,{...remote.get(id),...patch});writes.push({id,patch})}
      return result;
    }},
  });
  vm.runInContext(code,ctx);
  return{ctx,remote,writes,messages,setElapsed:n=>elapsed=n,setFail:v=>fail=v,onRead:fn=>beforeRead=fn};
}

test('only due active rentals become done, preserving financial and reservation fields',async()=>{
  const s=setup([
    rental('expired'),rental('boundary',{end:'2026-11-14T02:47'}),
    rental('future',{end:'2026-11-14T03:00'}),rental('wait',{status:'wait'}),
    rental('cancelled',{status:'cancelled'}),rental('done',{status:'done'}),
    rental('deleted',{deletedAt:'2026-11-13'}),rental('invalid',{end:'2026-02-30T20:00'}),
    rental('reversed',{start:'2026-11-13T09:00'}),rental('missing',{end:''}),
  ]);
  await s.ctx.autoReturnExpiredReservations();
  assert.deepEqual(s.writes.map(x=>x.id),['expired','boundary']);
  const result=s.remote.get('expired');
  assert.equal(result.status,'done');
  assert.equal(result.returnedAt,new Date(at).toISOString());
  assert.equal(s.ctx.isAutoReturned(result),true);
  for(const field of ['start','end','total','paid','memo'])assert.equal(result[field],rental('expired')[field]);
  assert.equal(s.ctx.data[0].status,'active','local display waits for the authoritative snapshot');
  await s.ctx.autoReturnExpiredReservations();
  assert.equal(s.writes.length,2,'stale local data cannot complete a server record twice');
});

test('server extensions, cancellations, deletions and another device completion are respected',async()=>{
  const s=setup(['extend','cancel','delete','complete','gone'].map(id=>rental(id)));
  s.remote.get('extend').end='2026-11-15T20:00';
  s.remote.get('cancel').status='cancelled';
  s.remote.get('delete').deletedAt='2026-11-14';
  s.remote.get('complete').status='done';
  s.remote.delete('gone');
  await s.ctx.autoReturnExpiredReservations();
  assert.equal(s.writes.length,0);
});

test('pending edits and open date editors are skipped, including edits begun during a read',async()=>{
  const s=setup(['pending','form','cell','racing'].map(id=>rental(id)));
  s.ctx._pendingWrites.pending={patch:{end:'2026-11-15T20:00'}};
  s.ctx.editId='form';s.ctx.editingCell={dataset:{id:'cell'}};
  s.onRead(ref=>{if(ref.id==='racing')s.ctx._pendingWrites.racing={patch:{end:'2026-11-15T20:00'}}});
  await s.ctx.autoReturnExpiredReservations();
  assert.equal(s.writes.length,0);
});

test('offline, signed out, hidden, unverified or stale clock never changes a status',async()=>{
  for(const change of [s=>s.ctx._firestoreReady=false,s=>s.ctx._currentUser=null,
    s=>s.ctx.document.hidden=true,s=>s.ctx.scheduleClock.serverTime=null,s=>s.setElapsed(602000)]){
    const s=setup();change(s);await s.ctx.autoReturnExpiredReservations();assert.equal(s.writes.length,0);
  }
  const s=setup();s.onRead(()=>{s.ctx._currentUser=null});
  await s.ctx.autoReturnExpiredReservations();assert.equal(s.writes.length,0);
});

test('a previously opened but now hidden form does not block automatic returns',async()=>{
  const s=setup();s.ctx.editId='expired';
  s.ctx.document.getElementById=()=>({classList:{contains:()=>false}});
  await s.ctx.autoReturnExpiredReservations();assert.equal(s.writes.length,1);
});

test('failed writes remain active and retry after recovery without duplicate writes',async()=>{
  const s=setup();s.setFail(true);
  await s.ctx.autoReturnExpiredReservations();assert.equal(s.remote.get('expired').status,'active');
  assert(s.messages.some(x=>x.includes('저장 실패')));
  s.setFail(false);await s.ctx.autoReturnExpiredReservations();assert.equal(s.writes.length,0);
  s.setElapsed(31001);await s.ctx.autoReturnExpiredReservations();assert.equal(s.writes.length,1);
});

test('concurrent invocations share one pass; transaction retries recheck the latest return time',async()=>{
  const s=setup();let release;const blocked=new Promise(r=>release=r);
  s.onRead(()=>blocked);
  const first=s.ctx.autoReturnExpiredReservations();
  await s.ctx.autoReturnExpiredReservations();release();await first;
  assert.equal(s.writes.length,1);
  const retry=setup();let attempts=0;
  retry.ctx.db.runTransaction=async callback=>{
    const ref={id:'expired'};
    const transaction={get:async()=>({exists:true,data:()=>copy(retry.remote.get(ref.id))}),update:()=>attempts++};
    await callback(transaction); // Simulate Firestore discarding a conflicted attempt.
    retry.remote.get(ref.id).end='2026-11-15T20:00';
    return callback(transaction);
  };
  await retry.ctx.autoReturnExpiredReservations();
  assert.equal(attempts,1);assert.equal(retry.remote.get('expired').status,'active');
  assert(!retry.messages.some(x=>x.includes('자동 반납 처리했습니다')));
});
