from pathlib import Path
from http.server import ThreadingHTTPServer,BaseHTTPRequestHandler
from threading import Thread
import json,urllib.request,subprocess,time,re,shutil
html=Path('index.html').read_text()
stub="<script>window.qaErrors=[];window.onerror=m=>qaErrors.push(m);window.firebase={initializeApp(){},auth(){return {currentUser:null,onAuthStateChanged(){},signInAnonymously(){return Promise.resolve()}}},firestore(){return {}}}</script>"
html=html.replace('<head>','<head>'+stub,1)
class Page(BaseHTTPRequestHandler):
 def do_GET(self):
  self.send_response(200);self.send_header('Content-Type','text/html; charset=utf-8');self.send_header('Content-Security-Policy',"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'");self.end_headers();self.wfile.write(html.encode())
 def log_message(self,*args):pass
http=ThreadingHTTPServer(('127.0.0.1',0),Page);Thread(target=http.serve_forever,daemon=True).start()
driver=subprocess.Popen([shutil.which('chromedriver'),'--port=9515'],stdout=subprocess.DEVNULL)
def api(path,values):
 req=urllib.request.Request('http://127.0.0.1:9515'+path,data=json.dumps(values).encode(),headers={'Content-Type':'application/json'});return json.load(urllib.request.urlopen(req,timeout=12))['value']
try:
 for i in range(30):
  try:urllib.request.urlopen('http://127.0.0.1:9515/status',timeout=.5);break
  except OSError:time.sleep(.2)
 sid=api('/session',{'capabilities':{'alwaysMatch':{'browserName':'chrome','goog:chromeOptions':{'args':['--headless=new','--no-sandbox','--disable-dev-shm-usage','--disable-background-networking']}}}})['sessionId'];base='/session/'+sid
 def cdp(cmd,args={}):return api(base+'/goog/cdp/execute',{'cmd':cmd,'params':args})
 def ev(expr):
  out=cdp('Runtime.evaluate',{'expression':expr,'returnByValue':True});assert 'exceptionDetails' not in out,out.get('exceptionDetails',{});return out['result'].get('value')
 for mobile,width,height in [(False,1440,900),(True,390,780)]:
  cdp('Emulation.setDeviceMetricsOverride',{'width':width,'height':height,'mobile':mobile,'deviceScaleFactor':1})
  cdp('Emulation.setTouchEmulationEnabled',{'enabled':mobile})
  api(base+'/url',{'url':'http://127.0.0.1:%d/'%http.server_port})
  days=ev("""(()=>{document.getElementById('login-screen').style.display='none';for(const k of Object.keys(PLATE_MAP))delete PLATE_MAP[k];
  PLATE_MAP['999허9999']={n:'쏠라티',base:'쏠라티',seat:'15인승',fuel:'디젤'};data=[];go2('gantt');
  const dates=Array.from(document.querySelectorAll('#gantt button[data-day]'),b=>b.dataset.day);
  data=['early','late'].map((k,i)=>({id:k,name:'가상'+k,vehicleId:'999허9999',car:'쏠라티 (999허9999)',start:dates[0]+(i?'T15:00':'T07:00'),end:dates[0]+(i?'T20:00':'T10:00'),ins:'일반면책',status:'wait'}));window.writes=0;save=()=>{writes++;throw Error('unexpected write')};window.initial=JSON.stringify(data);renderGantt();return dates})()""")
  assert len(days)==4
  def press(selector):
   el='document.querySelector('+json.dumps(selector)+')';ev(el+".scrollIntoView({block:'center',behavior:'instant'})");time.sleep(.1)
   xy=ev("(()=>{const e="+el+",b=e.getBoundingClientRect(),x=b.x+b.width/2,y=b.y+b.height/2;return [x,y,e.contains(document.elementFromPoint(x,y))]})()");x,y,ok=xy;assert ok,xy
   if mobile:
    cdp('Input.dispatchTouchEvent',{'type':'touchStart','touchPoints':[{'x':x,'y':y}]});cdp('Input.dispatchTouchEvent',{'type':'touchEnd','touchPoints':[]})
   else:
    for t in ['mousePressed','mouseReleased']:cdp('Input.dispatchMouseEvent',{'type':t,'x':x,'y':y,'button':'left','clickCount':1})
   time.sleep(.15)
  for k in ['late','early']:
   press('#gantt button[data-booking="'+k+'"]')
   assert ev("editId")==k and ev("document.querySelector('#f-name').value")=='가상'+k
   assert ev("!!document.querySelector('#reservation-form-tabpanel').getClientRects().length")
   ev("go2('gantt')")
  press('#gantt button[data-day="'+days[2]+'"]')
  assert ev("editId")==None and ev("document.querySelector('#f-car').dataset.fullPlate")=='999허9999'
  assert ev("document.querySelector('#f-start').value").startswith(days[2]) and ev("document.querySelector('#f-end').value").startswith(days[2])
  assert ev("document.querySelector('#f-name').value")=='' and ev("window.writes===0&&JSON.stringify(data)===window.initial")
  assert ev("window.qaErrors")==[],ev("window.qaErrors")
  print('PASS Chrome',width,height,'real click/touch; correct two reservation IDs, prefilled empty day. No app writes; external script/network forbidden.',flush=True)
finally:driver.terminate();http.shutdown()
