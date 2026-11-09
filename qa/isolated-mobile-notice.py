from pathlib import Path
from playwright.sync_api import sync_playwright
from random import random

html=Path('index.html').read_text()
firebase="window.firebase={initializeApp(){},auth(){return {currentUser:{uid:'fake-only'},onAuthStateChanged(){}}},firestore(){return {}}}"
origin='https://fixture.invalid/rentcar/'
with sync_playwright() as pw:
  browser=pw.webkit.launch(headless=True)
  for width,height in [(390,730),(320,400)]:
    ctx=browser.new_context(viewport={'width':width,'height':height},is_mobile=True,has_touch=True,device_scale_factor=2,timezone_id='Asia/Seoul',service_workers='block')
    network_posts=[]
    def intercept(route):
      req=route.request
      if req.method!='GET': network_posts.append(req.method);return route.abort()
      if req.url==origin: return route.fulfill(status=200,content_type='text/html; charset=utf-8',body=html)
      if req.resource_type=='script': return route.fulfill(status=200,content_type='text/javascript',body=firebase if 'firebase-app-compat' in req.url else '')
      return route.abort()
    ctx.route('**/*',intercept); page=ctx.new_page()
    exceptions=[];page.on('pageerror',lambda e:exceptions.append(str(e)))
    page.on('dialog',lambda d:d.accept())
    page.set_default_timeout(7000)
    page.goto(origin,wait_until='domcontentloaded')
    page.evaluate("""() => {
      document.getElementById('login-screen').style.display='none';
      const row={id:'fixture',name:'가상 테스트',phone:'01000000000',car:'쏠라티 15인승',start:'2035-11-10T10:00',end:'2035-11-11T10:00',pickup:'가상 장소 A',ret:'가상 장소 B',ins:'일반면책',status:'wait'};
      data=[row];window.sendCalls=0;
      requestSmsApi=async p=>{if(p.action==='history')return {history:[],nextOffset:null,total:0};if(p.reservationId!==row.id||p.phone!==row.phone)throw Error('bad recipient');window.sendCalls++;return {accepted:true,duplicate:true,recorded:true,id:'fixture',at:'2026-11-09T00:00:00Z'}};
      openDispatchNotice(row.id)
    }""")
    check=page.locator('#dispatch-notice-reviewed'); send=page.locator('#dispatch-notice-api')
    assert send.is_disabled()
    def hit(loc):
      return loc.evaluate("""el=>{const b=el.getBoundingClientRect(), x=b.left+b.width/2,y=b.top+b.height/2;const target=document.elementFromPoint(x,y);return !!target&&(el===target||el.contains(target))&&x>=0&&x<innerWidth&&y>=0&&y<innerHeight}""")
    if height>440:
      assert hit(check) and hit(send),f'controls not on screen at {width}x{height}'
      page.locator('.dispatch-notice-body').evaluate('el=>el.scrollTop=el.scrollHeight')
      assert hit(check) and hit(send),'scroll hid the controls'
    else:
      assert page.locator('#dispatch-notice-overlay').get_attribute('data-short') is not None
      check.scroll_into_view_if_needed(); assert hit(check),'review occluded'
    check.tap();assert send.is_enabled()
    send.scroll_into_view_if_needed();assert hit(send),'send occluded'
    send.tap()
    page.wait_for_function("window.sendCalls===1 && document.getElementById('dispatch-notice-result').textContent.includes('접수')")
    assert not network_posts,network_posts
    assert not exceptions,exceptions
    print(f'PASS WebKit mobile {width}x{height} review & send hit targets, one mocked receipt, zero outgoing POSTs')
    ctx.close()
  browser.close()
