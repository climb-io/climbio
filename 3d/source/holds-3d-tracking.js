import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {MeshoptDecoder} from 'three/addons/libs/meshopt_decoder.module.js';
import {cameraWorkerMain} from './holds-3d-camera-worker.js';
import {MotionSensors,rotationBetween} from './holds-3d-motion.js';
import {mainCamera,cameraViewport,cameraConstraints,reversedCameraFrame,reverseCameraConstraints,firstCameraFrame,frameContentSummary} from './holds-3d-camera-view.js';
import {TrackingLog} from './holds-3d-tracking-log.js';
import {parseSpzBuffer} from './holds-3d-spz.js';
import {renderLines} from '../../topokit/render.js';
import {injectStyle} from '../../topokit/style.js';
import {pickGrade,pickName} from '../../topokit/data.js';

const INDOOR_WALLS={
 mingde:{
  id:'mingde',
  pid:'d1c27twdlbyor9cs',   // 牆發佈的 id（/p/<牆 id>/ 的資料包）；3d/manifest.json 的 wall
  legacyPids:['ghhxkq4pfz7vbfoh'],   // 舊的明德 3D 牆 id：舊連結和岩點貓存的舊路線
  kind:'indoor',
  label:'原岩明德 Spraywall',
  basePath:'/3d/',
  starterRoutes:[
   {id:'starter-1',nameKey:'trkStarter1',grade:'V1',holds:{p28fd7f2561:'s',p89a6fdddec:'s',p3272c7b1ae:'f',p383dabab27:'f',p4e4eccce70:'h',pa37f84b73b:'h',pbbcb4403aa:'h',p62184a6883:'h',pe5b57cac17:'t'}},
   {id:'starter-2',nameKey:'trkStarter2',grade:'V3',holds:{p25b5165166:'s',pf094cba88b:'s',pbc1fcf6fd6:'f',p31eaa1e05c:'f',p19e6e9014e:'f',p59eec8ecdd:'h',p5df2a5d542:'h',p8d7413a6d6:'h',pc30db8e104:'h',p86f962d544:'h',p1050566f96:'t'}},
   {id:'starter-3',nameKey:'trkStarter3',grade:'V5',holds:{pfffddeaef4:'s',p23a8e3bd5d:'s',pbafce0b9e9:'f',p898616bd73:'f',p13452d1234:'f',pd545970c7b:'h',pe9916ced81:'h',pc267415c3f:'h',p8506bdca21:'h',pd4f2038ea0:'h',p722f02b4ec:'h',pa0eab62b0c:'t'}}
  ]
 }
};

const OUTDOOR_CRAGS={
 dapaoyan:{id:'dapaoyan',pid:'rw9oa7t1taemt9zj',kind:'outdoor',label:'大砲岩',packUrl:'/p/rw9oa7t1taemt9zj/index.json'}
};

const PID_TO_WALL={d1c27twdlbyor9cs:'mingde',ghhxkq4pfz7vbfoh:'mingde',rw9oa7t1taemt9zj:'dapaoyan'};
const ROLE_NORM={s:'s',start:'s',h:'h',hand:'h',f:'f',foot:'f',t:'t',top:'t'};
const ROLE_HEX={s:0x22c55e,h:0x3b82f6,f:0xfacc15,t:0xef4444,all:0x78d4d6};
const ROLE_CSS={s:'#22c55e',h:'#3b82f6',f:'#facc15',t:'#ef4444'};

const $=id=>document.getElementById(id),t=(key,...args)=>AppKit.i18n.t(key,...args);
const assetBase=new URL('/3d/',location.origin);
const getJson=url=>fetch(url,{credentials:'omit'}).then(r=>{if(!r.ok)throw new Error(t('trkLoadError'));return r.json();});
// 牆的資料包檔名帶雜湊、內容不變：岩點貓存過（Service Worker 的 hold-models 快取）就直接用，不再下載
async function packFile(url){
 if(self.caches)for(const name of (await caches.keys()).filter(k=>k.startsWith('hold-models'))){const hit=await (await caches.open(name)).match(url.href);if(hit)return {bytes:new Uint8Array(await hit.arrayBuffer()),cached:true};}
 const r=await fetch(url,{credentials:'omit'});if(!r.ok)throw new Error(t('trkLoadError'));return {bytes:new Uint8Array(await r.arrayBuffer()),cached:false};
}
const decompress=(bytes,format)=>new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream(format))).arrayBuffer().then(b=>new Uint8Array(b));
const inflate=bytes=>decompress(bytes,'deflate');
// 只讀 glb 的頂點和三角形（不解貼圖）；牆的模型是單一網格、沒有節點變換
function glbGeometry(bytes){
 const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),jsonLength=view.getUint32(12,true),json=JSON.parse(new TextDecoder().decode(bytes.subarray(20,20+jsonLength))),bin=20+jsonLength+8,node=json.nodes?.[0],prim=json.meshes?.[0]?.primitives?.[0];
 if(view.getUint32(0,true)!==0x46546c67||json.meshes?.length!==1||json.meshes[0].primitives.length!==1||!node||node.matrix||node.translation||node.rotation||node.scale)throw new Error(t('trkDataError'));
 const read=(i,Type)=>{const a=json.accessors[i],v=json.bufferViews[a.bufferView],n=a.count*({VEC3:3,SCALAR:1}[a.type]);return new Type(bytes.buffer.slice(bytes.byteOffset+bin+(v.byteOffset||0)+(a.byteOffset||0),bytes.byteOffset+bin+(v.byteOffset||0)+(a.byteOffset||0)+n*Type.BYTES_PER_ELEMENT));};
 const ia=json.accessors[prim.indices];return {positions:read(prim.attributes.POSITION,Float32Array),index:read(prim.indices,ia.componentType===5125?Uint32Array:Uint16Array)};
}
// 岩點外框：這顆岩點的面（資料包的 overlay）加外面一圈，頂點的權重＝周圍的面屬於這顆岩點的比例，著色器畫權重 0.4 的等高線
function holdGeometryBuilder(positions,index,holdOffsets,holdFaces){
 const vertexCount=positions.length/3,faceCount=index.length/3,firstFace=new Uint32Array(vertexCount+1),inHold=new Uint16Array(vertexCount),seen=new Uint8Array(faceCount);
 for(const v of index)firstFace[v+1]++;for(let v=0;v<vertexCount;v++)firstFace[v+1]+=firstFace[v];
 const incident=new Uint32Array(index.length),fill=firstFace.slice(0,vertexCount);for(let f=0;f<faceCount;f++)for(let k=0;k<3;k++)incident[fill[index[f*3+k]]++]=f;
 return h=>{
  const own=holdFaces.subarray(holdOffsets[h],holdOffsets[h+1]),ring=[];
  for(const f of own)for(let k=0;k<3;k++)inHold[index[f*3+k]]++;
  const full=v=>inHold[v]>=firstFace[v+1]-firstFace[v];   // 周圍的面全是這顆岩點：三個角都是的面在岩點內部，畫不到線，不送進去
  for(const f of own)for(let k=0;k<3;k++){const v=index[f*3+k];if(full(v))continue;for(let j=firstFace[v];j<firstFace[v+1];j++){const g=incident[j];if(!seen[g]&&!(full(index[g*3])&&full(index[g*3+1])&&full(index[g*3+2]))){seen[g]=1;ring.push(g);}}}
  const p=new Float32Array(ring.length*9),w=new Float32Array(ring.length*3);
  ring.forEach((g,i)=>{for(let k=0;k<3;k++){const v=index[g*3+k];p.set(positions.subarray(v*3,v*3+3),(i*3+k)*3);w[i*3+k]=Math.min(1,inHold[v]/(firstFace[v+1]-firstFace[v]));}});
  for(const g of ring)seen[g]=0;for(const f of own)for(let k=0;k<3;k++)inHold[index[f*3+k]]=0;
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(p,3));g.setAttribute('holdWeight',new THREE.BufferAttribute(w,1));return g;
 };
}
// 岩點貓看線帶來的路線（?route=岩點id:角色,…，角色 s 起攀、h 手點、f 腳點、t 完攀）
function readRouteParam(param){
 const holds={};for(const [id,r] of (param||'').split(',').map(x=>x.split(':')))if(/^[0-9a-z]{1,40}$/.test(id||'')&&'shft'.includes(r||'x'))holds[id]=r;
 return Object.keys(holds).length?{id:'app-route',nameKey:'trkRoutes',name:'',grade:'',holds,seq:null}:null;
}

function normalizeHolds(holds){
 const out={};
 if(!holds||typeof holds!=='object')return out;
 for(const [k,v] of Object.entries(holds)){
  const r=ROLE_NORM[v];
  if(r)out[k]=r;
 }
 return out;
}

