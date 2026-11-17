import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {approvedStaffAccount} from '../supabase/functions/ppurio-reservation-sms/staff-account-auth.ts';
test('SMS uses the signed-in account approval and passes the existing Firebase token only to Firestore',async()=>{
  let called=0;
  const allowed=await approvedStaffAccount('staff-uid','test-only-token',async(url,options)=>{
    called++;assert.equal(url,'https://firestore.googleapis.com/v1/projects/ky-rent-system/databases/(default)/documents/staffAccounts/staff-uid');
    assert.equal(options.headers.Authorization,'Bearer test-only-token');
    return Response.json({fields:{enabled:{booleanValue:true}}});
  });
  assert.equal(allowed,true);assert.equal(called,1);
});
test('revoked, unapproved, inaccessible and malformed staff approvals cannot authorize SMS',async()=>{
  for(const response of [new Response('',{status:403}),new Response('',{status:404}),Response.json({fields:{enabled:{booleanValue:false}}}),Response.json({fields:{enabled:{stringValue:'true'}}})]){
    assert.equal(await approvedStaffAccount('staff','test-only-token',async()=>response),false);
  }
  await assert.rejects(approvedStaffAccount('staff','test-only-token',async()=>new Response('',{status:503})));
  assert.equal(await approvedStaffAccount('','',async()=>{throw Error('must not fetch')}),false);
});
test('legacy device links cannot self-authorize a staff account or bypass the membership check',()=>{
  const source=readFileSync(new URL('../supabase/functions/ppurio-reservation-sms/index.ts',import.meta.url),'utf8');
  assert.ok(source.indexOf('approvedStaffAccount(uid,token)')<source.indexOf('if (input.action==="join-team")'));
  assert.doesNotMatch(source,/PPURIO_STAFF_UIDS|redeem_ppurio_staff_link|ppurio_staff_devices/);
});
