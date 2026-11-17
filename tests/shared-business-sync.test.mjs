import test from 'node:test';
import assert from 'node:assert/strict';
import sync from '../shared-business-sync.js';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const {SharedCatalogSync}=sync;
const copy=value=>JSON.parse(JSON.stringify(value));
const vehicle=(id,n='카니발 9인승',extra={})=>({id,n,seat:'9인승',fuel:'하이브리드',base:'카니발',deletedAt:null,...extra});
const memory=()=>({values:new Map(),fail:false,getItem(key){return this.values.get(key)||null},setItem(key,value){if(this.fail)throw Error('quota');this.values.set(key,value)}});
class Backend{
  constructor(){this.rows=new Map();this.listeners=new Set();this.writes=[];this.denied=new Set();this.cached=false;this.beforeSet=null;this.serial=Promise.resolve()}
  seed(collection,rows){for(const row of rows)this.rows.set(collection+'/'+row.id,copy(row))}
  emit(){for(const listener of this.listeners)this.send(listener)}
  send(listener){
    if(this.denied.has(listener.collection)){listener.error({code:'permission-denied'});return}
    const rows=[...this.rows].filter(([path])=>path.startsWith(listener.collection+'/'));
    listener.callback({metadata:{fromCache:this.cached,hasPendingWrites:false},forEach:callback=>rows.forEach(([path,row])=>callback({id:path.split('/')[1],data:()=>copy(row)}))});
  }
  db(){
    const backend=this;
    return{
      collection(collection){
        const query={
          orderBy(){return query},limit(){return query},
          doc(id){const ref={path:collection+'/'+id,id};return{...ref,async set(patch,options){if(backend.beforeSet)await backend.beforeSet(ref,patch);if(backend.denied.has(collection))throw{code:'permission-denied'};backend.commit([{ref,patch,merge:options?.merge}])}}},
          onSnapshot(options,callback,error){const listener={collection,callback,error};backend.listeners.add(listener);queueMicrotask(()=>{if(backend.listeners.has(listener))backend.send(listener)});return()=>backend.listeners.delete(listener)},
        };return query;
      },
      runTransaction(callback){
        const execute=async()=>{
          const writes=[];let writing=false;
          const result=await callback({
            async get(ref){assert.equal(writing,false,'all reads must precede writes');if(backend.denied.has(ref.path.split('/')[0]))throw{code:'permission-denied'};const row=backend.rows.get(ref.path);return{exists:row!==undefined,data:()=>copy(row)}},
            set(ref,patch,options){writing=true;writes.push({ref,patch,merge:options?.merge})},
          });
          backend.commit(writes);return result;
        };
        const result=backend.serial.then(execute);backend.serial=result.catch(()=>{});return result;
      },
    };
  }
  commit(writes){
    for(const write of writes){const {ref,patch,merge}=write;this.rows.set(ref.path,{...(merge?this.rows.get(ref.path)||{}:{}),...copy(patch)});this.writes.push({path:ref.path,patch:copy(patch)})}
    if(writes.length)queueMicrotask(()=>this.emit());
  }
}
function client(backend,seeds,extra={}){
  const states=[],views=[],storage=extra.storage||memory();let next=0;
  const instance=new SharedCatalogSync({db:backend.db(),storage,storageKey:'fleet-cache',collection:'vehicles',backupCollection:'vehicleMigrations',keepLegacy:true,
    seedRows:seeds,validate:row=>typeof row.n==='string'&&row.n.length>0,
    now:()=> '2026-11-17T06:00:00.000Z',token:()=> 'mutation-'+(++next),
    onState:state=>states.push(copy(state)),onRecords:rows=>views.push(copy(rows)),...extra});
  return{instance,states,views,storage,active:()=>instance.snapshot().filter(row=>!row.deletedAt)};
}
async function settle(...clients){
  for(let pass=0;pass<10;pass++){
    await Promise.resolve();
    await Promise.all(clients.map(c=>c.instance.flushing||Promise.resolve()));
    await new Promise(resolve=>setImmediate(resolve));
    if(clients.every(c=>!c.instance.flushing))return;
  }
  throw Error('sync did not settle');
}

test('two existing computers merge their local-only fleet into the same server without losing 1504',async()=>{
  const backend=new Backend();
  const a=client(backend,[vehicle('103호1504'),vehicle('103호4722')]);
  const b=client(backend,[vehicle('127호2904')]);
  a.instance.start({uid:'device-a'});b.instance.start({uid:'device-b'});await settle(a,b);
  const expected=['103호1504','103호4722','127호2904'];
  assert.deepEqual(a.active().map(row=>row.id).sort(),expected);
  assert.deepEqual(b.active().map(row=>row.id).sort(),expected);
  assert.equal(backend.rows.get('vehicleMigrations/device-a').rows.length,2);
  assert.equal(backend.rows.get('vehicleMigrations/device-b').rows.length,1);
  assert.equal(a.states.at(-1).status,'saved');assert.equal(b.states.at(-1).status,'saved');
});

