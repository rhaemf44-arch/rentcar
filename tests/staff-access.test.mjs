import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import access from '../staff-access.js';
const {StaffAccessGate,staffLoginEmail,signInStaff}=access;
const employee=uid=>({uid,isAnonymous:false,providerData:[{providerId:'password'}]});
function setup(){
  const listeners=[],events=[];
  const db={collection(name){assert.equal(name,'staffAccounts');return{doc(uid){return{onSnapshot(options,callback,error){
    const listener={uid,callback,error,stopped:false};listeners.push(listener);return()=>{listener.stopped=true};
  }}}}}};
  const gate=new StaffAccessGate({db,onGranted:user=>events.push(['granted',user.uid]),onBlocked:(reason,user)=>events.push(['blocked',reason,user?.uid])});
  const emit=(listener,{exists=true,enabled=true,fromCache=false}={})=>listener.callback({exists,metadata:{fromCache},data:()=>({enabled})});
  return{gate,listeners,events,emit};
}
test('legacy anonymous accounts never query the staff roster or open the app',()=>{
  const {gate,listeners,events}=setup();gate.start({uid:'legacy',isAnonymous:true});
  assert.equal(listeners.length,0);assert.equal(gate.granted,false);assert.equal(events.at(-1)[1],'sign-in-required');
});
test('IDs map consistently to Firebase logins while real email IDs remain usable',()=>{
  assert.equal(staffLoginEmail('  EMPLOYEE_01 '),'employee_01@staff.ky-rent-system.invalid');
  assert.equal(staffLoginEmail('Staff@Example.com'),'staff@example.com');
  for(const value of ['ab','아이디','a/b/c','employee name','@invalid'])assert.throws(()=>staffLoginEmail(value));
});
test('auto login selects LOCAL persistence before sign-in, and unchecked login selects SESSION',async()=>{
  const calls=[];
  const auth={async setPersistence(value){calls.push(['persistence',value])},async signInWithEmailAndPassword(email,password){calls.push(['login',email,password]);return 'signed-in'}};
  for(const remember of [true,false]){
    calls.length=0;
    assert.equal(await signInStaff(auth,'employee','test-only-password',remember,{LOCAL:'local',SESSION:'session'}),'signed-in');
    assert.deepEqual(calls,[['persistence',remember?'local':'session'],['login','employee@staff.ky-rent-system.invalid','test-only-password']]);
  }
  calls.length=0;await assert.rejects(signInStaff(auth,'invalid ID','test-only-password',true,{}));assert.equal(calls.length,0);
});
test('anonymous authentication alone cannot open the app; only server-confirmed approval can',()=>{
  const {gate,listeners,events,emit}=setup();gate.start(employee('employee'));
  assert.equal(gate.granted,false);
  emit(listeners[0],{fromCache:true});assert.equal(gate.granted,false);
  emit(listeners[0],{exists:false});assert.equal(gate.granted,false);
  emit(listeners[0]);assert.equal(gate.granted,true);
  emit(listeners[0]);assert.equal(events.filter(e=>e[0]==='granted').length,1);
});
test('revocation and verification failures close access, while successful reapproval resumes it',()=>{
  const {gate,listeners,events,emit}=setup();gate.start(employee('employee'));emit(listeners[0]);
  emit(listeners[0],{enabled:false});assert.equal(gate.granted,false);
  assert.equal(events.at(-1)[1],'approval-required');
  emit(listeners[0]);assert.equal(gate.granted,true);
  listeners[0].error({code:'unavailable'});assert.equal(gate.granted,false);
  assert.equal(events.at(-1)[1],'unavailable');
});
test('stale approvals and errors from a previous account cannot reopen or close the new account',()=>{
  const {gate,listeners,emit}=setup();gate.start(employee('first'));const stale=listeners[0];
  gate.start(employee('second'));assert.equal(stale.stopped,true);
  emit(stale);assert.equal(gate.granted,false);
  emit(listeners[1]);assert.equal(gate.granted,true);
  stale.error({code:'permission-denied'});assert.equal(gate.granted,true);
  gate.stop();emit(listeners[1]);assert.equal(gate.granted,false);
});
test('retry never trusts an old cached approval',()=>{
  const {gate,listeners,emit}=setup();gate.start(employee('employee'));emit(listeners[0]);
  gate.retry();assert.equal(gate.granted,false);assert.equal(listeners[0].stopped,true);
  emit(listeners[1],{fromCache:true});assert.equal(gate.granted,false);
  emit(listeners[1]);assert.equal(gate.granted,true);
});
test('the page is blocked before startup and initializes business caches only after the approval callback',()=>{
  const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
  assert.match(html,/<body data-staff-access="blocked">/);
  assert.match(html,/body\[data-staff-access="blocked"\]>:not\(#login-screen\)/);
  const callback=html.slice(html.indexOf('const staffAccessGate='),html.indexOf('// 개발 회귀 테스트'));
  assert.match(callback,/onGranted:user=>\{[\s\S]*?initApp\(\)/);
  assert.match(callback,/if\(!staffAppInitialized\)\{staffAppInitialized=true;initApp\(\)\}/);
  const login=html.slice(html.indexOf('function doLogin(){'),html.indexOf('/* ===== 앱 초기화'));
  assert.doesNotMatch(login,/load\(|loadPlateMap\(|initApp\(/);
  assert.match(login,/await signInStaff\(/);
  assert.doesNotMatch(html,/signInAnonymously\(/);
});
