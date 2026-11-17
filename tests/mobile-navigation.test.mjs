import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const section=(start,end)=>html.slice(html.indexOf(start),html.indexOf(end,html.indexOf(start)));
const code=section('let reservationFormVersion=','async function smartParse(')+
  section('const TITLES=','function openNav(')+
  section('function mobileGo(','function mDayLabel(')+
  section('function finishMobileSheetEdit(','function cancelMobileSheetEdit(');

function setup(){
  const elements=new Map();
  const element=id=>{
    if(!elements.has(id))elements.set(id,{id,value:'',textContent:'',title:'',tagName:'INPUT',dataset:{},disabled:false,readOnly:false,hidden:false,
      classList:{add(){},remove(){},toggle(){}}});
    return elements.get(id);
  };
  let current='dashboard',mobile=true,sheetClosed=0,sheetRendered=0;
  const ctx=vm.createContext({
    Map,JSON,storageCopy:value=>JSON.parse(JSON.stringify(value)),
    editId:null,_editingOriginal:null,_editFormBaseline:null,editReturnPosition:null,cleanReservationInputs:'baseline',
    previousPickupValue:'',returnLocationManuallyEdited:false,mSheetEditing:false,mSheetId:null,mSheetFormReturn:null,mobileSheetDrafts:new Map(),
    document:{getElementById:element,querySelector:selector=>{
      if(selector==='.view.on')return{id:'view-'+current};
      if(selector==='#m-sheet-body .reservation-form-grid')return{querySelector:()=>({prepend(){}})};
      return{append(){}};
    },querySelectorAll:selector=>selector==='.view'?['dashboard','today','schedule','reservations','more'].map(v=>({classList:{remove(){}}})):[]},
    window:{scrollY:275,scrollTo:position=>{ctx.window.scrollY=position.top??0}},
    isMobileApp:()=>mobile,updateMobileTabs:()=>{},render:()=>{},requestAnimationFrame:fn=>fn(),
    setReservationInputTab:tab=>{element('reservation-form-tabpanel').hidden=tab!=='manual'},
    openReservationPanel:mode=>{ctx.go2('dashboard');ctx.setReservationInputTab(mode)},
    closeMobileSheet:()=>{sheetClosed++},renderMobileSheet:()=>{sheetRendered++},closePlatePicker:()=>{},
    refreshDriverPhoneField:()=>{},clearForm:()=>{throw Error('back navigation must preserve the draft')},
  });
  for(const v of ['dashboard','today','schedule','reservations','more'])element('view-'+v).classList.add=()=>{current=v};
  element('m-sheet').hidden=true;
  element('f-start-minute').tagName='SELECT';element('f-start-minute').innerHTML='<option value="40">40분 (기존)</option>';
  vm.runInContext(code,ctx);
  return{ctx,element,current:()=>current,setMobile:v=>mobile=v,sheetClosed:()=>sheetClosed,sheetRendered:()=>sheetRendered};
}

test('back restores exact unsaved form fields, raw message, date options, selected plate and scroll position',()=>{
  const s=setup(),{ctx,element}=s;
  const values={'f-name':'작성 중 고객','f-total':'100,000','f-paid':'0','f-memo':'수정 중\n다음 줄',raw:'카톡 원문',
    'f-start':'2026-11-19T09:40','f-start-date':'2026-11-19','f-start-hour':'09','f-start-minute':'40'};
  for(const [id,value] of Object.entries(values))element(id).value=value;
  element('f-car').dataset.fullPlate='127호2904';
  ctx.editId='existing';ctx._editingOriginal={id:'existing',memo:'서버 원문'};ctx._editFormBaseline={memo:'서버 원문'};
  ctx.go2('schedule');ctx.window.scrollY=690;ctx.go2('reservations');ctx.mobileBack();
  assert.equal(s.current(),'schedule');assert.equal(ctx.window.scrollY,690);
  for(const id of Object.keys(values))element(id).value='';
  element('f-car').dataset.fullPlate='';element('f-start-minute').innerHTML='';
  ctx.mobileBack();
  assert.equal(s.current(),'dashboard');assert.equal(ctx.window.scrollY,275);
  for(const [id,value] of Object.entries(values))assert.equal(element(id).value,value,id);
  assert.equal(element('f-car').dataset.fullPlate,'127호2904');
  assert.match(element('f-start-minute').innerHTML,/40분/);
  assert.equal(ctx.editId,'existing');assert.equal(ctx._editingOriginal.memo,'서버 원문');
});

test('the add tab reopens the current input tab and draft without resetting fields',()=>{
  const s=setup();s.element('f-name').value='보존할 고객';
  s.ctx.go2('reservations');s.ctx.mobileGo('add');
  assert.equal(s.current(),'dashboard');assert.equal(s.element('f-name').value,'보존할 고객');
  assert.equal(s.element('reservation-form-tabpanel').hidden,false);
});

test('leaving a sheet edit keeps its draft and restores the separate background input',()=>{
  const s=setup(),{ctx,element}=s;
  element('f-name').value='신규 입력 중';ctx.mSheetFormReturn=ctx.captureReservationDraft();
  ctx.mSheetEditing=true;ctx.mSheetId='reservation-a';ctx.editId='reservation-a';
  ctx._editingOriginal={id:'reservation-a',name:'서버 이름'};ctx._editFormBaseline={name:'서버 이름'};
  element('f-name').value='수정 중 이름';element('f-memo').value='저장 전 메모';element('m-sheet').hidden=false;
  ctx.mobileBack();
  assert.equal(s.sheetRendered(),1);assert.equal(element('f-name').value,'신규 입력 중');
  const saved=ctx.mobileSheetDrafts.get('reservation-a');
  assert(saved);ctx.restoreReservationDraft(saved);
  assert.equal(element('f-name').value,'수정 중 이름');assert.equal(element('f-memo').value,'저장 전 메모');
  assert.equal(ctx._editFormBaseline.name,'서버 이름');
  ctx.mobileBack();assert.equal(s.sheetClosed(),1);
});

test('repeated tabs create no duplicate entries, desktop navigation is excluded, and first back goes home',()=>{
  const s=setup();s.ctx.go2('dashboard');
  assert.equal(vm.runInContext('mobileNavigation.length',s.ctx),0);
  s.ctx.mobileBack();assert.equal(s.current(),'today');assert.equal(s.element('mobile-back').hidden,true);
  s.setMobile(false);s.ctx.go2('schedule');
  assert.equal(vm.runInContext('mobileNavigation.length',s.ctx),0);
});
