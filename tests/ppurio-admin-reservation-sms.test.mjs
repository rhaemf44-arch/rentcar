import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { makeHandler } from '../supabase/functions/ppurio-admin-reservation-sms/index.ts';

const id='10000000-0000-4000-8000-000000000001', seconds=1794200000, base='https://staff.test/functions/v1/ppurio-admin-reservation-sms';
const data={reservationId:id,recipients:['01000000001','01000000002','01000000003'],subject:'경일렌트카 예약접수',
  text:'[경일렌트카 홈페이지 예약접수]\n\n차량: 예시 차량\n요청사항: 예시 요청'};
function setup({result, auth, callback, finishFail=false, settings={}}={}) {
  const rows=new Map(), calls=[], clients=[], proofs=[];
  const env={PPURIO_ACCOUNT:'example',PPURIO_API_KEY:'fixture-api-key',PPURIO_FROM:'01012340000',FIXIE_URL:'https://fixture.invalid',SUPABASE_URL:'https://staff.test',SUPABASE_SERVICE_ROLE_KEY:'mock-staff-only',...settings};
  const fetcher=async (url,opt)=>{
    const u=new URL(url), body=opt.body?JSON.parse(opt.body):null;
    assert.equal(opt.redirect,'error');
    calls.push([u.pathname,opt.method,body]);
    if (u.hostname==='omhcaozfzliigqctedus.supabase.co') {
      assert.equal(u.pathname,'/functions/v1/send-reservation-sms/verify-ppurio');
      assert.deepEqual(Object.keys(body).sort(),['digest','reservationId','signature','timestamp']);
      assert.equal(opt.headers.Authorization,undefined);
      proofs.push(body);
      return callback?.()??Response.json({verified:true});
    }
    if (u.hostname==='message.ppurio.com'){
      assert.equal(opt.client,clients.at(-1));
      if(u.pathname==='/v1/token') {
        assert.match(opt.headers.Authorization,/^Basic /);return auth?.()??Response.json({token:'fake-token'});
      }
      assert.equal(opt.headers.Authorization,'Bearer fake-token');
      return result?.()??Response.json({code:'1000',messageKey:'fake-message-group'});
    }
    assert.equal(u.origin,'https://staff.test');
    assert.equal(u.pathname,'/rest/v1/ppurio_admin_reservation_delivery');
    assert.equal(opt.headers.Authorization,'Bearer mock-staff-only');
    const rowId=u.searchParams.get('reservation_id')?.replace(/^eq\./,'');
    if(opt.method==='POST'){
      if(rows.has(body.reservation_id))return Response.json({code:'23505'},{status:409});
      rows.set(body.reservation_id,{...body});return new Response(null,{status:201});
    }
    const row=rows.get(rowId);
    if(opt.method==='GET')return Response.json(row?[row]:[]);
    assert.equal(opt.method,'PATCH');
    if(finishFail && body.state==='accepted')throw new Error('db unavailable');
    if(!row || [...u.searchParams].some(([key,val])=>key!=='select' && String(row[key])!==val.slice(3)))return Response.json([]);
    Object.assign(row,body);return Response.json([{reservation_id:rowId}]);
  };
  const handler=makeHandler({getEnv:k=>env[k]??'',now:()=>seconds*1000,fetcher,
    createClient:(proxy)=>{assert.equal(proxy,env.FIXIE_URL);const p={closed:false,close(){this.closed=true;}};clients.push(p);return p;}});
  const post=(payload=data,headers={})=>handler(new Request(base,{method:'POST',headers:{'x-ky-timestamp':String(seconds),'x-ky-signature':'ab'.repeat(32),...headers},body:typeof payload==='string'?payload:JSON.stringify(payload)}));
  return {handler,post,calls,rows,clients,proofs};
}
test('one attested website reservation submits one batch to exactly three administrators via the same proxy',async()=>{
  const a=setup(), r=await a.post();assert.equal(r.status,200);
  assert.deepEqual(await r.json(),{status:'accepted',accepted:true,recipientCount:3,reservationId:id,groupId:'fake-message-group'});
  assert.equal(a.proofs[0].digest,createHash('sha256').update(JSON.stringify(data)).digest('hex'));
  const expected={account:'example',from:'01012340000',messageType:'LMS',subject:data.subject,content:data.text,duplicateFlag:'N',targetCount:3,targets:data.recipients.map(to=>({to})),refKey:id.replaceAll('-','')};
  assert.deepEqual(a.calls.find(x=>x[0]==='/v1/message')[2],expected);
  assert.ok(a.clients[0].closed);
  const rec=a.rows.get(id);assert.equal(rec.state,'accepted');assert.ok(!JSON.stringify(rec).includes(data.recipients[0]));assert.ok(!JSON.stringify(rec).includes(data.text));
  assert.equal((await a.post()).status,200);assert.equal(a.calls.filter(x=>x[0]==='/v1/message').length,1);
  assert.equal((await a.post({...data,text:data.text+'!'})).status,502);assert.equal(a.calls.filter(x=>x[0]==='/v1/message').length,1);
});
test('the admin sender override changes only the outbound from number',async()=>{
  const a=setup({settings:{PPURIO_ADMIN_RESERVATION_FROM:'010-0000-9999'}}), b=setup();
  assert.equal((await a.post()).status,200);assert.equal((await b.post()).status,200);
  const messages=({calls})=>calls.filter(x=>x[0]==='/v1/message').map(x=>x[2]);
  const [baseline]=messages(b);
  assert.deepEqual(messages(a),[{...baseline,from:'01000009999'}]);
  assert.deepEqual(baseline.targets,data.recipients.map(to=>({to})));assert.equal(baseline.targetCount,3);
});
test('two simultaneous deliveries never submit a second batch',async()=>{
  const a=setup();await Promise.all([a.post(),a.post()]);assert.equal(a.calls.filter(x=>x[0]==='/v1/message').length,1);
  assert.equal((await a.post()).status,200);
});
test('unverified envelopes, other templates, duplicate recipients or stale signatures never touch the ledger or provider',async()=>{
  for (const mode of ['stale','bad-input','private-note','too-big','bad-signature','callback-reject','callback-unavailable']) {
    const a=setup({callback:()=>mode==='callback-unavailable'?Response.json({},{status:503}):Response.json({verified:false})});
    let input=data,headers={};
    if(mode==='stale')headers={'x-ky-timestamp':String(seconds-121)};
    if(mode==='bad-signature')headers={'x-ky-signature':'?'};
    if(mode==='bad-input')input={...data,recipients:Array(3).fill(data.recipients[0])};
    if(mode==='private-note')input={...data,subject:'other'};
    if(mode==='too-big')input={...data,text:data.text+'a'.repeat(15000)};
    assert.ok((await a.post(input,headers)).status>=400);assert.equal(a.rows.size,0);assert.equal(a.clients.length,0);
    if(!mode.startsWith('callback-'))assert.equal(a.proofs.length,0);
  }
});
test('provider timeout or an ambiguous 5xx locks the batch: no automatic replay',async()=>{
  for (const result of [()=>{throw Error('ambiguous');},()=>Response.json({code:'99'},{status:503}),()=>Response.json({code:'3001'},{status:400}),()=>Response.json({code:'1000'})]){
    const a=setup({result});assert.equal((await (await a.post()).json()).status,'unknown');
    assert.equal(a.rows.get(id).state,'unknown');assert.equal((await a.post()).status,502);
    assert.equal(a.calls.filter(x=>x[0]==='/v1/message').length,1);
  }
});
test('receipt storage failure cannot resend a provider-accepted batch',async()=>{
  const a=setup({finishFail:true});assert.equal((await a.post()).status,200);assert.equal(a.rows.get(id).state,'processing');
  assert.equal((await a.post()).status,502);assert.equal(a.calls.filter(x=>x[0]==='/v1/message').length,1);
});
test('provider authentication failure before submission can retry, capped at three',async()=>{
  const a=setup({auth:()=>Response.json({},{status:401})});
  for(let i=0;i<5;i++) assert.deepEqual(await (await a.post()).json(),{status:'rejected',accepted:false,recipientCount:0,reservationId:id});
  assert.equal(a.rows.get(id).attempts,3);assert.equal(a.calls.filter(x=>x[0]==='/v1/token').length,3);
  assert.equal(a.calls.filter(x=>x[0]==='/v1/message').length,0);
});
test('readiness health reveals only configuration status and cannot send or authenticate to the provider',async()=>{
  for(const [settings,code] of [[{},200],[{PPURIO_API_KEY:''},503],[{PPURIO_ADMIN_RESERVATION_FROM:'invalid'},503]]){
    const a=setup({settings});const res=await a.handler(new Request(base+'/health'));assert.equal(res.status,code);
    assert.deepEqual(Object.keys(await res.json()).sort(),['ok','revision','service']);assert.equal(a.calls.length,0);
    assert.equal((await a.handler(new Request(base+'/other',{method:'POST'}))).status,405);assert.equal(a.calls.length,0);
  }
});
