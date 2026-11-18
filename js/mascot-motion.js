// 預覽與手機共用正式 SVG 的局部果凍變形，不另存品牌幾何。
// English: Jelly-like SVG deformation and cancellable playback for the Holdcat mascot animations. Loaded before app.js.
const ClimbioMotion = (() => {
const attached = new WeakMap(), active = new Map();
const ns = 'http://www.w3.org/2000/svg';
const make = (tag, attrs = {}) => { const el = document.createElementNS(ns, tag); for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v); return el; };
const clamp = v => Math.max(0, Math.min(1, v));
const smooth = v => { v = clamp(v); return v * v * (3 - 2 * v); };
const mix = (a, b, v) => a + (b - a) * v;
const numbers = d => d.match(/-?\d*\.?\d+/g).map(Number);
const interpolatePath = (a, b, t) => { const target = numbers(b); let i = 0; return a.replace(/-?\d*\.?\d+/g, n => mix(+n, target[i++], t)); };
// 參數為寬、高、離地、外緣傾斜、局部鼓起、視線、眼睛張開程度。
const rest = [1, 1, 0, 0, 0, 0, 1];
// 完攀表演開始收耳收臉的時間點；收完的岩點停穩約 400 ms 再淡出。
const recordRock = { sent:.6, flash:.58 };
const frames = {
  // 完攀照果凍感方向：臉部五官穩定，只靠外圍身體壓扁、彈跳、圓鼓鼓，最後收耳收臉回到岩點。
  sent: [[0,...rest],[.1,1.2,.76,0,0,0,0,1],[.24,.84,1.32,170,0,-.04,0,1],[.34,1.24,.72,0,0,.04,0,1],[.48,1.3,.94,0,0,.2,0,1],[.56,1.24,.96,0,0,.18,0,1],[.64,.97,1.04,0,-.03,0,0,1],[.72,1.03,.97,0,.02,0,0,1],[.8,1,1,0,0,0,0,1],[1,...rest]],
  flash: [[0,...rest],[.07,1.16,.8,0,0,0,0,1],[.22,.78,1.46,230,0,-.05,0,1],[.33,1.26,.68,0,0,.04,0,1],[.42,.92,1.14,90,0,0,0,1],[.5,1.14,.86,0,0,.03,0,1],[.58,.96,1.05,0,-.04,0,0,1],[.65,1.03,.97,0,.02,0,0,1],[.72,1,1,0,0,0,0,1],[1,...rest]],
  bounce: [[0,...rest],[.12,1.18,.72,0,0,35,0,1],[.3,.8,1.38,140,0,-8,0,1],[.43,.94,1.12,180,0,0,0,1],[.55,1.25,.66,0,0,40,0,.8],[.66,.95,1.08,0,-.14,12,0,1],[.76,1.05,.95,0,.1,16,0,1],[.86,.98,1.03,0,-.05,6,0,1],[1,...rest]],
  stretch: [[0,...rest],[.3,.8,1.42,0,.06,20,-18,.5],[.55,.82,1.38,0,-.04,20,0,.2],[.7,1.13,.87,0,0,30,0,.5],[.8,.97,1.06,0,0,0,0,.7],[1,...rest]],
  full: [[0,...rest],[.25,1,1,0,-.06,0,-12,1],[.5,1.2,.91,0,0,110,0,.45],[.65,1.25,.87,0,0,120,0,.3],[.76,.98,1.1,25,0,32,0,1.2],[.86,1.04,.96,0,.04,12,0,.8],[1,...rest]],
  look: [[0,...rest],[.22,.97,1.07,0,-.12,18,-28,1],[.5,.96,1.12,0,.15,24,28,1],[.75,1.04,.97,0,-.05,14,0,1],[1,...rest]],
  reach: [[0,...rest],[.27,.96,1.06,0,.08,12,24,1],[.48,1.08,.94,0,.13,70,28,.9],[.68,.96,1.05,0,-.04,-12,0,.7],[.82,1.03,.97,0,.02,12,0,1],[1,...rest]],
  receive: [[0,...rest],[.25,1.16,.78,0,-.04,60,0,1.15],[.43,.94,1.1,20,.03,4,0,1],[.62,1.04,.95,0,0,14,0,.6],[.78,.99,1.02,0,0,0,0,.65],[1,...rest]],
  breath: [[0,...rest],[.25,1.02,.97,0,0,14,0,.8],[.5,.99,1.03,0,0,0,0,1],[.75,1.02,.97,0,0,14,0,.8],[1,...rest]],
};
function sample(list, t) {
  t = clamp(t); const hi = list.findIndex(f => f[0] >= t);
  if (hi <= 0) return list[0].slice(1);
  const a = list[hi - 1], b = list[hi], k = smooth((t - a[0]) / (b[0] - a[0]));
  return a.slice(1).map((v, i) => mix(v, b[i + 1], k));
}
function poseFor(kind, variant, t) {
  let name = { 'idle-stretch':'stretch', 'idle-full':'full', 'idle-bounce':'bounce', view:'look', 'find-wall':'look', set:'reach', repair:'reach', share:'reach', receive:'receive', scan:'breath', record:variant === 'attempt' ? 'breath' : variant, 'tour-in':'flash', 'tour-out':'look' }[kind];
  if (kind === 'scan' && variant === 'success' && t > .65) return sample(frames.receive, (t - .65) / .35);
  if (kind === 'scan' && ['empty','error','cancelled'].includes(variant) && t > .65) return rest;
  if (kind === 'tour-out') return sample(frames.look, clamp(t / .3));
  return sample(frames[name], t);
}
let serial = 0;
function attach(svg) {
  if (attached.has(svg)) return attached.get(svg);
  let kind, variant;
  svg.setAttribute('aria-hidden','true'); svg.removeAttribute('role'); svg.removeAttribute('aria-label'); svg.setAttribute('viewBox','-140 -340 1320 1480');
  const clip = svg.querySelector('clipPath'); const id = `motion-cutouts-${serial++}`; clip.id = id;
  const art = svg.querySelector('[clip-path]'); art.setAttribute('clip-path', `url(#${id})`);
  const [back, front, face, eye1, eye2, nose] = art.children;
  const frontOriginal = front.getAttribute('d'), backOriginal = back.getAttribute('d');
  const exterior = frontOriginal.split(' M283')[0];
  const plain = exterior.replace('C239 263 240 204 256 163 C266 136 289 135 308 146 L437 221','C239 295 240 284 256 277 C266 270 289 259 308 253 L437 221').replace('L643 62 C658 43 682 43 696 70','L643 174 C658 171 682 173 696 176');
  const ear1 = 'M283 213 Q291 193 305 206 L380 251 L284 299 Z';
  const ear2 = 'M654 154 Q668 134 678 148 L708 222 L615 219 Z';
  const faceGroup = make('g', { class:'jm-face' }); art.append(faceGroup); faceGroup.append(face, eye1, eye2, nose);
  const eyes = [eye1,eye2];
  const yawn = make('ellipse', { cx:550, cy:507, rx:16, ry:22, fill:'#233238' });
  faceGroup.append(yawn);
  const props = make('g', { fill:'none', stroke:'#a7a7ad', 'stroke-width':14, 'stroke-linecap':'round', 'stroke-linejoin':'round' });
  svg.append(props);
  // 每個控制點獨立受力；中腹鼓起、上緣傾斜、下緣固定，並非整張圖等比縮放。
  let localTime=0;
  const warp = (x, y, p) => {
    const [sx,sy,lift,lean,bulge] = p, h = clamp((840-y)/690);
    const side = Math.exp(-Math.pow((x-790)/130,2)-Math.pow((y-360)/180,2));
    const reach = kind==='set' ? Math.sin(clamp((localTime-.15)/.65)*Math.PI)*110*side : 0;
    const waveStart=kind==='share'?.64:.02, waveEnd=kind==='share'?.94:.26;
    const wavePhase=clamp((localTime-waveStart)/(waveEnd-waveStart));
    const wave=['share','tour-out'].includes(kind)?Math.sin(wavePhase*Math.PI*4)*Math.sin(wavePhase*Math.PI)*65*side:0;
    return [reach+510+(x-510)*sx + lean*(840-y) + Math.sin(h*Math.PI)*bulge*(x<510?-1:1), wave+840+(y-840)*sy-lift + Math.sin((x-100)/880*Math.PI)*bulge*.16*h];
  };
  const mapPath = (d,p,shrink=1,cx=0,cy=0) => { let index=0,x; return d.replace(/-?\d*\.?\d+/g, n => { if (index++%2===0) { x=cx+(+n-cx)*shrink; return '@'; } const [a,b]=warp(x,cy+(+n-cy)*shrink,p); return `${a.toFixed(3)},${b.toFixed(3)}`; }).replaceAll('@ ','').replaceAll('@',''); };
  const actor = { render(nextKind,nextVariant,t,reduced = false) {
    kind=nextKind; variant=nextVariant;
    localTime=reduced?0:t;
    let p = reduced ? rest : poseFor(kind,variant,t);
    let amount = kind==='record'&&variant!=='attempt' ? smooth((t-recordRock[variant])/.18) : kind==='tour-out' ? smooth((t*3400-952)/1648) : kind==='tour-in' ? 1-smooth((t-.12)/.5) : 0;
    if(kind==='find-wall'&&variant!=='running'&&!reduced) amount=-.08*Math.sin(clamp((t-.5)/.5)*Math.PI);
    if (reduced) amount = kind==='tour-out' ? 1 : 0;
    const delayed = reduced ? rest : poseFor(kind,variant,Math.max(0,t-.035*Math.sin(Math.PI*t)));
    const holes = mapPath(ear1,p,1-amount,308,287)+' '+mapPath(ear2,p,1-amount,664,217);
    const [hx,hy]=warp(570,738,p); const hole=`M${hx-35} ${hy}a35 35 0 1 0 70 0a35 35 0 1 0 -70 0Z`;
    const boundary=mapPath(interpolatePath(exterior,plain,amount),p);
    front.setAttribute('d',`${boundary} ${holes} ${hole}`);
    back.setAttribute('d',mapPath(backOriginal,delayed));
    clip.firstElementChild.setAttribute('d',`M-1000 -1000H2500V2500H-1000Z ${holes} ${hole}`);
    const [fx,fy]=warp(520,410,p), f=clamp(1-amount);
    const nod=!reduced&&['receive','repair'].includes(kind)?Math.sin(clamp((t-.65)/.3)*Math.PI*2)*18:0;
    yawn.style.display=kind==='idle-stretch'&&!reduced&&t>.48&&t<.82?'':'none';
    yawn.setAttribute('ry',String(22*Math.sin(clamp((t-.48)/.34)*Math.PI)));
    faceGroup.setAttribute('transform',`translate(${fx} ${fy+nod}) scale(${f*(1+(p[0]-1)*.35)} ${f*(1+(p[1]-1)*.3)}) translate(-520 -410)`);
    faceGroup.style.opacity=f===0?'0':'1';
    for(const eye of eyes) { const cx=+eye.getAttribute('cx'),cy=+eye.getAttribute('cy'); eye.setAttribute('transform',`translate(${cx+p[5]} ${cy}) scale(1 ${p[6]}) translate(${-cx} ${-cy})`); }
    // 外層退場只在岩點完全穩定且停留 400 ms 後開始。
    svg.style.opacity=reduced?'1':kind==='tour-out'?String(1-smooth((t*3400-3000)/400)):kind==='record'&&variant!=='attempt'?String(1-smooth((t-.94)/.06)):'1';
    props.replaceChildren();
    const add=(tag,attrs)=>props.append(make(tag,attrs));
    const visible=!reduced&&t>.1&&t<.88;
    if(visible&&['receive','share'].includes(kind)) { const x=kind==='share'?mix(700,1050,smooth((t-.25)/.5)):mix(1040,740,smooth(t/.3)); add('rect',{x,y:380,width:180,height:235,rx:18,fill:'#1e1e21'}); add('path',{d:`M${x+40} 560l40-70 45 15 20-55`,stroke:'#d4ff4f'}); }
    if(visible&&['view','set'].includes(kind)) { add('path',{d:'M870 600l60-170-35-140',stroke:'#303034'}); add('circle',{cx:kind==='set'?920:895,cy:kind==='set'?430:290,r:30,fill:kind==='set'&&t>.4?'#d4ff4f':'#709f39',stroke:'none'}); }
    if(visible&&kind==='repair') { add('circle',{cx:840,cy:420,r:105}); add('path',{d:'M910 500l90 110'}); add('path',{d:'M800 440l35-45 50 20',stroke:'#d4ff4f'}); }
    if(visible&&kind==='scan'&&(variant==='running'||t<.65)) { add('rect',{x:170,y:140,width:700,height:620,rx:32,stroke:'#709f39'}); add('path',{d:`M185 ${180+500*((t*2)%1)}h670`,stroke:'#d4ff4f'}); }
    if(visible&&kind==='scan'&&variant==='success'&&t>=.65) for(const [cx,cy] of [[190,310],[820,620]]) add('path',{d:`M${cx} ${cy}l30-18 26 35-35 30Z`,stroke:'#d4ff4f'});
    if(visible&&kind==='idle-full'&&t<.5) add('path',{d:'M-20-30Q15-40 30 0T0 35Q-30 25-20-30Z',fill:'#709f39',stroke:'none',transform:`translate(${mix(1100,520,smooth(t/.5))} ${mix(140,420,smooth(t/.5))}) scale(${1-smooth((t-.35)/.15)})`});
    if(visible&&kind==='find-wall'&&variant!=='running'&&t>.5) add('path',{d:'M910 220h180v300H910Z M945 280h30m20 60h35m-65 60h30'});
    svg.dataset.rock=String(amount===1); svg.dataset.face=String(f);
  }};
  attached.set(svg,actor); return actor;
}

const duration = (kind, variant) => kind==='record' ? ({ sent:2600, flash:2800, attempt:800 })[variant] : ({ receive:2200, 'tour-in':3000, 'tour-out':3400, view:1800, set:1800, repair:2400, scan:2400, share:2200, 'find-wall':2000, 'idle-stretch':2400, 'idle-full':2200, 'idle-bounce':1900 })[kind];
const media = matchMedia('(prefers-reduced-motion: reduce)');
function cancel(svg) { active.get(svg)?.cancel(); }
function play(svg, kind, variant = 'default', options = {}) {
  cancel(svg);
  const actor=attach(svg), ms=options.duration ?? duration(kind,variant);
  const stopAt=options.holdRock && kind==='tour-out' ? 3000 : ms;
  const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
  let raf=0, timer=0, done=false, staticShown=false, resolve;
  const finished=new Promise(ok=>{resolve=ok;});
  const finish=cancelled=>{
    if(done)return; done=true;cancelAnimationFrame(raf);clearTimeout(timer);active.delete(svg);
    if(cancelled)actor.render('view','default',1,media.matches);
    svg.dataset.playing='false';
    svg.dispatchEvent(new CustomEvent('mascotend',{detail:{kind,cancelled}}));
    resolve({cancelled});
  };
  const live=()=>svg.isConnected&&!svg.closest('[hidden]')&&!document.hidden&&options.valid?.()!==false;
  const reduceMotion=()=>{
    if(done||staticShown)return;
    staticShown=true;cancelAnimationFrame(raf);actor.render(kind,variant,1,true);svg.dataset.reduced='true';
    timer=setTimeout(()=>finish(!live()),options.staticDuration ?? 0);
  };
  const control={finished,cancel:()=>finish(true),interrupt:!!options.interrupt,reduceMotion};
  active.set(svg,control);svg.dataset.reduced=String(reduced);svg.dataset.motion=kind;svg.dataset.variant=variant;svg.dataset.playing='true';
  svg.dispatchEvent(new CustomEvent('mascotstart',{detail:{kind}}));
  if(reduced){
    reduceMotion();
  }else{
    const start=performance.now();
    const frame=now=>{
      if(done)return;
      if(!live()){finish(true);return;}
      const elapsed=Math.min(stopAt,now-start), t=clamp(elapsed/ms);actor.render(kind,variant,t);
      if(elapsed<stopAt)raf=requestAnimationFrame(frame);else finish(false);
    };
    actor.render(kind,variant,0);raf=requestAnimationFrame(frame);
  }
  return control;
}
for(const event of ['pointerdown','keydown','wheel'])addEventListener(event,()=>{for(const control of [...active.values()])if(control.interrupt)control.cancel();},{capture:true,passive:true});
for(const event of ['pagehide','popstate'])addEventListener(event,()=>{for(const control of [...active.values()])control.cancel();});
document.addEventListener('visibilitychange',()=>{if(document.hidden)for(const control of [...active.values()])control.cancel();});
media.addEventListener('change',()=>{if(matchMedia('(prefers-reduced-motion: reduce)').matches)for(const control of [...active.values()])control.reduceMotion();});
return { attach, play, cancel, duration };
})();
globalThis.ClimbioMotion = ClimbioMotion;
