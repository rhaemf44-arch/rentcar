/* Phone-sized schedule pages. A4 printing keeps its existing table and pagination. */
(function(root){
  'use strict';
  // Ratios use the manufacturers' full display rectangles, independent of browser chrome.
  const PHONE_PROFILES={
    'iphone17pro':{label:'아이폰 17 Pro',width:402,height:874,pixels:[1206,2622]},
    'galaxy-s21':{label:'갤럭시 S21',width:360,height:800,pixels:[1080,2400]},
    'fold7-cover':{label:'갤럭시 폴드7 · 접힘',width:360,height:840,pixels:[1080,2520]},
    'fold7-open':{label:'갤럭시 폴드7 · 펼침',width:656,height:728,pixels:[1968,2184]},
  };
  const escape=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
  const money=value=>value==null?'':Number(value).toLocaleString('ko-KR')+'원';
  function packCaptureRows(rows,fits,fitOversize){
    const pages=[];let page=[];
    for(const row of rows){
      if(fits([...page,row])){page.push(row);continue}
      if(page.length){pages.push(page);page=[]}
      if(!fits([row]))fitOversize(row);
      page.push(row);
    }
    if(page.length)pages.push(page);return pages;
  }
  function renderCaptureRow(row,index){
    const solati=row.쏠라티===true||/[쏠솔]라티|solati/i.test(row.차량||'');
    const pickup=String(row.배차||''),returned=String(row.회차||pickup);
    const driver=String(row.인쇄장소Html||'').includes('driver-mark')?'[운행기사] ':'';
    const same=pickup.replace(/\s+/g,' ').trim()===returned.replace(/\s+/g,' ').trim();
    const locations=same?`<div><span>배차·회차</span> ${escape(driver+pickup)}</div>`:`<div><span>배차</span> ${escape(driver+pickup)}</div><div><span>회차</span> ${escape(returned)}</div>`;
    return `<article class="capture-row${solati?' solati':''}" data-row="${index}" style="--row-scale:${row.captureScale||1}">
      <div class="capture-vehicle"><strong>${escape(row.차량)}</strong><b>${escape(row.차량번호)}</b></div>
      ${row.임차인명||row.임차인연락처?`<div class="capture-customer">${escape(row.임차인명)}${row.임차인명&&row.임차인연락처?' · ':''}${escape(row.임차인연락처)}</div>`:''}
      <div class="capture-times"><div><span>대여</span> ${escape(row.대여예정일시)}</div><div><span>반납</span> ${escape(row.반납예정일시)}</div></div>
      <div class="capture-locations">${locations}</div>
      <div class="capture-money"><div><span>총금액</span><b>${money(row.총금액)}</b></div><div><span>계약금</span><b>${money(row.계약금)}</b></div><div><span>잔금</span><b>${row.잔금===0?'0원 (완납)':money(row.잔금)}</b></div></div>
    </article>`;
  }
  function start(document,config){
    const rows=config.rows.filter(Boolean).map((row,index)=>({...row,captureIndex:index}));
    const toolbar=document.querySelector('.noprint'),printButton=toolbar.querySelector('button');
    toolbar.classList.add('capture-toolbar');
    const controls=document.createElement('div');controls.className='capture-controls';
    controls.innerHTML=`<label>출력 비율 <select id="capture-profile"><option value="a4">A4 가로 · 기존 일정표</option><option value="auto">내 화면에 맞춤</option>${Object.entries(PHONE_PROFILES).map(([key,profile])=>`<option value="${key}">${profile.label}</option>`).join('')}</select></label><button type="button" id="capture-prev">이전</button><span id="capture-count" role="status"></span><button type="button" id="capture-next">다음</button><button type="button" id="capture-focus">캡처 화면</button>`;
    toolbar.prepend(controls);
    const help=document.createElement('p');help.className='capture-help';help.textContent='휴대폰 비율을 선택하면 예약을 페이지별로 나눕니다. 캡처 화면에서 화면을 누르거나 Esc를 누르면 도구가 다시 나타납니다.';toolbar.append(help);
    const pagesRoot=document.createElement('div');pagesRoot.className='capture-pages';document.body.append(pagesRoot);
    const measure=document.createElement('div');measure.className='capture-measure';document.body.append(measure);
    const pageRule=document.createElement('style');document.head.append(pageRule);
    const style=document.createElement('style');style.textContent=`
      .capture-toolbar{display:flex;flex-wrap:wrap;align-items:center;gap:8px;background:#edf2f7;padding:12px;border:1px solid #b9c8d8;border-radius:8px;color:#172d48}
      .capture-controls{display:flex;flex-wrap:wrap;align-items:center;gap:8px}.capture-controls label{font-size:14px;font-weight:700}.capture-controls select{font:16px sans-serif;min-height:44px;padding:8px;max-width:100%;background:white;border:1px solid #8fa2ba;border-radius:6px;color:#172d48}.capture-toolbar button{min-height:44px}.capture-toolbar button:disabled{opacity:.4}.capture-help{font-size:12px;flex-basis:100%;margin:0;color:#41536b}
      #capture-count{min-width:54px;text-align:center;font-size:13px}.capture-pages{display:none}.capture-measure{position:absolute;top:0;left:0;height:0;overflow:hidden;visibility:hidden;pointer-events:none}
      body.capture-mode{background:#dce5ef;color:#152b46;padding:12px;overflow-x:hidden}.capture-mode>.screen-sheet{display:none}.capture-mode .capture-pages{display:block;margin:0 auto;position:relative;width:var(--capture-display-width);height:var(--capture-display-height)}
      .capture-page{box-sizing:border-box;background:white;color:#152b46;width:var(--capture-width);height:var(--capture-height);padding:12px;display:flex;flex-direction:column;font-family:"Malgun Gothic","Apple SD Gothic Neo",sans-serif;overflow:hidden}
      .capture-pages>.capture-page{display:none;transform:scale(var(--capture-zoom));transform-origin:top left;box-shadow:0 1px 12px #172d4820}.capture-pages>.is-current{display:flex}
      .capture-heading{border-bottom:2px solid #243e61;padding-bottom:8px;margin-bottom:8px}.capture-heading h1{font-size:18px;line-height:1.3;margin:0 0 4px}.capture-heading p{font-size:10px;line-height:1.4;margin:0;overflow-wrap:anywhere}
      .capture-content{flex:1;min-height:0}.capture-day{font-size:13px;font-weight:800;background:#e5edf6;padding:5px 8px;margin:8px 0 6px;color:#172d48}.capture-content>.capture-day:first-child{margin-top:0}
      .capture-page.wide .capture-content{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));align-content:start;align-items:start;gap:6px}.capture-page.wide .capture-day{grid-column:1/-1;margin:0}.capture-page.wide .capture-row{margin-bottom:0}
      .capture-row{font-size:calc(12px * var(--row-scale));line-height:1.35;border:1px solid #b2c1d1;border-radius:5px;padding:calc(8px * var(--row-scale));margin:0 0 6px;overflow-wrap:anywhere;break-inside:avoid-page;page-break-inside:avoid}
      .capture-row.solati{background:#ffeb3b;-webkit-print-color-adjust:exact;print-color-adjust:exact}.capture-vehicle{display:flex;flex-wrap:wrap;gap:4px 8px;font-size:calc(14px * var(--row-scale));line-height:1.3}.capture-vehicle strong{flex:1;min-width:150px}.capture-vehicle b{color:#715000}.capture-customer{margin-top:3px;color:#334b68}
      .capture-times{display:grid;grid-template-columns:1fr 1fr;gap:4px;margin-top:5px;font-size:calc(11px * var(--row-scale))}.capture-times span,.capture-locations span{font-weight:700}.capture-locations{margin-top:4px;white-space:pre-line;font-size:calc(11.5px * var(--row-scale))}
      .capture-money{display:grid;grid-template-columns:repeat(3,1fr);gap:4px;border-top:1px solid #9cacbc88;padding-top:5px;margin-top:5px;font-variant-numeric:tabular-nums}.capture-money span{display:block;font-size:calc(10px * var(--row-scale));color:#44576c}.capture-money b{display:block;min-height:1.35em}.capture-money>div:last-child{color:#b42318}
      .capture-footer{display:flex;justify-content:space-between;gap:8px;border-top:1px solid #b2c1d1;padding-top:6px;margin-top:6px;font-size:10px}.capture-mode.capture-focus{padding:0}.capture-focus>.noprint{display:none}
      @media print{.capture-mode{background:white!important;padding:0!important}.capture-mode>.print-sheets{display:none!important}.capture-mode .capture-pages{display:block!important;width:auto!important;height:auto!important;margin:0!important}.capture-mode .capture-pages>.capture-page{display:flex!important;transform:none!important;box-shadow:none!important;break-after:page;page-break-after:always}.capture-mode .capture-pages>.capture-page:last-child{break-after:auto;page-break-after:auto}.capture-measure{display:none!important}.capture-controls,.capture-help{display:none!important}}
    `;document.head.append(style);
    const selector=controls.querySelector('select'),previous=controls.querySelector('#capture-prev'),next=controls.querySelector('#capture-next'),counter=controls.querySelector('#capture-count'),focus=controls.querySelector('#capture-focus');
    let current=0,pages=[],profile=null,layoutKey='';
    function displayScale(){
      if(!profile)return;
      const focused=document.body.classList.contains('capture-focus');
      const availableWidth=Math.max(1,root.innerWidth-(focused?0:24));
      const availableHeight=Math.max(1,(root.visualViewport?.height||root.innerHeight)-(focused?0:toolbar.getBoundingClientRect().height+36));
      const zoom=Math.min(1,availableWidth/profile.width,availableHeight/profile.height);
      document.body.style.setProperty('--capture-zoom',String(zoom));
      document.body.style.setProperty('--capture-display-width',profile.width*zoom+'px');document.body.style.setProperty('--capture-display-height',profile.height*zoom+'px');
    }
    function show(index){
      current=Math.max(0,Math.min(index,pages.length-1));
      [...pagesRoot.children].forEach((page,i)=>page.classList.toggle('is-current',i===current));
      counter.textContent=pages.length?(current+1)+' / '+pages.length:'';previous.disabled=current===0;next.disabled=current>=pages.length-1;
    }
    function buildPage(items){
      const page=document.createElement('section');page.className='capture-page'+(profile?.width>=600?' wide':'');
      const heading=document.createElement('header');heading.className='capture-heading';heading.innerHTML=`<h1>경일렌트카 일정표</h1><p>${escape(config.range)} · 총 ${rows.length}건</p>`;page.append(heading);
      const content=document.createElement('div');content.className='capture-content';let lastDay='';
      for(const row of items){
        if(lastDay!==row.배차일){lastDay=row.배차일;const day=document.createElement('div');day.className='capture-day';const date=new Date(lastDay+'T00:00:00Z');day.textContent=Number.isNaN(date.getTime())?lastDay:new Intl.DateTimeFormat('ko-KR',{timeZone:'UTC',month:'long',day:'numeric',weekday:'short'}).format(date);content.append(day)}
        const holder=document.createElement('div');holder.innerHTML=renderCaptureRow(row,row.captureIndex);content.append(holder.firstElementChild);
      }
      page.append(content);const footer=document.createElement('footer');footer.className='capture-footer';footer.innerHTML='<span>경일렌트카 · 010-4164-2820</span><span class="capture-page-number">999 / 999</span>';page.append(footer);return page;
    }
    function paginate(){
      const key=selector.value;
      if(key==='a4'){
        profile=null;document.body.classList.remove('capture-mode','capture-focus');pageRule.textContent='';
        [previous,next,counter,focus,help].forEach(el=>el.hidden=true);return;
      }
      profile=PHONE_PROFILES[key]||{label:'내 화면',width:Math.max(240,root.innerWidth),height:Math.max(320,root.innerHeight)};
      [previous,next,counter,focus,help].forEach(el=>el.hidden=false);document.body.classList.add('capture-mode');
      document.body.style.setProperty('--capture-width',profile.width+'px');document.body.style.setProperty('--capture-height',profile.height+'px');
      pageRule.textContent='@page{size:'+(profile.width*25.4/96).toFixed(4)+'mm '+(profile.height*25.4/96).toFixed(4)+'mm;margin:0}';
      rows.forEach(row=>delete row.captureScale);
      const fits=items=>{const page=buildPage(items);measure.replaceChildren(page);const content=page.querySelector('.capture-content');return content.scrollHeight<=content.clientHeight};
      const fitOversize=row=>{let low=0.1,high=1;for(let i=0;i<12;i++){row.captureScale=(low+high)/2;if(fits([row]))low=row.captureScale;else high=row.captureScale}row.captureScale=low};
      pages=packCaptureRows(rows,fits,fitOversize);const elements=pages.map(buildPage);
      elements.forEach((page,index)=>{page.querySelector('.capture-page-number').textContent=(index+1)+' / '+pages.length;page.setAttribute('aria-label','일정표 '+(index+1)+'페이지');page.addEventListener('click',()=>{if(document.body.classList.contains('capture-focus')){document.body.classList.remove('capture-focus');displayScale()}})});
      pagesRoot.replaceChildren(...elements);measure.replaceChildren();layoutKey=key;show(current);displayScale();
    }
    selector.addEventListener('change',()=>{current=0;paginate()});previous.addEventListener('click',()=>show(current-1));next.addEventListener('click',()=>show(current+1));focus.addEventListener('click',()=>{document.body.classList.add('capture-focus');displayScale()});
    document.addEventListener('keydown',event=>{if(event.key==='Escape'){document.body.classList.remove('capture-focus');displayScale()}});
    root.addEventListener('resize',()=>{if(selector.value==='auto')paginate();else displayScale()});root.visualViewport?.addEventListener('resize',displayScale);
    root.addEventListener('beforeprint',()=>{if(profile&&layoutKey!==selector.value)paginate()});
    selector.value=config.mode==='capture'?(root.innerWidth>820?'iphone17pro':'auto'):'a4';paginate();document.fonts.ready.then(paginate);
    printButton.setAttribute('aria-label','선택한 비율로 인쇄 또는 PDF 저장');
  }
  if(typeof module!=='undefined'&&module.exports)module.exports={PHONE_PROFILES,packCaptureRows,renderCaptureRow};
  else if(root.document){const config=root.document.getElementById('schedule-capture-config');if(config)start(root.document,JSON.parse(config.textContent))}
})(typeof window==='undefined'?this:window);
