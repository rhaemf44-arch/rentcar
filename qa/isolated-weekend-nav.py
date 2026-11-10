from pathlib import Path
from playwright.sync_api import sync_playwright

html=Path('index.html').read_text()
origin='https://fixture.invalid/rentcar/'
firebase="window.firebase={initializeApp(){},auth(){return {currentUser:null,onAuthStateChanged(){},signInAnonymously(){return Promise.resolve()}}},firestore(){return {}}}"
with sync_playwright() as pw:
 browser=pw.webkit.launch()
 for width,height in [(1440,900),(390,780)]:
  mobile=width<500
  ctx=browser.new_context(viewport={'width':width,'height':height},is_mobile=mobile,has_touch=mobile,timezone_id='Asia/Seoul',service_workers='block')
  writes=[];errors=[];dialogs=[]
  def route(req):
   q=req.request
   if q.method!='GET':writes.append(q.method);return req.abort()
   if q.url==origin:return req.fulfill(status=200,content_type='text/html; charset=utf-8',body=html)
   if q.resource_type=='script':return req.fulfill(status=200,content_type='text/javascript',body=firebase if 'firebase-app-compat' in q.url else '')
   return req.abort()
  ctx.route('**/*',route);p=ctx.new_page();p.set_default_timeout(9000)
  p.on('pageerror',lambda e:errors.append(str(e)))
  def dialog(d):
   dialogs.append(d.type)
   if d.type=='confirm':d.accept()
   else:d.dismiss()
  p.on('dialog',dialog);p.goto(origin,wait_until='domcontentloaded')
  days=p.evaluate("""() => {
    document.getElementById('login-screen').style.display='none';
    for(const k of Object.keys(PLATE_MAP))delete PLATE_MAP[k];
    PLATE_MAP['999허9999']={n:'쏠라티',seat:'15인승',fuel:'디젤',base:'쏠라티'};
    data=[];go2('gantt');
    const dates=Array.from(document.querySelectorAll('#gantt button[data-plate="999허9999"][data-day]'),b=>b.dataset.day);
    if(dates.length!==4)throw Error('missing four free date cells');
    data=['early','late'].map((k,i)=>({id:k,name:'가상'+k,phone:'01000000000',car:'쏠라티 (999허9999)',vehicleId:'999허9999',start:dates[0]+(i?'T15:00':'T07:00'),end:dates[0]+(i?'T20:00':'T10:00'),pickup:'가상A',ret:'가상B',ins:'일반면책',status:'wait'}));
    window.testWrites=0;save=()=>{window.testWrites++;throw Error('unexpected save')};
    window.initial=JSON.stringify(data);renderGantt();return dates;
  }""")
  def click(loc):
   assert loc.count()==1, str(loc)
   if mobile:loc.tap()
   else:loc.click()
  for k in ['late','early']:
   click(p.locator('#gantt button[data-booking="'+k+'"]'))
   assert p.locator('#reservation-form-tabpanel').is_visible()
   assert p.evaluate("editId")==k and p.locator('#f-name').input_value()=='가상'+k
   p.evaluate("() => go2('gantt')")
  free=p.locator('#gantt button[data-plate="999허9999"][data-day="'+days[2]+'"]')
  click(free)
  assert p.locator('#reservation-form-tabpanel').is_visible()
  assert p.locator('#f-start').input_value().startswith(days[2]) and p.locator('#f-end').input_value().startswith(days[2])
  assert p.locator('#f-car').get_attribute('data-full-plate')=='999허9999'
  assert p.locator('#f-name').input_value()=='' and p.evaluate("editId") is None
  assert p.evaluate("window.testWrites===0 && window.initial===JSON.stringify(data)")
  assert not writes and not errors and 'prompt' not in dialogs,(writes,errors,dialogs)
  print('PASS',width,height,'two same-day reservations and free day opened; no writes, customer traffic, prompt or errors')
  ctx.close()
 browser.close()