async function unpackUrlRoute(param){
 if(!param||typeof DecompressionStream==='undefined')return null;
 try{
  const bytes=Uint8Array.from(atob(param.replaceAll('-','+').replaceAll('_','/')),c=>c.charCodeAt(0));
  const raw=await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).text();
  const d=JSON.parse(raw);
  const holds=normalizeHolds(d?.h);
  if(!Object.keys(holds).length)return null;
  return {id:'shared-url',name:String(d.n||'').slice(0,80),grade:String(d.g||'').slice(0,24),holds,seq:Array.isArray(d.q)?d.q:null};
 }catch{return null;}
}

function readLocalCustomRoute(){
 try{
  const raw=localStorage.getItem('climbio.arRoute');
  if(!raw)return null;
  const d=JSON.parse(raw);
  const holds=normalizeHolds(d?.holds||d?.h);
  if(!Object.keys(holds).length)return null;
  return {id:'local-ar',wallId:d.wallId||null,name:String(d.name||d.n||'').slice(0,80),grade:String(d.grade||d.g||'').slice(0,24),holds,seq:Array.isArray(d.seq)?d.seq:null};
 }catch{return null;}
}

async function readIdbRoutesForPid(pid){
 if(!pid||typeof indexedDB==='undefined'||!indexedDB.databases)return [];
 try{
  const dbs=await indexedDB.databases();
  if(!dbs.some(d=>d.name==='climbio-db'))return [];
  const db=await new Promise((ok,no)=>{const r=indexedDB.open('climbio-db');r.onsuccess=()=>ok(r.result);r.onerror=()=>no(r.error);});
  try{
   if(!db.objectStoreNames.contains('walls')||!db.objectStoreNames.contains('routes'))return [];
   const walls=await new Promise((ok,no)=>{const r=db.transaction('walls','readonly').objectStore('walls').getAll();r.onsuccess=()=>ok(r.result||[]);r.onerror=()=>no(r.error);});
   const matched=walls.filter(w=>w?.pid===pid);
   if(!matched.length)return [];
   const out=[];
   for(const w of matched){
    const routes=await new Promise((ok,no)=>{const r=db.transaction('routes','readonly').objectStore('routes').index('wall').getAll(w.id);r.onsuccess=()=>ok(r.result||[]);r.onerror=()=>no(r.error);});
    for(const rt of routes){
     const holds=normalizeHolds(rt?.holds);
     if(Object.keys(holds).length)out.push({id:`idb-${rt.id}`,name:rt.name||'',grade:rt.grade||'',holds,seq:Array.isArray(rt.seq)?rt.seq:null});
    }
   }
   return out;
  }finally{db.close();}
 }catch{return [];}
}

function makeHoldOutlineMaterial(hexColor=ROLE_HEX.all){
 const mat=new THREE.MeshBasicMaterial({color:hexColor,transparent:true,depthWrite:false,side:THREE.DoubleSide,polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-2});
 mat.onBeforeCompile=shader=>{
  shader.vertexShader='attribute float holdWeight;varying float weight;\n'+shader.vertexShader;
  shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nweight=holdWeight;');
  shader.fragmentShader='varying float weight;\n'+shader.fragmentShader;
  shader.fragmentShader=shader.fragmentShader.replace('#include <opaque_fragment>','float aa=max(fwidth(weight),.001);float edge=1.-smoothstep(aa,aa*2.5,abs(weight-.4));if(edge<.02)discard;gl_FragColor=vec4(outgoingLight,edge);');
 };
 return mat;
}

function setTools(open){document.body.dataset.tools=open?'open':'closed';$('tools-toggle').setAttribute('aria-expanded',String(open));}