test('legacy migration preserves server renames, deletions and unrelated vehicles',async()=>{
  const backend=new Backend();backend.seed('vehicles',[vehicle('103호1504','수정된 차종'),vehicle('103호4722','삭제된 차량',{deletedAt:'2026-11-16'}),vehicle('127호2904')]);
  const old=client(backend,[vehicle('103호1504','이전 차종'),vehicle('103호4722')]);old.instance.start({uid:'old-device'});await settle(old);
  assert.equal(backend.rows.get('vehicles/103호1504').n,'수정된 차종');
  assert.equal(backend.rows.get('vehicles/103호4722').deletedAt,'2026-11-16');
  assert.equal(old.active().length,2);
  assert.equal(backend.rows.get('vehicleMigrations/old-device').rows[0].n,'이전 차종');
});

test('a deletion propagates and an old computer cannot resurrect the removed vehicle',async()=>{
  const backend=new Backend(),a=client(backend,[vehicle('103호1504')]),b=client(backend,[]);
  a.instance.start({uid:'a'});b.instance.start({uid:'b'});await settle(a,b);
  a.instance.queue('103호1504',{deletedAt:'2026-11-17'},vehicle('103호1504'));await settle(a,b);
  const stale=client(backend,[vehicle('103호1504')]);stale.instance.start({uid:'stale'});await settle(a,b,stale);
  for(const c of [a,b,stale])assert.equal(c.active().length,0);
  assert.equal(backend.writes.filter(w=>w.path==='vehicles/103호1504'&&w.patch.deletedAt===null).length,1);
});

test('first-device deletions of default vehicles become tombstones only on a confirmed empty server',async()=>{
  const backend=new Backend(),c=client(backend,[vehicle('103호1504')],{emptyServerRows:[vehicle('127호2904','기본 차량',{deletedAt:'legacy-deletion'})]});
  c.instance.start({uid:'first'});await settle(c);
  assert.equal(backend.rows.get('vehicles/127호2904').deletedAt,'legacy-deletion');
  const other=client(backend,[vehicle('127호2904')]);other.instance.start({uid:'later'});await settle(c,other);
  assert.equal(other.active().length,1);
});

test('offline edits survive a reload and merge only changed fields with other devices',async()=>{
  const backend=new Backend();backend.seed('vehicles',[vehicle('103호1504')]);
  const c=client(backend,[]);c.instance.start({uid:'a'});await settle(c);
  c.instance.stop();c.instance.queue('103호1504',{n:'새 차종명'});
  backend.rows.get('vehicles/103호1504').fuel='디젤';
  const reloaded=client(backend,[],{storage:c.storage});reloaded.instance.start({uid:'a'});await settle(reloaded);
  const saved=backend.rows.get('vehicles/103호1504');assert.equal(saved.n,'새 차종명');assert.equal(saved.fuel,'디젤');
  assert.equal(Object.keys(reloaded.instance.pending).length,0);
});

test('an edit made while the previous write is awaiting acknowledgement is not dropped',async()=>{
  const backend=new Backend(),c=client(backend,[vehicle('103호1504')]);c.instance.start({uid:'a'});await settle(c);
  let release;const gate=new Promise(resolve=>release=resolve);let calls=0;
  backend.beforeSet=async()=>{if(++calls===1)await gate};
  c.instance.queue('103호1504',{n:'첫 수정'});
  c.instance.queue('103호1504',{n:'두 번째 수정'});release();await settle(c);
  assert.equal(backend.rows.get('vehicles/103호1504').n,'두 번째 수정');
  assert.equal(Object.keys(c.instance.pending).length,0);
});

test('signing out stops subsequent writes and a new authenticated session resumes the durable queue',async()=>{
  const backend=new Backend(),c=client(backend,[vehicle('103호1504'),vehicle('103호4722')]);
  c.instance.start({uid:'a'});await settle(c);
  let release;const gate=new Promise(resolve=>release=resolve);let calls=0;
  backend.beforeSet=async()=>{if(++calls===1)await gate};
  c.instance.queue('103호1504',{n:'진행 중 수정'});c.instance.queue('103호4722',{n:'다음 수정'});
  c.instance.stop();release();await settle(c);
  assert.equal(backend.rows.get('vehicles/103호4722').n,'카니발 9인승');
  c.instance.start({uid:'b'});await settle(c);
  assert.equal(backend.rows.get('vehicles/103호4722').n,'다음 수정');
  assert.equal(backend.rows.get('vehicles/103호4722').updatedBy,'b');
  assert.equal(c.states.at(-1).status,'saved');
});

