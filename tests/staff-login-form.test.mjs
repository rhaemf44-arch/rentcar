import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import access from '../staff-access.js';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const code=html.slice(html.indexOf('let staffLoginBusy='),html.indexOf('/* ===== 앱 초기화'));
function setup(saved={}){
  const values=new Map(Object.entries(saved)),calls=[],elements=new Map();
  for(const id of ['staff-login-id','staff-login-password','staff-login-remember','staff-login-submit','staff-access-message','staff-password-toggle']){
    const attrs={};
    elements.set(id,{value:'',checked:true,disabled:false,type:id==='staff-login-password'?'password':'text',textContent:'',attrs,
      focus(){this.focused=true},setAttribute(k,v){attrs[k]=v},removeAttribute(k){delete attrs[k]}});
  }
  const storage={getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};
  const auth={async setPersistence(p){calls.push(['persistence',p])},async signInWithEmailAndPassword(email){calls.push(['login',email]);if(auth.error)throw auth.error;return{user:{uid:'test-only'}}}};
  const ctx=vm.createContext({...access,auth,localStorage:storage,document:{getElementById:id=>elements.get(id)},firebase:{auth:{Auth:{Persistence:{LOCAL:'local',SESSION:'session'}}}}});
  vm.runInContext(code,ctx);
  return{ctx,values,calls,auth,elements,storage,input:id=>elements.get('staff-login-'+id)};
}
test('missing or malformed fields focus the relevant input without contacting Firebase',async()=>{
  const h=setup();
  for(const id of ['', '  ', '아이디']){
    h.input('id').value=id;await h.ctx.doLogin();
    assert.equal(h.input('id').focused,true);assert.equal(h.input('id').attrs['aria-invalid'],'true');assert.equal(h.calls.length,0);
  }
  h.input('id').value='employee';await h.ctx.doLogin();
  assert.equal(h.input('password').focused,true);assert.equal(h.input('password').attrs['aria-invalid'],'true');assert.equal(h.calls.length,0);
  assert.equal(h.elements.get('staff-access-message').textContent,'비밀번호를 입력해 주세요.');
});
test('a remembered successful login restores only the ID on a later visit',async()=>{
  const h=setup();h.input('id').value='  EMPLOYEE  ';h.input('password').value='test-only-secret';
  await h.ctx.doLogin();
  assert.deepEqual(h.calls,[['persistence','local'],['login','employee@staff.ky-rent-system.invalid']]);
  assert.equal(h.values.get('ky_staff_login_id_v1'),'employee');
  assert.equal(h.input('password').value,'');
  assert.ok(!JSON.stringify([...h.values]).includes('test-only-secret'));
  const later=setup(Object.fromEntries(h.values));later.ctx.restoreStaffLoginPreferences();
  assert.equal(later.input('id').value,'employee');assert.equal(later.input('password').value,'');
});
test('unchecked auto login forgets the saved ID and uses session persistence',async()=>{
  const h=setup({ky_staff_login_id_v1:'previous'});h.input('remember').checked=false;h.ctx.forgetStaffLoginId();
  assert.equal(h.values.has('ky_staff_login_id_v1'),false);
  h.input('id').value='employee';h.input('password').value='test-only-secret';await h.ctx.doLogin();
  assert.equal(h.calls[0][1],'session');assert.equal(h.values.has('ky_staff_login_id_v1'),false);
  const later=setup(Object.fromEntries(h.values));later.ctx.restoreStaffLoginPreferences();
  assert.equal(later.input('remember').checked,false);assert.equal(later.input('id').value,'');
});
test('a failed network login retains the entered fields for retry and never remembers an unsuccessful ID',async()=>{
  const h=setup();h.input('id').value='employee';h.input('password').value='test-only-secret';h.auth.error={code:'auth/network-request-failed'};
  await h.ctx.doLogin();
  assert.match(h.elements.get('staff-access-message').textContent,/인터넷 연결/);
  assert.equal(h.input('password').value,'test-only-secret');assert.equal(h.input('id').value,'employee');assert.equal(h.values.size,0);assert.equal(h.input('submit').disabled,false);
  h.auth.error=null;await h.ctx.doLogin();assert.equal(h.input('password').value,'');
});
test('storage and account errors have separate messages without granting access',async()=>{
  for(const [code,expected] of [['auth/web-storage-unsupported','저장 기능'],['auth/user-disabled','중지된 계정'],['auth/operation-not-allowed','서버 설정'],['auth/invalid-credential','아이디 또는 비밀번호']]){
    const h=setup();h.input('id').value='employee';h.input('password').value='test-only-secret';h.auth.error={code};await h.ctx.doLogin();
    assert.ok(h.elements.get('staff-access-message').textContent.includes(expected));assert.equal(h.values.size,0);
  }
});
test('unavailable browser preference storage does not prevent sign-in',async()=>{
  const h=setup();for(const k of Object.keys(h.storage))h.storage[k]=()=>{throw Error('storage blocked')};
  assert.doesNotThrow(()=>h.ctx.restoreStaffLoginPreferences());h.input('id').value='employee';h.input('password').value='test-only-secret';
  await h.ctx.doLogin();assert.equal(h.calls.filter(c=>c[0]==='login').length,1);assert.equal(h.input('password').value,'');
});
test('password visibility is explicit and resets after a successful login',async()=>{
  const h=setup();h.input('password').value='test-only-secret';h.ctx.toggleStaffPassword();
  assert.equal(h.input('password').type,'text');assert.equal(h.elements.get('staff-password-toggle').attrs['aria-pressed'],'true');
  h.input('id').value='employee';await h.ctx.doLogin();
  assert.equal(h.input('password').type,'password');assert.equal(h.elements.get('staff-password-toggle').attrs['aria-pressed'],'false');
});
test('concurrent clicks submit a single authentication request',async()=>{
  const h=setup();h.input('id').value='employee';h.input('password').value='test-only-secret';
  await Promise.all([h.ctx.doLogin(),h.ctx.doLogin()]);assert.equal(h.calls.filter(c=>c[0]==='login').length,1);
});
