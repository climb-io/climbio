import '../../../js/mascot-motion.js';
// 正式 SVG 是唯一靜態幾何來源；只在記憶體中拆組與變形，不載入 App 或資料服務。
const $ = id => document.getElementById(id);
export const scenarios = {
  receive: ['收到路線', 2200, '接住卡片、受力壓扁，回彈後看卡點頭。'],
  'tour-in': ['導引出場', 3000, '新版無臉岩點軟化彈起，逐步展開耳朵與表情。'],
  'tour-out': ['導引收場', 3400, '揮手、收耳、收臉；岩點穩定停留 400 ms 後退場。'],
  view: ['看路線', 1800, '外緣斜伸，視線先沿路線上移，再回彈歸位。'],
  set: ['點擊定線', 1800, '一側外緣探出，點亮目標岩點後收回。'],
  repair: ['長按修岩點', 2400, '前伸查看放大鏡，確認修正後收回點頭。'],
  scan: ['掃描岩點', 2400, '呼吸與掃描框；只在成功找到岩點時歡呼。'],
  record: ['記錄', 2600, 'Sent：壓扁起跳 → 落地圓鼓鼓 → 果凍回彈 → 收耳收臉回到岩點。'],
  share: ['分享', 2200, '兩側外緣推送卡片，前伸回彈並揮手。'],
  'find-wall': ['找牆面', 2000, '左右張望，候選牆面出現後耳朵微豎。'],
  'idle-stretch': ['伸懶腰', 2400, '縱向伸展、回彈，再打個哈欠。'],
  'idle-full': ['吃飽鼓起', 2200, '小岩點飛來，身體圓鼓鼓，輕打嗝回復。'],
  'idle-bounce': ['果凍彈跳', 1900, '預備壓扁、拉長起跳，落地後兩次衰減回彈。'],
};
const scanLabels = { running: '掃描中', success: '找到岩點 ✓', empty: '未找到岩點', error: '掃描失敗', cancelled: '已取消掃描' };
const recordLabels = { sent: 'Sent ✓', flash: 'Flash ϟ', attempt: '嘗試中' };
const source = await (await fetch('../cats/hold-cat.svg')).text();
// 預覽和手機 App 直接共用相同的局部變形引擎。
function createActor(kind, variant) {
  const container=document.createElement('div');container.className='actor';
  const svg=new DOMParser().parseFromString(source,'image/svg+xml').documentElement;
  const actor=ClimbioMotion.attach(svg);
  const status=document.createElement('span');status.className='status';status.setAttribute('role','status');
  container.append(svg,status);$('stage').append(container);
  return {kind,variant,container,render(t,reduced){
    actor.render(kind,variant,t,reduced);
    container.style.opacity=svg.style.opacity;svg.style.opacity='1';
    container.dataset.rock=svg.dataset.rock;container.dataset.face=svg.dataset.face;
    status.textContent=kind==='record'?recordLabels[variant]:kind==='scan'?(variant==='running'||t<.65?scanLabels.running:scanLabels[variant]):kind==='repair'&&t>.7?'修正完成 ✓':kind==='receive'&&t>.65?'已收到 ✓':kind==='share'&&t>.65?'已分享 ✓':kind==='find-wall'&&t>.5?'候選牆面':'';
  }};
}
const clamp=v=>Math.max(0,Math.min(1,v));
let actors=[],key='record',variant='sent',comparison=false,raf=0,elapsed=0,last=0,playing=false;
const media=matchMedia('(prefers-reduced-motion: reduce)');
$('reduced').checked=media.matches;
const reduced=()=>$('reduced').checked||media.matches;
const duration=()=>comparison?ClimbioMotion.duration('record','flash'):key==='record'?ClimbioMotion.duration('record',variant):scenarios[key][1];
function render(){ const d=duration(); for(const actor of actors) actor.render(clamp(elapsed/(actor.kind==='record'?ClimbioMotion.duration('record',actor.variant):d)),reduced()); $('seek').value=String(clamp(elapsed/d)); $('time').value=`${(elapsed/1000).toFixed(2)} s`; }
function stop(){cancelAnimationFrame(raf);raf=0;playing=false;last=0;}
function frame(now){ if(!playing)return; if(last)elapsed=Math.min(duration(),elapsed+(now-last)*Number($('speed').value));last=now;render();if(elapsed<duration())raf=requestAnimationFrame(frame);else{stop();$('pause').textContent='繼續';$('playState').textContent='播放完成';} }
function play(){ stop(); if(reduced()){elapsed=duration();render();$('playState').textContent='減少動態：靜態狀態';return;} playing=true;$('pause').textContent='暫停';$('playState').textContent='播放中';raf=requestAnimationFrame(frame); }
function setup(){ stop();$('stage').replaceChildren();$('stage').classList.toggle('compare',comparison);actors=comparison?[createActor('record','sent'),createActor('record','flash')]:[createActor(key,variant)];elapsed=0;$('title').textContent=comparison?'Sent / Flash':key==='record'?recordLabels[variant]:scenarios[key][0];$('duration').textContent=comparison?'2.6 / 2.8 秒':`${duration()/1000} 秒`;$('description').textContent=comparison?'左：起跳落地後圓鼓鼓。右：伸長高跳再彈一次。兩者都收耳收臉回到岩點。':key==='record'&&variant==='flash'?'Flash：壓扁 → 伸長高跳 → 落地再彈一次 → 收耳收臉回到岩點。':key==='record'&&variant==='attempt'?'嘗試中：短暫喘氣，不做完攀慶祝。':scenarios[key][2];$('compare').setAttribute('aria-pressed',String(comparison));render();play(); }
function selectScenario(next,sub){key=next;$('scenario').value=key;comparison=false;const choices=key==='record'?recordLabels:key==='scan'?scanLabels:null;$('variantLabel').hidden=!choices;$('variant').replaceChildren();if(choices)for(const [value,label]of Object.entries(choices))$('variant').add(new Option(label,value));variant=choices&&Object.hasOwn(choices,sub)?sub:Object.keys(choices||{default:0})[0];$('variant').value=variant;setup();}
for(const [value,[label]]of Object.entries(scenarios))$('scenario').add(new Option(label,value));
for(const size of [20,32,48,64,104]){const figure=document.createElement('figure');figure.innerHTML=`<img src="../cats/hold-cat.svg" width="${size}" height="${size}" alt=""><figcaption>${size}px</figcaption>`;$('sizes').append(figure);}
$('scenario').onchange=()=>selectScenario($('scenario').value);
$('variant').onchange=()=>{variant=$('variant').value;comparison=false;setup();};
$('sent').onclick=()=>selectScenario('record','sent');$('flash').onclick=()=>selectScenario('record','flash');$('compare').onclick=()=>{comparison=!comparison;setup();};
$('replay').onclick=()=>{elapsed=0;render();play();};
$('pause').onclick=()=>{if(playing){stop();$('pause').textContent='繼續';$('playState').textContent='已暫停';}else{if(elapsed>=duration())elapsed=0;play();}};
$('cancel').onclick=()=>{stop();elapsed=0;render();$('pause').textContent='繼續';$('playState').textContent='已取消';};
$('seek').oninput=()=>{stop();elapsed=Number($('seek').value)*duration();render();$('pause').textContent='繼續';$('playState').textContent='逐格檢視';};
$('reduced').onchange=()=>{stop();$('pause').textContent='繼續';render();$('playState').textContent=reduced()?'減少動態：靜態狀態':'已暫停';};
media.onchange=()=>{$('reduced').checked=media.matches;stop();$('pause').textContent='繼續';render();};
for(const event of ['pagehide','popstate'])addEventListener(event,()=>{stop();elapsed=0;render();});
document.addEventListener('visibilitychange',()=>{if(document.hidden){stop();$('pause').textContent='繼續';$('playState').textContent='已暫停';}});
// 驗收工具使用同一個正式渲染路徑，可精準檢查時間點而不額外產生 timer。
window.motionPreview={select:selectScenario,seek(ms){stop();elapsed=Math.min(duration(),Math.max(0,ms));render();},get state(){return{key,variant,comparison,playing,elapsed,duration:duration(),reduced:reduced()};}};
const query=new URLSearchParams(location.search);
selectScenario(Object.hasOwn(scenarios,query.get('scene'))?query.get('scene'):'record',query.get('state')||'sent');
if(query.get('compare')==='1'){comparison=true;setup();}