test('cached snapshots, permission failures and local-storage failure never report successful shared saving',async()=>{
  const cached=new Backend();cached.cached=true;const a=client(cached,[vehicle('103호1504')]);a.instance.start({uid:'a'});await settle(a);
  assert.equal(cached.writes.length,0);assert.equal(a.states.at(-1).status,'offline');
  const denied=new Backend();denied.denied.add('vehicles');const b=client(denied,[vehicle('103호1504')]);b.instance.start({uid:'b'});await settle(b);
  b.instance.queue('103호1504',{n:'미전송 수정'});
  assert.equal(denied.writes.length,0);assert.notEqual(b.states.at(-1).status,'saved');assert.equal(b.active()[0].n,'미전송 수정');
  const backend=new Backend(),c=client(backend,[vehicle('103호1504')]);c.instance.start({uid:'c'});await settle(c);c.storage.fail=true;
  assert.equal(c.instance.queue('103호1504',{n:'보관 실패'}),false);await settle(c);
  assert.equal(c.states.at(-1).error,'local-storage-failed');assert.notEqual(backend.rows.get('vehicles/103호1504').n,'보관 실패');
});

test('an empty SDK cache preserves the last acknowledged fleet while offline',async()=>{
  const backend=new Backend(),original=client(backend,[vehicle('103호1504')]);
  original.instance.start({uid:'a'});await settle(original);original.instance.stop();
  backend.rows.clear();backend.cached=true;
  const reloaded=client(backend,[],{storage:original.storage});reloaded.instance.start({uid:'a'});await settle(reloaded);
  assert.equal(reloaded.active()[0].id,'103호1504');assert.equal(reloaded.instance.ready,false);
  assert.equal(reloaded.states.at(-1).status,'offline');
});

test('the combined save badge cannot hide a vehicle or history failure behind a saved reservation',()=>{
  const source=readFileSync(new URL('../index.html',import.meta.url),'utf8');
  const start=source.indexOf('let _syncState='),end=source.indexOf('function getReservationSyncState()',start);
  const nodes=new Map(['sync-state','fleet-sync-state'].map(id=>[id,{dataset:{},style:{},setAttribute(){}}]));
  const ctx=vm.createContext({Date,console,_localDurable:true,_pendingWrites:{},document:{getElementById:id=>nodes.get(id)},window:{addEventListener(){},dispatchEvent(){}}});
  vm.runInContext(source.slice(start,end),ctx);
  ctx.setSyncState('saved','서버 저장 완료');assert.notEqual(nodes.get('sync-state').dataset.state,'saved');
  ctx.setSharedBusinessState('vehicles',{status:'error',error:'permission-denied',pending:0});
  ctx.setSharedBusinessState('history',{status:'saved',pending:0});ctx.setSyncState('saved','서버 저장 완료');
  assert.equal(nodes.get('sync-state').dataset.state,'error');assert.match(nodes.get('sync-state').textContent,/차량 목록 공유 권한/);
  ctx.setSharedBusinessState('vehicles',{status:'saved',pending:0});assert.equal(nodes.get('sync-state').textContent,'서버 저장 완료');
});

test('append-only reservation change histories migrate and share without modifying reservations',async()=>{
  const backend=new Backend();backend.seed('reservations',[{id:'existing',name:'원본 예약'}]);
  const entry={id:'history-1',reservationId:'existing',timestamp:'2026-11-17T06:00:00Z',action:'UPDATE',before:{name:'이전'},after:{name:'변경'}};
  const historyOptions={collection:'reservationHistory',backupCollection:null,keepLegacy:false,validate:row=>typeof row.timestamp==='string'};
  const a=client(backend,[entry],historyOptions),b=client(backend,[],historyOptions);
  a.instance.start({uid:'a'});b.instance.start({uid:'b'});await settle(a,b);
  const second={...entry,id:'history-2',action:'PAYMENT_UPDATE'};b.instance.queue(second.id,second,second);await settle(a,b);
  assert.equal(a.instance.snapshot().length,2);assert.equal(b.instance.snapshot().length,2);
  assert.deepEqual(backend.rows.get('reservations/existing'),{id:'existing',name:'원본 예약'});
  assert.equal(a.instance.legacy.length,0);
  assert.equal(backend.writes.filter(write=>write.path==='reservationHistory/history-1').length,1);
});
