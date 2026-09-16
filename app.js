(() => {
  'use strict';
  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => [...root.querySelectorAll(s)];
  const config = window.XIXI_CONFIG || {};
  const siteName = config.siteName || 'Xixi';
  const greetingText = config.greetingText || '老公你回来啦，今天辛苦啦';
  const defaultPerson = config.defaultPerson || 'assets/default-person.jpg';
  const defaultBackground = config.defaultBackground || 'assets/hotel-window.jpg';
  document.title = `${siteName} · 互动场景`;
  $('.brand span:last-child').textContent = siteName;
  $('#speechBubble').textContent = greetingText;
  const scene = $('#scene'), canvas = $('#layerCanvas'), bg = $('#sceneBackground');
  const openingLayer = { id:'default-person', staticSrc:defaultPerson, name:'默认主图', x:26, y:18, w:48, h:64, opacity:1, z:10, action:'audio' };
  const defaults = { version:5, background:defaultBackground, layers:[], audios:[], greetingAudioId:'', speechText:greetingText, voice:'', rate:.88, pitch:.92, loop:false, hotspots:true, motion:true, remember:false };
  let state = loadState(), selectedId = null, audioEl = new Audio(), playlistIndex = 0, saveTimer, bubbleTimer;
  let assetUrls = new Map();

  const dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open('homecoming-studio', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('assets', { keyPath:'id' });
    req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);
  });
  async function dbPut(record){ const db=await dbPromise; return new Promise((res,rej)=>{const tx=db.transaction('assets','readwrite');tx.objectStore('assets').put(record);tx.oncomplete=res;tx.onerror=()=>rej(tx.error);}); }
  async function dbGet(id){ const db=await dbPromise; return new Promise((res,rej)=>{const q=db.transaction('assets').objectStore('assets').get(id);q.onsuccess=()=>res(q.result);q.onerror=()=>rej(q.error);}); }
  async function dbDelete(id){ const db=await dbPromise; return new Promise((res,rej)=>{const tx=db.transaction('assets','readwrite');tx.objectStore('assets').delete(id);tx.oncomplete=res;tx.onerror=()=>rej(tx.error);}); }
  async function assetUrl(id){ if(assetUrls.has(id)) return assetUrls.get(id); const rec=await dbGet(id); if(!rec) return ''; const url=URL.createObjectURL(rec.blob); assetUrls.set(id,url); return url; }
  function uid(prefix='a'){ return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,8)}`; }
  function freshState(){return {...defaults,layers:[{...openingLayer}],audios:[]};}
  function loadState(){try{const raw=localStorage.getItem('homecoming-scene');if(!raw)return freshState();const saved=JSON.parse(raw);if(!saved.remember){localStorage.removeItem('homecoming-scene');return freshState();}if(saved.version!==defaults.version){const migrated={...freshState(),...saved,version:defaults.version,remember:true,layers:[{...openingLayer},...(saved.layers||[]).filter(x=>x.id!==openingLayer.id)]};localStorage.setItem('homecoming-scene',JSON.stringify(migrated));return migrated;}return {...freshState(),...saved};}catch{return freshState();}}
  function persist(){clearTimeout(saveTimer);if(!state.remember){localStorage.removeItem('homecoming-scene');$('#saveState').textContent='未保存 · 到“场景”中开启';return;}$('#saveState').textContent='正在保存…';saveTimer=setTimeout(()=>{localStorage.setItem('homecoming-scene',JSON.stringify(state));$('#saveState').textContent='已自动保存到本机';},220);}
  function toast(msg){ const el=$('#toast');el.textContent=msg;el.classList.add('show');clearTimeout(el._t);el._t=setTimeout(()=>el.classList.remove('show'),1800); }
  function sceneSize(){return {w:scene.clientWidth,h:scene.clientHeight};}

  async function render(){
    bg.src = state.background.startsWith('asset:') ? await assetUrl(state.background.slice(6)) : state.background;
    canvas.innerHTML='';
    for(const layer of state.layers){
      const el=document.createElement('div'); el.className='photo-layer'+(layer.id===selectedId?' selected':'')+(state.motion?' float':''); el.dataset.id=layer.id;
      el.style.width=`${layer.w}%`; el.style.height=`${layer.h}%`; el.style.opacity=layer.opacity; el.style.zIndex=layer.z;
      el.style.left=`${layer.x}%`; el.style.top=`${layer.y}%`; el.style.transform=`rotate(${layer.r||0}deg)`;
      const img=document.createElement('img'); img.alt=layer.name||'上传的照片'; img.src=layer.staticSrc||await assetUrl(layer.assetId); el.append(img);
      const handle=document.createElement('span');handle.className='resize-handle';handle.setAttribute('aria-label','缩放');el.append(handle);
      const rotateHandle=document.createElement('button');rotateHandle.type='button';rotateHandle.className='rotate-handle';rotateHandle.textContent='↻';rotateHandle.setAttribute('aria-label','拖动旋转，点一下右转十五度');el.append(rotateHandle);
      bindLayer(el,layer,handle,rotateHandle);canvas.append(el);
    }
    scene.classList.toggle('motion',state.motion); $('#welcomeHotspot').hidden=!state.hotspots;$('#waterHotspot').hidden=!state.hotspots;
    syncControls();
  }
  function bindLayer(el, layer, handle, rotateHandle){
    let drag=null, moved=false, gesture=null;const pointers=new Map();
    const angle=()=>{const p=[...pointers.values()];return Math.atan2(p[1].y-p[0].y,p[1].x-p[0].x)*180/Math.PI;};
    el.addEventListener('pointerdown',e=>{if(e.target===handle||e.target===rotateHandle)return;e.preventDefault();select(layer.id);moved=false;pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});el.setPointerCapture(e.pointerId);if(pointers.size===1){const p=pointerPct(e);drag={x:p.x-layer.x,y:p.y-layer.y};}else if(pointers.size===2){gesture={angle:angle(),rotation:layer.r||0};drag=null;moved=true;}});
    el.addEventListener('pointermove',e=>{if(!pointers.has(e.pointerId))return;pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});if(gesture&&pointers.size>=2){layer.r=normalizeAngle(gesture.rotation+angle()-gesture.angle);el.style.transform=`rotate(${layer.r}deg)`;$('#rotationRange').value=Math.round(layer.r);$('#rotationValue').value=`${Math.round(layer.r)}°`;moved=true;return;}if(!drag)return;const p=pointerPct(e);if(Math.abs(p.x-drag.x-layer.x)>1||Math.abs(p.y-drag.y-layer.y)>1)moved=true;layer.x=clamp(p.x-drag.x,-layer.w*.7,100-layer.w*.3);layer.y=clamp(p.y-drag.y,-layer.h*.7,100-layer.h*.3);el.style.left=`${layer.x}%`;el.style.top=`${layer.y}%`;});
    const endPointer=e=>{const had=pointers.has(e.pointerId);pointers.delete(e.pointerId);if(!had)return;if(pointers.size<2)gesture=null;if(!pointers.size){drag=null;persist();if(!moved)triggerLayer(layer,el);}};
    el.addEventListener('pointerup',endPointer);el.addEventListener('pointercancel',endPointer);
    handle.addEventListener('pointerdown',e=>{e.preventDefault();e.stopPropagation();select(layer.id);const start={x:e.clientX,w:layer.w,h:layer.h};handle.setPointerCapture(e.pointerId);handle._resize=start;});
    handle.addEventListener('pointermove',e=>{if(!handle._resize)return;const {w}=sceneSize();const nw=clamp(handle._resize.w+(e.clientX-handle._resize.x)/w*100,8,120);const ratio=layer.h/layer.w;layer.w=nw;layer.h=nw*ratio;el.style.width=`${layer.w}%`;el.style.height=`${layer.h}%`;});
    handle.addEventListener('pointerup',()=>{handle._resize=null;persist();});
    rotateHandle.addEventListener('pointerdown',e=>{e.preventDefault();e.stopPropagation();select(layer.id);const r=el.getBoundingClientRect(),cx=r.left+r.width/2,cy=r.top+r.height/2;rotateHandle._rotate={cx,cy,start:Math.atan2(e.clientY-cy,e.clientX-cx)*180/Math.PI,rotation:layer.r||0,moved:false};rotateHandle.setPointerCapture(e.pointerId);});
    rotateHandle.addEventListener('pointermove',e=>{const g=rotateHandle._rotate;if(!g)return;const current=Math.atan2(e.clientY-g.cy,e.clientX-g.cx)*180/Math.PI,delta=current-g.start;if(Math.abs(delta)>2)g.moved=true;layer.r=normalizeAngle(g.rotation+delta);el.style.transform=`rotate(${layer.r}deg)`;$('#rotationRange').value=Math.round(layer.r);$('#rotationValue').value=`${Math.round(layer.r)}°`;});
    rotateHandle.addEventListener('pointerup',()=>{const g=rotateHandle._rotate;if(!g)return;if(!g.moved){layer.r=normalizeAngle((layer.r||0)+15);el.style.transform=`rotate(${layer.r}deg)`;$('#rotationRange').value=Math.round(layer.r);$('#rotationValue').value=`${Math.round(layer.r)}°`;}rotateHandle._rotate=null;persist();});
  }
  function pointerPct(e){const r=scene.getBoundingClientRect();return{x:(e.clientX-r.left)/r.width*100,y:(e.clientY-r.top)/r.height*100};}
  const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
  const normalizeAngle=v=>((v+180)%360+360)%360-180;
  function select(id){selectedId=id;$$('.photo-layer').forEach(el=>el.classList.toggle('selected',el.dataset.id===id));syncControls();}
  function selected(){return state.layers.find(x=>x.id===selectedId);}
  function syncControls(){
    const l=selected();$('#selectionEmpty').hidden=!!l;$('#selectionControls').hidden=!l;
    if(l){$('#selectedName').textContent=l.name;$('#opacityRange').value=Math.round(l.opacity*100);$('#opacityValue').value=`${Math.round(l.opacity*100)}%`;$('#rotationRange').value=Math.round(l.r||0);$('#rotationValue').value=`${Math.round(l.r||0)}°`;$('#layerAction').value=l.action||'none';}
    $('#speechText').value=state.speechText;$('#rateRange').value=state.rate;$('#rateValue').value=state.rate;$('#pitchRange').value=state.pitch;$('#pitchValue').value=state.pitch;$('#audioLoop').checked=state.loop;$('#showHotspots').checked=state.hotspots;$('#motionToggle').checked=state.motion;$('#rememberToggle').checked=state.remember;$('#saveState').textContent=state.remember?'已自动保存到本机':'未保存 · 到“场景”中开启';
    $$('.bg-option[data-bg]').forEach(x=>x.classList.toggle('active',x.dataset.bg===state.background));
  }
  async function addImages(files){
    for(const file of files){if(!file.type.startsWith('image/'))continue;const assetId=uid('img');await dbPut({id:assetId,blob:file,name:file.name,type:file.type});const dims=await imageDims(URL.createObjectURL(file));let w=32,h=w*dims.h/dims.w*(scene.clientWidth/scene.clientHeight);if(h>70){h=70;w=h*dims.w/dims.h*(scene.clientHeight/scene.clientWidth)};const layer={id:uid('layer'),assetId,name:file.name,x:34+Math.random()*5,y:25+Math.random()*5,w,h,opacity:1,z:nextZ(),action:'none'};state.layers.push(layer);selectedId=layer.id;}
    persist();await render();toast(`已添加 ${files.length} 个图片`);
  }
  function imageDims(url){return new Promise(res=>{const i=new Image();i.onload=()=>{res({w:i.naturalWidth,h:i.naturalHeight});URL.revokeObjectURL(url)};i.src=url;});}
  function nextZ(){return Math.max(0,...state.layers.map(x=>x.z))+1;}
  function reorder(mode){const l=selected();if(!l)return;const sorted=[...state.layers].sort((a,b)=>a.z-b.z);const i=sorted.findIndex(x=>x.id===l.id);if(mode==='up'&&i<sorted.length-1)[sorted[i].z,sorted[i+1].z]=[sorted[i+1].z,sorted[i].z];if(mode==='down'&&i>0)[sorted[i].z,sorted[i-1].z]=[sorted[i-1].z,sorted[i].z];if(mode==='front')l.z=Math.max(...sorted.map(x=>x.z))+1;if(mode==='back')l.z=Math.min(...sorted.map(x=>x.z))-1;persist();render();}
  async function deleteLayer(){const l=selected();if(!l)return;state.layers=state.layers.filter(x=>x.id!==l.id);if(l.assetId){await dbDelete(l.assetId);const url=assetUrls.get(l.assetId);if(url)URL.revokeObjectURL(url);assetUrls.delete(l.assetId);}selectedId=null;persist();render();toast('照片已删除');}
  function triggerLayer(layer,el){el.classList.remove('tap-pop');void el.offsetWidth;el.classList.add('tap-pop');if(layer.action==='speak')speak();if(layer.action==='water')playWater();if(layer.action==='audio')playWelcome();}

  function loadVoices(){const voices=speechSynthesis.getVoices();const select=$('#voiceSelect'),old=state.voice;select.innerHTML='<option value="">自动选择中文男声</option>';voices.filter(v=>/^zh/i.test(v.lang)).forEach(v=>{const o=document.createElement('option');o.value=v.name;o.textContent=`${v.name} · ${v.lang}`;select.append(o)});select.value=old;}
  function speak(){if(!('speechSynthesis'in window)){toast('当前浏览器不支持文字朗读');return;}speechSynthesis.cancel();const u=new SpeechSynthesisUtterance(state.speechText.trim()||defaults.speechText);const voices=speechSynthesis.getVoices();u.voice=voices.find(v=>v.name===state.voice)||voices.find(v=>/^zh/i.test(v.lang)&&/male|yunxi|yunjian|kangkang|male/i.test(v.name))||voices.find(v=>/^zh/i.test(v.lang))||null;u.lang='zh-CN';u.rate=state.rate;u.pitch=state.pitch;speechSynthesis.speak(u);showBubble(u.text);}
  function showBubble(text){const b=$('#speechBubble');b.textContent=text;b.classList.add('show');clearTimeout(bubbleTimer);bubbleTimer=setTimeout(()=>b.classList.remove('show'),3200);}
  let waterCtx;
  function playWater(){const AC=window.AudioContext||window.webkitAudioContext;if(!AC){toast('当前浏览器不支持流水声');return;}waterCtx?.close();const ctx=new AC();waterCtx=ctx;const len=ctx.sampleRate*3,buf=ctx.createBuffer(1,len,ctx.sampleRate),d=buf.getChannelData(0);let last=0;for(let i=0;i<len;i++){const white=Math.random()*2-1;last=last*.965+white*.035;d[i]=last*(.45+.2*Math.sin(i/530));}const src=ctx.createBufferSource(),filter=ctx.createBiquadFilter(),gain=ctx.createGain();src.buffer=buf;filter.type='bandpass';filter.frequency.value=900;filter.Q.value=.7;gain.gain.setValueAtTime(.01,ctx.currentTime);gain.gain.exponentialRampToValueAtTime(.38,ctx.currentTime+.16);gain.gain.exponentialRampToValueAtTime(.01,ctx.currentTime+2.9);src.connect(filter).connect(gain).connect(ctx.destination);src.start();src.stop(ctx.currentTime+3);toast('潺潺水声');}

  async function addAudios(files){for(const file of files){if(!file.type.startsWith('audio/'))continue;const id=uid('audio');await dbPut({id,blob:file,name:file.name,type:file.type});state.audios.push({id,name:file.name});if(!state.greetingAudioId)state.greetingAudioId=id;}persist();renderAudioList();toast(`已添加 ${files.length} 个音频`);}
  function renderAudioList(){const list=$('#audioList');list.innerHTML='';state.audios.forEach((a,i)=>{const row=document.createElement('div');row.className='audio-item';row.innerHTML=`<button aria-label="播放">▶</button><span class="audio-name"></span><button class="set-greeting" aria-label="设为问候"></button><button aria-label="删除">×</button>`;$('.audio-name',row).textContent=a.name;const set=$('.set-greeting',row),active=state.greetingAudioId===a.id;set.textContent=active?'已设问候':'设为问候';set.classList.toggle('active',active);row.firstElementChild.onclick=()=>playAudioAt(i);set.onclick=()=>{state.greetingAudioId=a.id;persist();renderAudioList();toast('已设为欢迎问候')};row.lastElementChild.onclick=()=>removeAudio(i);list.append(row)});}
  async function playAudioAt(i){if(!state.audios[i])return;playlistIndex=i;audioEl.src=await assetUrl(state.audios[i].id);audioEl.play().catch(()=>toast('请再点一次播放'));}
  async function removeAudio(i){const [a]=state.audios.splice(i,1);await dbDelete(a.id);assetUrls.delete(a.id);if(state.greetingAudioId===a.id)state.greetingAudioId=state.audios[0]?.id||'';persist();renderAudioList();}
  async function playWelcome(){const i=state.audios.findIndex(a=>a.id===state.greetingAudioId);showBubble(state.speechText.trim()||defaults.speechText);if(i>=0)await playAudioAt(i);}
  audioEl.addEventListener('ended',()=>{if(!state.audios.length)return;if(playlistIndex<state.audios.length-1)playAudioAt(playlistIndex+1);else if(state.loop)playAudioAt(0);});
  function stopAudio(){audioEl.pause();audioEl.currentTime=0;speechSynthesis?.cancel();waterCtx?.close();}

  async function simpleCutout(){
    const l=selected();if(!l)return;if(!l.assetId){toast('默认主图暂不做自动抠图');return;}const rec=await dbGet(l.assetId);if(!rec||rec.type==='image/gif'){toast('GIF 暂不支持抠图');return;}toast('正在本地抠图…');
    try{const image=await createImageBitmap(rec.blob),c=document.createElement('canvas'),max=1400,scale=Math.min(1,max/Math.max(image.width,image.height));c.width=Math.round(image.width*scale);c.height=Math.round(image.height*scale);const x=c.getContext('2d',{willReadFrequently:true});x.drawImage(image,0,0,c.width,c.height);const im=x.getImageData(0,0,c.width,c.height),d=im.data,w=c.width,h=c.height;const samples=[];for(let xx=0;xx<w;xx+=Math.max(1,Math.floor(w/80))){samples.push(xx,(h-1)*w+xx)}for(let yy=0;yy<h;yy+=Math.max(1,Math.floor(h/80))){samples.push(yy*w,yy*w+w-1)}let r=0,g=0,b=0;samples.forEach(p=>{r+=d[p*4];g+=d[p*4+1];b+=d[p*4+2]});r/=samples.length;g/=samples.length;b/=samples.length;const seen=new Uint8Array(w*h),queue=new Int32Array(w*h),threshold=74;let head=0,tail=0;const add=p=>{if(p<0||p>=w*h||seen[p])return;const q=p*4,dist=Math.hypot(d[q]-r,d[q+1]-g,d[q+2]-b);if(dist<threshold){seen[p]=1;queue[tail++]=p}};for(let xx=0;xx<w;xx++){add(xx);add((h-1)*w+xx)}for(let yy=0;yy<h;yy++){add(yy*w);add(yy*w+w-1)}while(head<tail){const p=queue[head++],xx=p%w;d[p*4+3]=0;if(xx)add(p-1);if(xx<w-1)add(p+1);add(p-w);add(p+w)}x.putImageData(im,0,0);const blob=await new Promise(res=>c.toBlob(res,'image/png'));await dbPut({...rec,blob,type:'image/png',name:rec.name.replace(/\.[^.]+$/, '')+'-抠图.png'});assetUrls.delete(l.assetId);l.name=rec.name.replace(/\.[^.]+$/, '')+'-抠图.png';persist();render();toast('抠图完成，可继续拖动缩放');}catch(e){console.error(e);toast('这张图片暂时无法抠图');}
  }

  async function setBackground(src){state.background=src;persist();await render();}
  async function reset(){stopAudio();const remember=state.remember;for(const x of [...state.layers,...state.audios])if(x.assetId||!x.staticSrc)await dbDelete(x.assetId||x.id);await dbDelete('custom-bg');state=freshState();state.remember=remember;selectedId=null;persist();render();renderAudioList();toast('已恢复默认场景');}

  $$('.tab').forEach(tab=>tab.onclick=()=>{$$('.tab').forEach(x=>{const on=x===tab;x.classList.toggle('active',on);x.setAttribute('aria-selected',on)});$$('.panel').forEach(p=>{const on=p.dataset.panel===tab.dataset.tab;p.classList.toggle('active',on);p.hidden=!on})});
  $('#toggleEditor').onclick=()=>{const e=$('#editor');e.classList.toggle('collapsed');$('#toggleEditor').setAttribute('aria-expanded',!e.classList.contains('collapsed'))};
  $('#imageInput').onchange=e=>{addImages([...e.target.files]);e.target.value=''};
  $('#audioInput').onchange=e=>{addAudios([...e.target.files]);e.target.value=''};
  $('#backgroundInput').onchange=async e=>{const file=e.target.files[0];if(!file)return;const id='custom-bg';await dbPut({id,blob:file,name:file.name,type:file.type});assetUrls.delete(id);setBackground(`asset:${id}`);e.target.value=''};
  $$('.bg-option[data-bg]').forEach(x=>x.onclick=()=>setBackground(x.dataset.bg));
  $('#opacityRange').oninput=e=>{const l=selected();if(!l)return;l.opacity=e.target.value/100;$('#opacityValue').value=`${e.target.value}%`;const el=$(`.photo-layer[data-id="${l.id}"]`);if(el)el.style.opacity=l.opacity;persist()};
  $('#rotationRange').oninput=e=>{const l=selected();if(!l)return;l.r=+e.target.value;$('#rotationValue').value=`${l.r}°`;const el=$(`.photo-layer[data-id="${l.id}"]`);if(el)el.style.transform=`rotate(${l.r}deg)`;persist()};
  function rotateSelected(delta){const l=selected();if(!l)return;l.r=normalizeAngle((l.r||0)+delta);$('#rotationRange').value=Math.round(l.r);$('#rotationValue').value=`${Math.round(l.r)}°`;const el=$(`.photo-layer[data-id="${l.id}"]`);if(el)el.style.transform=`rotate(${l.r}deg)`;persist();}
  $('#rotateLeft').onclick=()=>rotateSelected(-15);$('#rotateRight').onclick=()=>rotateSelected(15);
  $('#layerAction').onchange=e=>{const l=selected();if(l){l.action=e.target.value;persist()}};
  $('#deleteLayer').onclick=deleteLayer;$('#layerUp').onclick=()=>reorder('up');$('#layerDown').onclick=()=>reorder('down');$('#layerFront').onclick=()=>reorder('front');$('#layerBack').onclick=()=>reorder('back');$('#removeBackground').onclick=simpleCutout;
  $('#speechText').oninput=e=>{state.speechText=e.target.value;persist()};$('#voiceSelect').onchange=e=>{state.voice=e.target.value;persist()};
  $('#rateRange').oninput=e=>{state.rate=+e.target.value;$('#rateValue').value=state.rate;persist()};$('#pitchRange').oninput=e=>{state.pitch=+e.target.value;$('#pitchValue').value=state.pitch;persist()};
  $('#speakButton').onclick=speak;$('#welcomeHotspot').onclick=playWelcome;$('#waterHotspot').onclick=playWater;
  $('#audioLoop').onchange=e=>{state.loop=e.target.checked;persist()};$('#playAll').onclick=()=>playAudioAt(0);$('#stopAll').onclick=stopAudio;
  $('#showHotspots').onchange=e=>{state.hotspots=e.target.checked;persist();render()};$('#motionToggle').onchange=e=>{state.motion=e.target.checked;persist();render()};$('#resetScene').onclick=()=>{if(confirm('确认删除这台设备上保存的照片、音频和设置吗？'))reset()};
  $('#rememberToggle').onchange=e=>{state.remember=e.target.checked;persist();toast(state.remember?'以后会在这台设备继续使用本次设置':'本次设置不保存，下次显示默认页面')};
  scene.addEventListener('pointerdown',e=>{if(e.target===scene||e.target===bg||e.target===canvas){selectedId=null;render()}});
  speechSynthesis.onvoiceschanged=loadVoices;loadVoices();render();renderAudioList();
  if('serviceWorker'in navigator)navigator.serviceWorker.register('./sw.js').catch(()=>{});
})();