async function main(){
 AppKit.i18n.apply();
 if(document.body.dataset.trackingUi!=='2'){
  const url=new URL(location.href);
  if(url.searchParams.get('ui')==='2')throw new Error(t('trkUpdatePage'));
  url.searchParams.set('ui','2');location.replace(url.href);return;
 }

 const urlParams=new URL(location.href).searchParams;
 const autoCamera=urlParams.get('auto')==='1';
 if(autoCamera){document.documentElement.dataset.auto='1';document.body.dataset.auto='1';}   // 岩點貓的相機看線：一進來就開相機，不先秀模型或載入說明

 const packParam=urlParams.get('pack');
 if(packParam){
  const packHref=new URL(packParam,location.href).href;
  OUTDOOR_CRAGS.custom={id:'custom',kind:'outdoor',label:'3D',packUrl:packHref};
 }
 const wallParam=urlParams.get('wall');
 const m3dWall=PID_TO_WALL[urlParams.get('m3d')];
 const rawWall=PID_TO_WALL[wallParam]||wallParam||(packParam?'custom':m3dWall||'auto');
 let autoDetectWall=(rawWall==='auto');
 let activeWall=(INDOOR_WALLS[rawWall]||OUTDOOR_CRAGS[rawWall])?rawWall:'mingde';
 const unknownWallParam=wallParam&&rawWall!=='auto'&&!INDOOR_WALLS[rawWall]&&!OUTDOOR_CRAGS[rawWall]?wallParam:null;
 const appRoute=readRouteParam(urlParams.get('route'));
 const sharedUrlRoute=await unpackUrlRoute(urlParams.get('r'));
 const localArRoute=readLocalCustomRoute();

 const log=new TrackingLog({build:null,manifest:null,device:{userAgent:navigator.userAgent,language:navigator.language,timezone:Intl.DateTimeFormat().resolvedOptions().timeZone,screen:[innerWidth,innerHeight],devicePixelRatio,renderPixelRatio:Math.min(devicePixelRatio,1.5),hardwareConcurrency:navigator.hardwareConcurrency??null,deviceMemoryGB:navigator.deviceMemory??null},storage:localStorage});
 const renderer=new THREE.WebGLRenderer({alpha:true,antialias:true,preserveDrawingBuffer:true});renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.setClearColor(0,0);renderer.domElement.id='tracking-canvas';$('stage').append(renderer.domElement);

 injectStyle($('stage'));
 $('stage').classList.add('tk');
 const routeOverlay=document.createElement('canvas');routeOverlay.id='route-overlay';$('stage').append(routeOverlay);
 const routeCtx=routeOverlay.getContext('2d');
 const routeSvg=document.createElementNS('http://www.w3.org/2000/svg','svg');routeSvg.id='route-svg';$('stage').append(routeSvg);

 const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(50,1,.01,500),view=new THREE.PerspectiveCamera();view.matrixAutoUpdate=false;view.matrixWorldAutoUpdate=false;
 const controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;controls.zoomSpeed=3;controls.zoomToCursor=true;
 const light=new THREE.DirectionalLight(0xffffff,2.5);light.position.set(2,4,6);scene.add(light,new THREE.HemisphereLight(0xdfefff,0x27343d,2));
 const solidMaterial=new THREE.MeshStandardMaterial({color:0x849298,roughness:1,side:THREE.DoubleSide}),depthMaterial=new THREE.MeshBasicMaterial({colorWrite:false,depthWrite:true,side:THREE.DoubleSide});
 let base=null,outdoorVisualGroup=null,activeBundle=null,manifest=null,common=null,current={id:'wall',bytes:0,triangles:0},modelToken=0,mode=autoCamera?'camera':'model',running=false,ready=false,busy=false,worker=null,workerUrl=null,stream=null,generation=0,pose=null,poseAt=0,poseWallId=activeWall,lastSent=0,frames=0,videoFrames=0,videoCallback=null,errors=0,lastTick=performance.now(),sceneScale=1,lastModelFetch=null,selectedCamera='',cameraDevices=[],trackingMode='vision',frameClock=null,lastInputFrame=null,lastInputSensor=null,trackingEpoch=0,requestedAspect=null,shapeBusy=false,autoCameraId='',autoMain=false,lastPreviewFrame=null;
 let outlines=[],holdEntryList=[],activeRouteId=(appRoute?.id||sharedUrlRoute?.id||localArRoute?.id||'all'),switchingWall=false;
 const cameraProfiles=new Map(),geometryCache=new Map(),wallBundleCache=new Map(),workerBanksLoaded=new Set();
 const sensors=new MotionSensors({origin:log.start});
 const center=new THREE.Vector3();

 function populateWallSelect(){
  const sel=$('wall-select');
  if(!sel)return;
  const autoOpt=new Option(t('trkAutoWall'),'auto');
  const inGroup=document.createElement('optgroup');inGroup.label=t('trkIndoorGroup');
  for(const w of Object.values(INDOOR_WALLS))inGroup.append(new Option(w.label,w.id));
  const outGroup=document.createElement('optgroup');outGroup.label=t('trkOutdoorGroup');
  for(const c of Object.values(OUTDOOR_CRAGS))outGroup.append(new Option(c.label,c.id));
  sel.replaceChildren(autoOpt,inGroup,outGroup);
  sel.value=autoDetectWall?'auto':activeWall;
 }
 populateWallSelect();

 function manifestEntries(trackingManifest){
  return Array.isArray(trackingManifest?.walls)&&trackingManifest.walls.length?trackingManifest.walls:[trackingManifest];
 }

 async function fetchOutdoorPackMeta(wallId){
  const spec=OUTDOOR_CRAGS[wallId];
  if(!spec)throw new Error(t('trkLoadError'));
  const packUrl=new URL(spec.packUrl,location.origin).href;
  const base=new URL('.',packUrl).href;
  const indexDoc=await getJson(packUrl);
  const packHref=indexDoc.props?.pack?.href;
  let docs;
  if(packHref){
   const packed=await getJson(new URL(packHref,base).href);
   const map=packed?.docs||{};
   docs=(indexDoc.items||[]).map(it=>map[it.href]).filter(Boolean);
  }else{
   docs=await Promise.all((indexDoc.items||[]).map(it=>getJson(new URL(it.href,base).href)));
  }
  const modelDoc=docs.find(d=>d.kind==='view'&&d.surface==='model');
  if(!modelDoc)throw new Error(t('trkDataError'));
  const photoDocs=docs.filter(d=>d.kind==='view'&&d.surface==='photo'&&d.props?.model?.id===modelDoc.id&&d.props?.model?.camera);
  const layerDoc=docs.find(d=>d.kind==='layer'&&d.on===modelDoc.id);
  const nodesById=new Map((indexDoc.nodes||[]).map(n=>[n.id,n]));
  const langTag=AppKit.i18n.lang==='zh'?'zh-Hant':AppKit.i18n.lang;
  const routes=(layerDoc?.marks||[]).filter(m=>m.geometry?.type==='LineString'&&m.node).map(m=>{
   const n=nodesById.get(m.node);
   return {
    id:m.node,
    label:m.props?.label!=null?String(m.props.label):(n?.props?.order!=null?String(n.props.order):undefined),
    kind:n?.props?.style==='sport'?'sport':'other',
    grade:pickGrade(n?.props?.grade)||'',
    name:pickName(n?.name,langTag)||'',
    stroke:m.props?.style?.stroke,
    pts:m.geometry.coordinates.map(p=>new THREE.Vector3(...p))
   };
  });
  const primaryCam=photoDocs[0]?.props?.model?.camera||null;
  const label=pickName(indexDoc.name,langTag)||spec.label;
  spec.label=label;
  return {
   wallId,
   kind:'outdoor',
   label,
   base,
   modelUrl:new URL(modelDoc.href,base).href,
   modelMime:modelDoc.mime||'',
   sky:modelDoc.props?.sky||null,
   defaultCamera:primaryCam,
   photoViews:photoDocs.map(p=>({href:new URL(p.href,base).href,w:p.w,h:p.h,camera:p.props.model.camera})),
   routes
  };
 }

 async function fetchWallBundle(wallId){
  if(wallBundleCache.has(wallId))return wallBundleCache.get(wallId);
  const spec=INDOOR_WALLS[wallId];
  if(spec){
   // 牆的模型與岩點直接讀這面牆發佈的資料包（/p/<牆 id>/，跟看線、定線同一份）；/3d/ 只另外帶相機比對資料
   const base=new URL(spec.basePath||'/3d/',location.origin),loadStart=performance.now();
   const trackingManifest=await getJson(new URL('manifest.json',base));
   const entries=manifestEntries(trackingManifest);
   const entry=entries.find(w=>w?.wall===spec.pid)||(entries.length===1&&entries[0]?.wall===spec.pid?entries[0]:null);
   if(!entry)throw new Error(t('trkDataError'));
   const wallBase=new URL(`/p/${spec.pid}/`,location.origin);
   const [cameraMap,pack]=await Promise.all([getJson(new URL(entry.camera.url,base)),getJson(new URL('wall.json',wallBase))]);
   if(cameraMap.scene!==entry.scene||pack.scene!==entry.scene||pack.format!=='climbio-3d-wall/2')throw new Error(t('trkDataError'));
   const [glb,overlayFile]=await Promise.all([packFile(new URL(pack.model,wallBase)),packFile(new URL(pack.holdLabels.overlay,wallBase))]);
   const {positions,index}=glbGeometry(glb.bytes),overlay=new Uint32Array((await inflate(overlayFile.bytes)).buffer),holdCount=pack.holdLabels.holds;
   if(holdCount!==pack.holds.length||overlay.length<holdCount+1||overlay[holdCount]!==overlay.length-holdCount-1)throw new Error(t('trkDataError'));
   const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(positions,3));geometry.setIndex(new THREE.BufferAttribute(index,1));geometry.computeVertexNormals();geometry.computeBoundingBox();geometry.computeBoundingSphere();
   const idbRoutes=[];for(const pid of [spec.pid,...(spec.legacyPids||[])])idbRoutes.push(...await readIdbRoutesForPid(pid));
   const routes=[];
   if(appRoute)routes.push(appRoute);
   if(sharedUrlRoute)routes.push(sharedUrlRoute);
   if(localArRoute&&(!localArRoute.wallId||localArRoute.wallId===wallId||localArRoute.wallId===spec.pid||spec.legacyPids?.includes(localArRoute.wallId)))routes.push(localArRoute);
   routes.push(...idbRoutes);
   for(const sr of spec.starterRoutes||[])routes.push({id:sr.id,nameKey:sr.nameKey,grade:sr.grade,holds:sr.holds});
   const model={id:'wall',url:pack.model,bytes:glb.bytes.byteLength,triangles:index.length/3};
   const wallManifest={build:entry.build||trackingManifest.build,wall:spec.pid,scene:entry.scene,cameraBytes:entry.camera.bytes,models:[model],holds:pack.holds.length,featurePoints:entry.featurePoints,referenceViews:entry.referenceViews};
   const bundle={wallId,kind:'indoor',label:pack.name||spec.label,base,wallBase,manifest:wallManifest,common:{camera:cameraMap},pack,geometry,holdOutline:holdGeometryBuilder(positions,index,overlay.subarray(0,holdCount+1),overlay.subarray(holdCount+1)),load:{ms:performance.now()-loadStart,cached:glb.cached},routes};
   wallBundleCache.set(wallId,bundle);
   return bundle;
  }
  const meta=await fetchOutdoorPackMeta(wallId);
  const fakeManifest={
   build:`outdoor-${wallId}`,
   models:[{id:'wall',url:meta.modelUrl,bytes:0,triangles:0}],
   common:{url:'index.json',bytes:0},
   overlayTriangles:0,
   holds:0,
   featurePoints:0,
   referenceViews:meta.photoViews.length
  };
  const bundle={...meta,manifest:fakeManifest,common:{holds:[],camera:null}};
  wallBundleCache.set(wallId,bundle);
  return bundle;
 }

 function clearOutlines(){
  for(const item of holdEntryList){
   scene.remove(item.mesh);
   item.mesh.geometry.dispose();
   item.material.dispose();
  }
  outlines=[];
  holdEntryList=[];
 }

 function buildIndoorOutlines(bundle){
  clearOutlines();
  if(bundle.kind!=='indoor')return;
  const box=bundle.geometry.boundingBox;box.getCenter(center);sceneScale=box.getSize(new THREE.Vector3()).length();controls.target.copy(center);
  bundle.pack.holds.forEach((hold,h)=>{
   const mat=makeHoldOutlineMaterial(ROLE_HEX.all);
   const mesh=new THREE.Mesh(bundle.holdOutline(h),mat);mesh.renderOrder=2;scene.add(mesh);outlines.push(mesh);
   holdEntryList.push({id:hold.id,position:hold.position,mesh,material:mat});
  });
 }

 function applyActiveRouteToScene(){
  if(activeBundle?.kind==='indoor'){
   const route=activeBundle.routes.find(r=>r.id===activeRouteId);
   for(const item of holdEntryList){
    if(!route||activeRouteId==='all'){
     item.mesh.visible=true;
     item.material.color.setHex(ROLE_HEX.all);
    }else{
     const role=route.holds?.[item.id];
     if(role){
      item.mesh.visible=true;
      item.material.color.setHex(ROLE_HEX[role]||ROLE_HEX.h);
     }else{
      item.mesh.visible=false;
     }
    }
   }
  }
 }

 function renderRouteBar(){
  const bar=$('route-bar');
  if(!bar||!activeBundle)return;
  const nodes=[];
  if(autoDetectWall){
   const chip=document.createElement('span');
   chip.className='wall-chip';
   chip.textContent=activeBundle.label;
   nodes.push(chip);
  }
  const items=[];
  if(activeBundle.kind==='indoor'){
   items.push({id:'all',grade:'',name:t('trkAllHolds')});
   for(const r of activeBundle.routes){
    items.push({id:r.id,grade:r.grade||'',name:r.nameKey?t(r.nameKey):(r.name||r.grade)});
   }
  }else{
   items.push({id:'all',grade:'',name:t('trkAllRoutes')});
   for(const r of activeBundle.routes){
    items.push({id:r.id,grade:r.grade||'',name:r.label?`${r.label} ${r.name}`.trim():r.name});
   }
  }
  if(!items.some(x=>x.id===activeRouteId))activeRouteId=items[0]?.id||'all';
  for(const it of items){
   const btn=document.createElement('button');
   btn.type='button';
   btn.className='route-pill';
   btn.setAttribute('role','tab');
   btn.setAttribute('aria-selected',String(it.id===activeRouteId));
   if(it.grade){
    const b=document.createElement('b');
    b.textContent=it.grade;
    btn.append(b);
   }
   const sp=document.createElement('span');
   sp.textContent=it.name;
   btn.append(sp);
   btn.onclick=()=>{
    activeRouteId=it.id;
    for(const el of bar.querySelectorAll('.route-pill'))el.setAttribute('aria-selected',String(el===btn));
    applyActiveRouteToScene();
   };
   nodes.push(btn);
  }
  bar.replaceChildren(...nodes);
  applyActiveRouteToScene();
 }

 const preview=document.createElement('canvas');preview.id='live-preview';$('stage').insertBefore(preview,renderer.domElement);const previewCtx=preview.getContext('2d',{alpha:false});
 const video=$('live-video'),capture=document.createElement('canvas'),ctx=capture.getContext('2d',{willReadFrequently:true});
 function drawPreview(){
  if(!running||video.readyState<2||!video.videoWidth||!video.videoHeight)return;
  const rect=$('stage').getBoundingClientRect(),ratio=renderer.getPixelRatio(),w=Math.round(rect.width*ratio),h=Math.round(rect.height*ratio),key=frameClock?`frame:${frameClock.serial}`:`time:${video.currentTime}`;
  const resized=preview.width!==w||preview.height!==h;if(resized){preview.width=w;preview.height=h;}
  if(!resized&&key===lastPreviewFrame)return;lastPreviewFrame=key;
  const v=cameraViewport(w,h,video.videoWidth,video.videoHeight);previewCtx.drawImage(video,v.x,v.y,v.width,v.height);
 }

 function drawCircleTag(c,x,y,label,bg,fg='#0e0e0f'){
  c.save();
  c.beginPath();
  c.arc(x,y,10,0,Math.PI*2);
  c.fillStyle=bg;
  c.fill();
  c.lineWidth=1.5;
  c.strokeStyle='rgba(14,14,15,.85)';
  c.stroke();
  c.fillStyle=fg;
  c.font='700 11px -apple-system,BlinkMacSystemFont,"SF Pro Display",sans-serif';
  c.textAlign='center';
  c.textBaseline='middle';
  c.fillText(label,x,y+.5);
  c.restore();
 }

 let lastSvgSig='';
 function clearOverlays(){
  if(routeOverlay.width)routeCtx.clearRect(0,0,routeOverlay.width,routeOverlay.height);
  if(lastSvgSig){routeSvg.innerHTML='';lastSvgSig='';}
 }

 function drawOverlays(activeCam,vp){
  const rect=$('stage').getBoundingClientRect(),W=Math.max(1,Math.round(rect.width)),H=Math.max(1,Math.round(rect.height));
  if(routeOverlay.width!==W||routeOverlay.height!==H){routeOverlay.width=W;routeOverlay.height=H;}
  routeCtx.clearRect(0,0,W,H);
  if(!activeCam||!activeBundle){if(lastSvgSig){routeSvg.innerHTML='';lastSvgSig='';}return;}

  if(activeBundle.kind==='indoor'){
   if(lastSvgSig){routeSvg.innerHTML='';lastSvgSig='';}
   const route=activeBundle.routes.find(r=>r.id===activeRouteId);
   if(!route||activeRouteId==='all')return;
   const seqIndex=route.seq?new Map(route.seq.map((id,i)=>[id,i+1])):null;
   const v3=new THREE.Vector3(),placedStarts=[];
   for(const item of holdEntryList){
    const role=route.holds?.[item.id];
    if(!role||(role!=='s'&&role!=='t'&&!(seqIndex?.has(item.id))))continue;
    if(!item.position)continue;   // 資料包裡標成不在的岩點沒有位置
    v3.set(item.position[0],item.position[1],item.position[2]).project(activeCam);
    if(v3.z<-1||v3.z>1||!Number.isFinite(v3.x)||!Number.isFinite(v3.y))continue;
    const sx=vp.x+(v3.x+1)*.5*vp.width,sy=vp.y+(1-v3.y)*.5*vp.height;
    if(role==='s'){
     let tx=sx,ty=sy+18;
     if(placedStarts.some(p=>Math.hypot(p[0]-tx,p[1]-ty)<18))tx+=16;
     placedStarts.push([tx,ty]);
     drawCircleTag(routeCtx,tx,ty,'S',ROLE_CSS.s,'#0e0e0f');
    }else if(role==='t')drawCircleTag(routeCtx,sx,sy-18,'T',ROLE_CSS.t,'#ffffff');
    else if(seqIndex?.has(item.id))drawCircleTag(routeCtx,sx+14,sy-10,String(seqIndex.get(item.id)),ROLE_CSS.h,'#ffffff');
   }
   return;
  }

  const routesSource=activeRouteId==='all'?activeBundle.routes:activeBundle.routes.filter(r=>r.id===activeRouteId);
  const drawn=routesSource.map(r=>({
   ...r,
   line:r.pts.map(p=>{
    const q=p.clone().project(activeCam);
    return q.z>-1&&q.z<1?[vp.x+(q.x+1)*.5*vp.width,vp.y+(1-q.y)*.5*vp.height]:null;
   }).filter(Boolean)
  })).filter(r=>r.line.length>=2);
  routeSvg.setAttribute('viewBox',`0 0 ${W} ${H}`);
  if(!drawn.length){if(lastSvgSig){routeSvg.innerHTML='';lastSvgSig='';}return;}
  const highlight=activeRouteId==='all'?undefined:activeRouteId;
  const html=renderLines(drawn,{photo:{w:W,h:H},k:1,highlight,interactive:false,naturalEnds:true});
  if(html!==lastSvgSig){routeSvg.innerHTML=html;lastSvgSig=html;}
 }

 function previewDiagnostics(){
  try{if(video.readyState<2||!video.videoWidth)return null;
  const probe=document.createElement('canvas');probe.width=96;probe.height=Math.min(256,Math.max(1,Math.round(96*video.videoHeight/video.videoWidth)));const c=probe.getContext('2d',{willReadFrequently:true});c.drawImage(video,0,0,probe.width,probe.height);const rect=video.getBoundingClientRect();
  return {...frameContentSummary(c.getImageData(0,0,probe.width,probe.height)),videoElement:[rect.x,rect.y,rect.width,rect.height],canvas:[preview.width,preview.height]};}catch(error){return {unavailable:String(error.name||'Error')};}
 }
 function status(key){$('status').textContent=t(key);}
 function fit(){
  const rect=$('stage').getBoundingClientRect();
  renderer.setSize(Math.max(1,rect.width),Math.max(1,rect.height),false);
  camera.aspect=rect.width/Math.max(1,rect.height);
  camera.updateProjectionMatrix();
  if(activeBundle?.kind==='outdoor'&&activeBundle.defaultCamera){
   const dc=activeBundle.defaultCamera;
   camera.fov=dc.fov??50;
   camera.updateProjectionMatrix();
   camera.position.set(...dc.position);
   controls.target.set(...dc.target);
   controls.update();
   return;
  }
  camera.fov=50;
  camera.updateProjectionMatrix();
  const distance=sceneScale/(2*Math.tan(THREE.MathUtils.degToRad(25)))*Math.max(1,1/camera.aspect);
  camera.position.copy(center).add(new THREE.Vector3(0,.05,1).normalize().multiplyScalar(distance*.9));
  controls.target.copy(center);
  controls.update();
 }
 new ResizeObserver(()=>{const r=$('stage').getBoundingClientRect();renderer.setSize(Math.max(1,r.width),Math.max(1,r.height),false);camera.aspect=r.width/Math.max(1,r.height);camera.updateProjectionMatrix();adjustCamera().catch(error=>log.error(error));}).observe($('stage'));
 $('tools-toggle').onclick=()=>setTools(document.body.dataset.tools!=='open');

 function modeUi(){
  document.body.dataset.running=String(running);
  document.body.dataset.mode=mode;
  $('mode-model').setAttribute('aria-pressed',String(mode==='model'));
  $('mode-camera').setAttribute('aria-pressed',String(mode==='camera'));
  controls.enabled=mode==='model';
  if(base){
   if(activeBundle?.kind==='outdoor'&&outdoorVisualGroup){
    outdoorVisualGroup.visible=(mode==='model');
    base.visible=(mode==='camera'&&!base.isPoints);
   }else{
    base.visible=true;
    base.material=mode==='model'?solidMaterial:depthMaterial;
   }
  }
  $('camera-toggle').textContent=t(running?'trkStop':'trkStart');
  $('mark-drift').disabled=!running;
  $('mark-loss').disabled=!running;
 }

 async function parseOutdoorModel(url,keepVisual){
  const response=await fetch(url,{credentials:'omit'});
  if(!response.ok)throw new Error(t('trkLoadError'));
  const bytes=new Uint8Array(await response.arrayBuffer());
  const isGlb=bytes.byteLength>=4&&new DataView(bytes.buffer,bytes.byteOffset,4).getUint32(0,true)===0x46546c67;
  if(!isGlb){
   const isGzip=bytes.byteLength>=2&&bytes[0]===0x1f&&bytes[1]===0x8b;
   const raw=isGzip?await decompress(bytes,'gzip'):bytes;
   const parsed=parseSpzBuffer(raw);
   const geometry=new THREE.BufferGeometry();
   geometry.setAttribute('position',new THREE.BufferAttribute(parsed.positions,3));
   geometry.setAttribute('color',new THREE.BufferAttribute(parsed.colors,3));
   geometry.setAttribute('splatSize',new THREE.BufferAttribute(parsed.sizes,1));
   geometry.computeBoundingBox();
   geometry.computeBoundingSphere();
   const visualClone=keepVisual?new THREE.Points(geometry,new THREE.PointsMaterial({size:0.06,vertexColors:true,sizeAttenuation:true})):null;
   return {geometry,visualClone,bytesLength:bytes.byteLength,triangles:parsed.count,isPointCloud:true};
  }
  const loader=new GLTFLoader().setMeshoptDecoder(MeshoptDecoder),gltf=await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),new URL('.',url).href);
  gltf.scene.updateMatrixWorld(true);
  const meshes=[];gltf.scene.traverse(o=>{if(o.isMesh)meshes.push(o);});
  if(!meshes.length)throw new Error(t('trkDataError'));
  const allPos=[],allIdx=[];let vOffset=0;
  const point=new THREE.Vector3();
  for(const m of meshes){
   const source=m.geometry.attributes.position;
   for(let i=0;i<source.count;i++){
    point.fromBufferAttribute(source,i).applyMatrix4(m.matrixWorld);
    allPos.push(point.x,point.y,point.z);
   }
   if(m.geometry.index){
    const idxArr=m.geometry.index.array;
    for(let i=0;i<idxArr.length;i++)allIdx.push(vOffset+idxArr[i]);
   }else{
    for(let i=0;i<source.count;i++)allIdx.push(vOffset+i);
   }
   vOffset+=source.count;
  }
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.BufferAttribute(new Float32Array(allPos),3));
  geometry.setIndex(allIdx);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  let visualClone=null;
  if(keepVisual){
   visualClone=gltf.scene;
   visualClone.traverse(x=>{
    if(x.isMesh){
     x.material=new THREE.MeshBasicMaterial({map:x.material.map||null,side:THREE.DoubleSide,vertexColors:!!x.geometry.attributes.color,transparent:true,alphaTest:.01});
    }
   });
  }else{
   for(const m of meshes){m.material?.map?.dispose?.();m.geometry.dispose();m.material?.dispose?.();}
  }
  return {geometry,visualClone,bytesLength:bytes.byteLength,triangles:Math.floor(allIdx.length/3),isPointCloud:false};
 }

 async function loadModel(id){
  const bundle=activeBundle;
  if(!bundle)return;
  const model=bundle.manifest.models.find(m=>m.id===id)||bundle.manifest.models[0],token=++modelToken,startAt=performance.now();
  try{
   const cacheKey=bundle.kind==='outdoor'?`outdoor:${bundle.wallId}`:`${bundle.wallId}:${model.id}`;
   // 室內牆的模型在讀資料包時已經解好（bundle.geometry），不再另外下載
   if(bundle.kind==='indoor'&&!geometryCache.has(cacheKey))geometryCache.set(cacheKey,{geometry:bundle.geometry,visualClone:null,isPointCloud:false});
   let cachedEntry=geometryCache.get(cacheKey),cached=bundle.kind==='indoor'?bundle.load.cached:!!cachedEntry;
   if(!cachedEntry){
    const url=new URL(model.url,bundle.base).href;
    cachedEntry=await parseOutdoorModel(url,bundle.kind==='outdoor');
    if(bundle.kind==='outdoor'){
     for(const m of bundle.manifest.models){m.bytes=cachedEntry.bytesLength;m.triangles=cachedEntry.triangles;}
    }
    geometryCache.set(cacheKey,cachedEntry);
   }
   if(token!==modelToken)return;
   if(base)scene.remove(base);
   if(outdoorVisualGroup){scene.remove(outdoorVisualGroup);outdoorVisualGroup=null;}
   const {geometry,visualClone,isPointCloud}=cachedEntry;
   if(bundle.kind==='outdoor'){
    geometry.boundingBox.getCenter(center);
    sceneScale=geometry.boundingBox.getSize(new THREE.Vector3()).length();
    base=isPointCloud?new THREE.Points(geometry,depthMaterial):new THREE.Mesh(geometry,depthMaterial);
    base.renderOrder=0;
    base.visible=(mode==='camera'&&!isPointCloud);
    scene.add(base);
    if(visualClone){
     outdoorVisualGroup=visualClone;
     outdoorVisualGroup.visible=(mode==='model');
     scene.add(outdoorVisualGroup);
    }
   }else{
    base=new THREE.Mesh(geometry,mode==='model'?solidMaterial:depthMaterial);
    base.renderOrder=0;
    scene.add(base);
   }
   current=model;
   lastModelFetch={model:model.id,ms:bundle.kind==='indoor'?bundle.load.ms:performance.now()-startAt,geometryCache:cached};
   log.variant(model,trackingMode);
   log.event('model_loaded',lastModelFetch);
  }catch(error){
   log.error(error);status('trkLoadError');
  }
 }

 function renderLinearDepth(geometry,camSpec,dw,dh){
  const pos=new THREE.Vector3(...camSpec.position),tgt=new THREE.Vector3(...camSpec.target);
  const dist=Math.max(1,pos.distanceTo(tgt)),near=Math.max(.2,dist*.05),far=Math.max(80,dist*6),fov=camSpec.fov??50;
  const refCam=new THREE.PerspectiveCamera(fov,dw/dh,near,far);
  refCam.position.copy(pos);refCam.up.set(0,1,0);refCam.lookAt(tgt);refCam.updateMatrixWorld(true);refCam.updateProjectionMatrix();
  const isPoints=!!geometry.getAttribute('splatSize');
  const focalPx=(dh/2)/Math.tan(THREE.MathUtils.degToRad(fov)/2);
  const mat=isPoints?new THREE.ShaderMaterial({
   uniforms:{uNear:{value:near},uFar:{value:far},uFocal:{value:focalPx}},
   vertexShader:'attribute float splatSize;varying float vDepth;uniform float uNear;uniform float uFar;uniform float uFocal;void main(){vec4 mv=modelViewMatrix*vec4(position,1.0);vDepth=clamp((-mv.z-uNear)/(uFar-uNear),0.0,1.0);gl_PointSize=clamp(splatSize*uFocal/max(-mv.z,0.1),2.0,16.0);gl_Position=projectionMatrix*mv;}',
   fragmentShader:'varying float vDepth;void main(){vec2 c=gl_PointCoord-0.5;if(dot(c,c)>0.25)discard;float d=floor(vDepth*16777215.0+0.5);float r=floor(d/65536.0);float g=floor(mod(d,65536.0)/256.0);float b=mod(d,256.0);gl_FragColor=vec4(r/255.0,g/255.0,b/255.0,1.0);}'
  }):new THREE.ShaderMaterial({
   side:THREE.DoubleSide,
   uniforms:{uNear:{value:near},uFar:{value:far}},
   vertexShader:'varying float vDepth;uniform float uNear;uniform float uFar;void main(){vec4 mv=modelViewMatrix*vec4(position,1.0);vDepth=clamp((-mv.z-uNear)/(uFar-uNear),0.0,1.0);gl_Position=projectionMatrix*mv;}',
   fragmentShader:'varying float vDepth;void main(){float d=floor(vDepth*16777215.0+0.5);float r=floor(d/65536.0);float g=floor(mod(d,65536.0)/256.0);float b=mod(d,256.0);gl_FragColor=vec4(r/255.0,g/255.0,b/255.0,1.0);}'
  });
  const tmpScene=new THREE.Scene(),tmpMesh=isPoints?new THREE.Points(geometry,mat):new THREE.Mesh(geometry,mat);tmpScene.add(tmpMesh);
  const rt=new THREE.WebGLRenderTarget(dw,dh,{depthBuffer:true,stencilBuffer:false});
  const prevTarget=renderer.getRenderTarget(),prevAlpha=renderer.getClearAlpha(),prevColor=renderer.getClearColor(new THREE.Color()),prevVp=renderer.getViewport(new THREE.Vector4());
  const depthRgba=new Uint8Array(dw*dh*4);
  try{
   renderer.setRenderTarget(rt);
   renderer.setViewport(0,0,dw,dh);
   renderer.setClearColor(0x000000,0);
   renderer.clear(true,true,false);
   renderer.render(tmpScene,refCam);
   renderer.readRenderTargetPixels(rt,0,0,dw,dh,depthRgba);
  }finally{
   renderer.setRenderTarget(prevTarget);
   renderer.setViewport(prevVp);
   renderer.setClearColor(prevColor,prevAlpha);
   rt.dispose();
   mat.dispose();
  }
  return {depthRgba,near,far,fov,matrixWorld:Array.from(refCam.matrixWorld.elements)};
 }

 const imgCanvas=document.createElement('canvas'),imgCtx=imgCanvas.getContext('2d',{willReadFrequently:true});
 async function ensureOutdoorWorkerBank(wallId,token,activate=false){
  if(!worker||token!==generation||workerBanksLoaded.has(wallId))return;
  const bundle=await fetchWallBundle(wallId);
  if(token!==generation||!worker||bundle.kind!=='outdoor'||!bundle.photoViews?.length)return;
  const cacheKey=`outdoor:${wallId}`;
  let tempGeom=geometryCache.get(cacheKey)?.geometry||null,ownGeom=false;
  if(!tempGeom){
   const parsed=await parseOutdoorModel(bundle.modelUrl,false);
   tempGeom=parsed.geometry;ownGeom=true;
  }
  try{
   const views=[],transfers=[];
   let focalRatio=.95;
   for(const pv of bundle.photoViews.slice(0,8)){
    if(token!==generation||!worker)return;
    const blob=await fetch(pv.href,{credentials:'omit'}).then(r=>r.ok?r.blob():null);
    if(!blob)continue;
    const bmp=await createImageBitmap(blob);
    const scale=640/Math.max(bmp.width,bmp.height),dw=Math.max(1,Math.round(bmp.width*scale)),dh=Math.max(1,Math.round(bmp.height*scale));
    imgCanvas.width=dw;imgCanvas.height=dh;
    imgCtx.drawImage(bmp,0,0,dw,dh);
    bmp.close();
    const image=imgCtx.getImageData(0,0,dw,dh);
    const d=renderLinearDepth(tempGeom,pv.camera,dw,dh);
    const fPx=(dh/2)/Math.tan(THREE.MathUtils.degToRad(d.fov)/2);
    focalRatio=fPx/Math.max(dw,dh);
    views.push({image,depthRgba:d.depthRgba,width:dw,height:dh,near:d.near,far:d.far,fov:d.fov,matrixWorld:d.matrixWorld});
    transfers.push(image.data.buffer,d.depthRgba.buffer);
   }
   if(views.length&&worker&&token===generation){
    workerBanksLoaded.add(wallId);
    worker.postMessage({type:'add_raw_wall',wallId,focalRatio,views,activate},transfers);
   }
  }finally{
   if(ownGeom)tempGeom.dispose();
  }
 }

 async function streamCandidateBanks(token){
  if(activeBundle?.kind==='outdoor'){
   try{await ensureOutdoorWorkerBank(activeWall,token,true);}catch(e){log.error(e);}
  }
  if(!autoDetectWall)return;
  for(const wid of Object.keys(INDOOR_WALLS)){
   if(token!==generation||!running||!worker)return;
   if(workerBanksLoaded.has(wid))continue;
   try{
    const b=await fetchWallBundle(wid);
    if(b.common?.camera?.references&&worker&&token===generation){
     workerBanksLoaded.add(wid);
     worker.postMessage({type:'add_wall',wallId:wid,map:b.common.camera});
    }
   }catch{}
  }
  for(const wid of Object.keys(OUTDOOR_CRAGS)){
   if(token!==generation||!running||!worker)return;
   while(token===generation&&running&&pose&&performance.now()-poseAt<=650){
    await new Promise(r=>setTimeout(r,250));
   }
   if(token!==generation||!running||!worker)return;
   try{await ensureOutdoorWorkerBank(wid,token,false);}catch{}
   await new Promise(r=>setTimeout(r,40));
  }
 }

 async function activateWall(targetWallId,{fromAutoDetect=false}={}){
  if(switchingWall||targetWallId===activeWall)return;
  switchingWall=true;
  try{
   const bundle=await fetchWallBundle(targetWallId);
   activeWall=targetWallId;
   activeBundle=bundle;
   manifest=bundle.manifest;
   common=bundle.common;
   if(bundle.kind==='indoor')buildIndoorOutlines(bundle);
   else clearOutlines();
   activeRouteId='all';
   renderRouteBar();
   await loadModel('wall');
   if(!running&&!fromAutoDetect)fit();
   modeUi();
   if(worker&&!fromAutoDetect){
    if(bundle.kind==='outdoor'&&!workerBanksLoaded.has(targetWallId)){
     await ensureOutdoorWorkerBank(targetWallId,generation,true);
    }else if(bundle.kind==='indoor'&&!workerBanksLoaded.has(targetWallId)&&bundle.common?.camera?.references){
     workerBanksLoaded.add(targetWallId);
     worker.postMessage({type:'add_wall',wallId:targetWallId,map:bundle.common.camera,activate:true});
    }
    worker.postMessage({type:'set_wall',wallId:activeWall,autoDetect:autoDetectWall});
   }
  }finally{
   switchingWall=false;
  }
 }

 if($('wall-select')){
  $('wall-select').onchange=async()=>{
   const val=$('wall-select').value;
   if(val==='auto'){
    autoDetectWall=true;
    renderRouteBar();
    if(worker){
     worker.postMessage({type:'set_wall',wallId:activeWall,autoDetect:true});
     streamCandidateBanks(generation).catch(()=>{});
    }
   }else{
    autoDetectWall=false;
    pose=null;
    await activateWall(val,{fromAutoDetect:false});
    renderRouteBar();
   }
  };
 }

 const assetsPromise=(async()=>{
  if(unknownWallParam){
   // 檢查是否為 3d/manifest.json 另外列出的室內牆，否則這面牆沒有追蹤資料
   const trackingManifest=await getJson(new URL('manifest.json',assetBase));
   const extra=manifestEntries(trackingManifest).find(w=>w?.wall===unknownWallParam);
   if(!extra)throw new Error(t('trkDataError'));
   INDOOR_WALLS[unknownWallParam]={id:unknownWallParam,pid:unknownWallParam,kind:'indoor',label:extra.label||unknownWallParam,basePath:'/3d/',starterRoutes:[]};
   activeWall=unknownWallParam;
  }
  const bundle=await fetchWallBundle(activeWall);
  activeBundle=bundle;
  manifest=bundle.manifest;
  common=bundle.common;
  if(bundle.kind==='indoor'){
   log.data.build=manifest.build;
   log.data.modelManifest={wall:manifest.wall,scene:manifest.scene,cameraBytes:manifest.cameraBytes,holds:manifest.holds,featurePoints:manifest.featurePoints,referenceViews:manifest.referenceViews};
  }else{
   log.data.build=manifest.build;
   log.data.modelManifest={wall:activeWall,scene:null,cameraBytes:0,holds:0,featurePoints:0,referenceViews:manifest.referenceViews};
  }
  if(bundle.kind==='indoor')buildIndoorOutlines(bundle);
  renderRouteBar();
  await loadModel('wall');
  if(log.segment){log.segment.modelBytes=current.bytes;log.segment.triangles=current.triangles;}
  const sel=$('wall-select');
  if(sel){
   const opt=sel.querySelector(`option[value="${activeWall}"]`);
   if(opt)opt.textContent=bundle.label;
  }
  fit();
  modeUi();
  for(const id of ['mode-model','mode-camera','camera-toggle'])$(id).disabled=false;
  document.body.dataset.ready='true';
  return common.camera;
 })();
 assetsPromise.catch(()=>{});

 function stop(reason='trkStopped'){if(log.active)log.active.previewDiagnostics=previewDiagnostics();generation++;workerBanksLoaded.clear();lastPreviewFrame=null;preview.width=preview.width;sensors.stop();frameClock=null;lastInputFrame=null;lastInputSensor=null;if(videoCallback!==null&&video.cancelVideoFrameCallback)video.cancelVideoFrameCallback(videoCallback);videoCallback=null;running=false;ready=false;busy=false;pose=null;controls.enabled=mode==='model';worker?.terminate();worker=null;if(workerUrl)URL.revokeObjectURL(workerUrl);workerUrl=null;stream?.getTracks().forEach(track=>track.stop());stream=null;video.pause();video.srcObject=null;log.end();status(reason);$('camera-toggle').disabled=false;$('camera-device').disabled=false;modeUi();}
 async function listCameras(token){
  const devices=await navigator.mediaDevices.enumerateDevices();if(token!==generation)return;
  cameraDevices=devices.filter(d=>d.kind==='videoinput');
  const select=$('camera-device');select.replaceChildren(new Option(t('trkAutoCamera'),''),...cameraDevices.map(d=>new Option(d.label||t('trkCamera'),d.deviceId)));select.value=selectedCamera;select.hidden=cameraDevices.length<2;
 }
 async function openCamera(token){
  const constraints=cameraConstraints($('stage').clientWidth,$('stage').clientHeight);requestedAspect=constraints.aspectRatio.ideal;
  const chosenId=selectedCamera||autoCameraId,profileKey=id=>`${id}/${requestedAspect<1?'portrait':'landscape'}`,profile=chosenId?cameraProfiles.get(profileKey(chosenId)):null;
  let corrected=profile?.reversed??false,usedConstraints=corrected?reverseCameraConstraints(constraints):constraints;
  const request=deviceId=>navigator.mediaDevices.getUserMedia({audio:false,video:{...usedConstraints,...(deviceId?{deviceId:{exact:deviceId}}:{facingMode:{ideal:'environment'}})}});
  let opened=await request(chosenId);
  if(token!==generation){opened.getTracks().forEach(t=>t.stop());return null;}
  stream=opened;
  try{await listCameras(token);}catch(error){log.error(error);}
  if(token!==generation){opened.getTracks().forEach(t=>t.stop());return null;}
  const primary=chosenId?null:mainCamera(cameraDevices),active=opened.getVideoTracks()[0].getSettings().deviceId;
  if(primary&&primary.deviceId!==active){
   opened.getTracks().forEach(t=>t.stop());
   opened=await request(primary.deviceId);
   if(token!==generation){opened.getTracks().forEach(t=>t.stop());return null;}
   stream=opened;
  }
  const cameraId=chosenId||primary?.deviceId||opened.getVideoTracks()[0].getSettings().deviceId;
  if(!selectedCamera&&cameraId){autoCameraId=cameraId;if(primary)autoMain=true;}
  async function playFirstFrame(){
   const track=opened.getVideoTracks()[0],before=track.getSettings(),caps=track.getCapabilities?.();
   if(caps?.zoom&&caps.zoom.min<=1&&caps.zoom.max>=1){try{await track.applyConstraints({...track.getConstraints(),advanced:[{zoom:1}]});}catch(error){log.error(error);}}
   video.muted=true;video.playsInline=true;video.autoplay=true;video.srcObject=opened;
   const wait=firstCameraFrame(video),startAt=performance.now();await Promise.all([video.play(),wait]);
   const frame=await wait;
   log.event('camera_first_frame',{requestedSize:[usedConstraints.width.ideal,usedConstraints.height.ideal],beforeSettingsSize:[before.width,before.height],videoSize:[frame.width,frame.height],waitMs:Math.round(performance.now()-startAt)});
   return frame;
  }
  let frame=await playFirstFrame();
  if(token!==generation){opened.getTracks().forEach(t=>t.stop());return null;}
  if(reversedCameraFrame(constraints,frame.width,frame.height)){
   const deviceId=cameraId;
   opened.getTracks().forEach(t=>t.stop());video.pause();video.srcObject=null;
   corrected=!corrected;usedConstraints=corrected?reverseCameraConstraints(constraints):constraints;
   opened=await navigator.mediaDevices.getUserMedia({audio:false,video:{...usedConstraints,...(deviceId?{deviceId:{exact:deviceId}}:{facingMode:{ideal:'environment'}})}});
   if(token!==generation){opened.getTracks().forEach(t=>t.stop());return null;}
   stream=opened;frame=await playFirstFrame();
   if(token!==generation){opened.getTracks().forEach(t=>t.stop());return null;}
   if(reversedCameraFrame(constraints,frame.width,frame.height)){const error=new Error(t('trkCameraFormat'));error.name='CameraOrientationError';throw error;}
  }
  if(cameraId)cameraProfiles.set(profileKey(cameraId),{reversed:corrected});
  const settings=opened.getVideoTracks()[0].getSettings();$('camera-device').value=cameraId||settings.deviceId||'';
  log.event('camera_view',{selection:selectedCamera?'manual':autoMain?'main_camera':'browser_default',fit:'cover',requestedAspectRatio:requestedAspect,requestedSize:[usedConstraints.width.ideal,usedConstraints.height.ideal],actualSize:[settings.width,settings.height],videoSize:[frame.width,frame.height],coordinateCorrection:corrected,profileReused:!!profile,resizeMode:settings.resizeMode??null,zoom:settings.zoom??null});
  return opened;
 }
 async function adjustCamera(){
  if(!running||shapeBusy||requestedAspect===null)return;
  const shape=cameraConstraints($('stage').clientWidth,$('stage').clientHeight);
  if((shape.aspectRatio.ideal>=1)===(requestedAspect>=1))return;
  shapeBusy=true;log.event('camera_orientation_changed');stop();
  try{await start();}finally{shapeBusy=false;}
  if(running)await adjustCamera();
 }
 async function start(){if(running){stop();return;}if(!navigator.mediaDevices?.getUserMedia){document.body.dataset.error='true';status('trkSecure');return;}delete document.body.dataset.error;const token=++generation;workerBanksLoaded.clear();mode='camera';setTools(false);modeUi();$('camera-toggle').disabled=true;$('camera-device').disabled=true;status('trkPermission');log.begin(current,trackingMode);
  try{const opened=await openCamera(token);if(!opened)return;stream=opened;log.stream(stream.getVideoTracks()[0].getSettings());log.event('render_config',{pixelRatio:renderer.getPixelRatio(),antialias:renderer.getContext().getContextAttributes().antialias});stream.getVideoTracks()[0].addEventListener('ended',()=>{if(token===generation&&running)stop('trkInterrupted');});if(token!==generation)return;const track=stream.getVideoTracks()[0];for(const kind of ['mute','unmute'])track.addEventListener(kind,()=>{if(token===generation)log.event('camera_'+kind,{muted:track.muted});});running=true;sensors.start();errors=0;lastSent=0;status('trkRuntime');modeUi();$('camera-toggle').disabled=false;$('camera-device').disabled=false;
   if(video.requestVideoFrameCallback){const count=(now,metadata)=>{if(!running||token!==generation)return;videoFrames++;frameClock={serial:(frameClock?.serial??0)+1,at:Number.isFinite(metadata.presentationTime)&&Math.abs(now-metadata.presentationTime)<1000?metadata.presentationTime:now,mediaTime:metadata.mediaTime};videoCallback=video.requestVideoFrameCallback(count);};videoCallback=video.requestVideoFrameCallback(count);}
   const loadedMap=common?.camera||await assetsPromise;if(token!==generation||!running)return;
   workerUrl=URL.createObjectURL(new Blob([`(${cameraWorkerMain.toString()})()`],{type:'text/javascript'}));worker=new Worker(workerUrl);
   worker.onmessage=({data})=>{
    if(token!==generation)return;
    if(data.type==='ready'){
     ready=true;log.ready();status('trkSearching');
     streamCandidateBanks(token).catch(()=>{});
     return;
    }
    if(data.type==='bank_ready')return;
    busy=false;
    if(data.type==='error'){log.error(data.error);pose=null;if(!ready||++errors>=3){document.body.dataset.error='true';stop('trkRuntimeError');}return;}
    if(data.type==='pose'){
     if(data.epoch!==trackingEpoch)return;
     fpsProcessed++;errors=0;
     if(data.pose&&data.wallId&&data.wallId!==activeWall&&!switchingWall){
      activateWall(data.wallId,{fromAutoDetect:true}).catch(err=>log.error(err));
     }
     pose=data.pose;poseWallId=data.wallId||activeWall;poseAt=lastSent;const latency=performance.now()-lastSent;
     log.frame({pose,mode:data.mode,latency,processingMs:data.processingMs,sceneScale,motionAttempted:data.motionAttempted,motionSeeded:data.motionSeeded,diagnostics:data.diagnostics});
     status(pose?'trkTracking':'trkSearching');
     $('latency').textContent=pose?`${Math.round(latency)} ms`:'—';
    }
   };
   worker.onerror=e=>{log.error(e.message);document.body.dataset.error='true';stop('trkRuntimeError');};
   if(loadedMap?.references)workerBanksLoaded.add(activeWall);
   worker.postMessage({type:'init',map:loadedMap,activeWallId:activeWall,autoDetect:autoDetectWall,runtimeUrl:new URL('../redpoint/vendor/opencv-4.10.0.js',location.href).href});
  }catch(error){if(token!==generation)return;log.error(error);document.body.dataset.error='true';if(error.name==='NotAllowedError'||error.name==='CameraOrientationError'){delete document.documentElement.dataset.auto;delete document.body.dataset.auto;}const msg=error.name==='NotAllowedError'?'trkDenied':error.name==='CameraOrientationError'?'trkCameraFormat':error.message===t('trkDataError')?'trkDataError':error.message===t('trkLoadError')?'trkLoadError':'trkCameraError';stop(msg);}
 }
 function setView(p){const R=p.R,v=p.t;view.matrixWorldInverse.set(R[0],R[1],R[2],v[0],-R[3],-R[4],-R[5],-v[1],-R[6],-R[7],-R[8],-v[2],0,0,0,1);view.matrixWorld.copy(view.matrixWorldInverse).invert();const n=.01,f=500;view.projectionMatrix.set(2*p.focal/p.width,0,0,0,0,2*p.focal/p.height,0,0,0,0,-(f+n)/(f-n),-2*f*n/(f-n),0,0,-1,0);view.projectionMatrixInverse.copy(view.projectionMatrix).invert();}
 let fpsAt=performance.now(),fpsFrames=0,fpsProcessed=0;
 function tick(now){requestAnimationFrame(tick);drawPreview();const dt=Math.min(1000,now-lastTick);lastTick=now;const r=$('stage').getBoundingClientRect(),fresh=!!pose&&now-poseAt<=650&&poseWallId===activeWall;renderer.setViewport(0,0,r.width,r.height);renderer.clear();if(document.body.dataset.located!==String(fresh))document.body.dataset.located=String(fresh);let rendered=false;
  if(mode==='model'){
   if(base){controls.update();renderer.render(scene,camera);drawOverlays(camera,{x:0,y:0,width:r.width,height:r.height});rendered=true;}
  }else if(fresh&&base){
   setView(pose);
   const v=cameraViewport(r.width,r.height,pose.width,pose.height);
   renderer.setViewport(v.x,v.y,v.width,v.height);
   renderer.render(scene,view);
   drawOverlays(view,v);
   rendered=true;
  }else{
   clearOverlays();
  }
  if(sensors.tick(now,{mode:trackingMode,running,frameAt:frameClock?.at}))log.data.motion=sensors.report();
  if(running){log.tick({dt,rendered,visible:fresh,videoFrames,drawCalls:rendered?renderer.info.render.calls:0,triangles:rendered?renderer.info.render.triangles:0});videoFrames=0;if(ready&&!busy&&video.readyState>=2&&now-lastSent>100){const scale=640/Math.max(video.videoWidth,video.videoHeight),w=Math.round(video.videoWidth*scale),h=Math.round(video.videoHeight*scale);const mediaTime=frameClock?`frame:${frameClock.serial}`:`time:${video.currentTime}`;if(w&&h&&mediaTime!==lastInputFrame){const frameAt=frameClock?.at??now,inputSensor=sensors.at(frameAt),delta=trackingMode==='rotation'&&stream?.getVideoTracks()[0].getSettings().facingMode!=='user'?rotationBetween(lastInputSensor,inputSensor):null;lastInputSensor=inputSensor;lastInputFrame=mediaTime;capture.width=w;capture.height=h;ctx.drawImage(video,0,0,w,h);const image=ctx.getImageData(0,0,w,h);busy=true;lastSent=now;worker.postMessage({type:'frame',image,frameId:++frames,epoch:trackingEpoch,rotationDelta:delta?.matrix??null},[image.data.buffer]);}}}
  if(rendered)fpsFrames++;if(now-fpsAt>=1000){$('fps').textContent=`${Math.round(fpsFrames*1000/(now-fpsAt))} FPS`;$('hz').textContent=mode==='camera'?`${(fpsProcessed*1000/(now-fpsAt)).toFixed(1)} Hz`:'—';fpsAt=now;fpsFrames=0;fpsProcessed=0;}
 }
 $('mode-model').onclick=()=>{stop();mode='model';modeUi();};$('mode-camera').onclick=()=>{if(mode==='camera')return;mode='camera';modeUi();start();};$('camera-toggle').onclick=()=>{mode='camera';modeUi();start();};
 for(const [id,mark] of [['mark-drift','drift'],['mark-loss','missing_outline']])$(id).onclick=()=>{log.mark(mark,{previewDiagnostics:previewDiagnostics()});$('notice').textContent=t('trkMarked');};
 $('motion-mode').onclick=async()=>{const button=$('motion-mode');button.disabled=true;try{if(trackingMode==='vision'){if(sensors.permission!=='granted'&&!await sensors.request()){log.event('motion_permission',{state:sensors.permission});$('notice').textContent=t('trkMotionUnavailable');return;}if(running)sensors.start();trackingMode='rotation';}else trackingMode='vision';button.textContent=t(trackingMode==='rotation'?'trkRotation':'trkVision');log.event('tracking_mode',{mode:trackingMode});if(running){log.variant(current,trackingMode);trackingEpoch++;lastInputSensor=null;pose=null;worker?.postMessage({type:'reset'});}}finally{button.disabled=false;}};
 $('camera-device').onchange=()=>{selectedCamera=$('camera-device').value;if(running){stop();start();}};
 $('copy-log').onclick=async()=>{log.data.motion=sensors.report();log.data.previewDiagnostics=previewDiagnostics();log.data.display={fit:'cover',previewRenderer:'canvas-2d',viewport:[$('stage').clientWidth,$('stage').clientHeight],video:[video.videoWidth,video.videoHeight],imageViewport:video.videoWidth?cameraViewport($('stage').clientWidth,$('stage').clientHeight,video.videoWidth,video.videoHeight):null,toolsOpen:document.body.dataset.tools==='open',renderPixelRatio:renderer.getPixelRatio()};log.data.resources=performance.getEntriesByType('resource').filter(x=>{const p=new URL(x.name).pathname;return p.startsWith('/3d/')||p.startsWith('/p/')||p.includes('opencv-4.10.0.js');}).map(x=>({asset:new URL(x.name).pathname.split('/').at(-1),durationMs:Math.round(x.duration),transferBytes:x.transferSize,encodedBytes:x.encodedBodySize,decodedBytes:x.decodedBodySize}));log.data.rendererMemory={...renderer.info.memory};const text=log.text();log.persist();try{await navigator.clipboard.writeText(text);$('notice').textContent=t('trkCopied');}catch{$('log-text').value=text;$('log-dialog').showModal();$('log-text').select();}};
 $('close-log').onclick=()=>$('log-dialog').close();$('download-log').onclick=()=>{const url=URL.createObjectURL(new Blob([log.text()],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='climbio-3d-tracking.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
 window.addEventListener('error',e=>log.error(e.message));window.addEventListener('unhandledrejection',e=>log.error(e.reason));window.addEventListener('pagehide',()=>{stop();log.persist();});document.addEventListener('visibilitychange',()=>{if(document.hidden&&running)stop();});
 fit();modeUi();requestAnimationFrame(tick);
 window.trackingTest={get state(){return {mode,running,ready,trackingMode,activeWall,autoDetectWall,activeRouteId,motionPermission:sensors.permission,located:!!pose&&performance.now()-poseAt<=650&&poseWallId===activeWall,pose:pose?structuredClone(pose):null,model:current,frames,load:lastModelFetch,display:{fit:'cover',previewRenderer:'canvas-2d',width:$('stage').clientWidth,height:$('stage').clientHeight,imageViewport:video.videoWidth?cameraViewport($('stage').clientWidth,$('stage').clientHeight,video.videoWidth,video.videoHeight):null,toolsOpen:document.body.dataset.tools==='open'},triangles:renderer.info.render.triangles,drawCalls:renderer.info.render.calls};},report:()=>log.report(),project:xyz=>pose?new THREE.Vector3(...xyz).project(view).toArray():null,switchWall:wid=>activateWall(wid,{fromAutoDetect:false})};
 // 岩點貓的相機看線（auto=1）：不等比對資料與模型，立即開相機顯示畫面
 if(autoCamera){start();}else{await assetsPromise;status('trkReady');}
}
main().catch(error=>{setTools(true);document.body.dataset.error='true';$('tools-toggle').onclick=()=>setTools(document.body.dataset.tools!=='open');const known=[AppKit.i18n.t('trkDataError'),AppKit.i18n.t('trkLoadError'),AppKit.i18n.t('trkUpdatePage')].includes(error?.message);document.getElementById('status').textContent=known?error.message:t('trkStartupError');console.error(error);const text=JSON.stringify({schema:'climbio-tracking-log/1',startupError:String(error.message),userAgent:navigator.userAgent,at:new Date().toISOString()});$('copy-log').onclick=async()=>{try{await navigator.clipboard.writeText(text);$('notice').textContent=t('trkCopied');}catch{$('log-text').value=text;$('log-dialog').showModal();$('log-text').select();}};$('close-log').onclick=()=>$('log-dialog').close();});
