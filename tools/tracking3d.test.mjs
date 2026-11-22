import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {TrackingLog} from '../3d/source/holds-3d-tracking-log.js';
const root=new URL('../3d/',import.meta.url);
test('追蹤資料只有相機比對資料，雜湊、大小與特徵數由 manifest 對照',()=>{
 const manifest=JSON.parse(readFileSync(new URL('manifest.json',root)));assert.equal(manifest.containsImages,false);assert.match(manifest.wall,/^[0-9a-z]{16}$/);
 const bytes=readFileSync(new URL(manifest.camera.url,root));assert.equal(bytes.length,manifest.camera.bytes);assert.equal(createHash('sha256').update(bytes).digest('hex'),manifest.camera.sha256);
 const camera=JSON.parse(bytes);assert.equal(camera.scene,manifest.scene);assert.equal(camera.references.length,manifest.referenceViews);assert.equal(camera.references.reduce((a,r)=>a+r.n,0),manifest.featurePoints);assert.ok(camera.references.every(ref=>Object.keys(ref).sort().join(',')==='desc,n,xyz'));
});
test('追蹤紀錄按模型分段，保存掉追蹤與人工標記且排除相機識別碼',()=>{
 let clock=0;const saved=new Map(),storage={getItem:k=>saved.get(k),setItem:(k,v)=>saved.set(k,v)},log=new TrackingLog({build:'test',manifest:{},device:{},storage,now:()=>clock,date:()=>new Date(clock).toISOString()});
 log.begin({id:'full',bytes:500,triangles:100});clock=100;log.stream({width:640,height:480,deviceId:'private-id',groupId:'private-group'});clock=200;log.ready();clock=300;const pose={R:[1,0,0,0,1,0,0,0,1],t:[0,0,3],inliers:100,medianError:.5};log.frame({pose,mode:'localized',latency:30,processingMs:20});clock=500;log.tick({dt:200,rendered:true,visible:true,videoFrames:3,drawCalls:10,triangles:120});clock=600;log.frame({pose:null,mode:'searching',latency:40,processingMs:30});clock=1000;log.frame({pose,mode:'localized',latency:20,processingMs:10});log.mark('drift');clock=1500;log.variant({id:'light',bytes:200,triangles:30});clock=1700;log.frame({pose,mode:'tracking',latency:10,processingMs:5});clock=2000;log.end();
 const report=JSON.parse(log.text()),s=report.sessions[0];assert.equal(s.firstPoseAfterStreamMs,200);assert.equal(s.runtimeReadyAfterStreamMs,100);assert.equal(s.settings.deviceId,undefined);assert.equal(s.settings.groupId,undefined);assert.equal(s.segments.length,2);assert.equal(s.segments[0].losses,1);assert.equal(s.segments[0].reacquisitionMs.p50,400);assert.equal(s.segments[1].model,'light');assert.equal(s.segments[1].latencyMs.p50,10);assert.ok(report.events.some(e=>e.kind==='user_mark'&&e.mark==='drift'));assert.equal(report.notes.containsImages,false);assert.equal(report.notes.containsFramePixels,false);assert.equal(report.frames,undefined);assert.ok(!log.text().includes('private-id'));
 const restored=new TrackingLog({build:'test',manifest:{},device:{},storage,now:()=>clock});assert.deepEqual(restored.report(),JSON.parse(saved.get('climbio.tracking3d.last')));
});

test('相機主鏡頭不以排列順序猜測，預覽依螢幕比例請求並填滿畫面',async()=>{
 const {mainCamera,cameraViewport,cameraConstraints}=await import('../3d/source/holds-3d-camera-view.js');
 const devices=['Front Camera','Back Ultra Wide Camera','Back Camera','Back Telephoto Camera'].map((label,i)=>({kind:'videoinput',label,deviceId:String(i)}));assert.equal(mainCamera(devices).deviceId,'2');assert.equal(mainCamera(devices.filter(d=>d.deviceId!=='2')),undefined);assert.equal(mainCamera([{kind:'videoinput',label:'後置相機'}]).label,'後置相機');
 for(const [w,h,fw,fh] of [[390,844,1280,960],[390,844,960,1280],[844,390,1280,960]]){const v=cameraViewport(w,h,fw,fh);assert.ok(v.x<=.001&&v.y<=.001);assert.ok(v.x+v.width>=w-.001&&v.y+v.height>=h-.001);assert.ok(Math.abs(v.width/v.height-fw/fh)<1e-8);assert.ok(Math.abs(v.width-w)<.001||Math.abs(v.height-h)<.001);const c=cameraConstraints(w,h);assert.equal(c.aspectRatio.ideal,w/h);assert.ok(Math.abs(w>=h?c.height.ideal-c.width.ideal/(w/h):c.width.ideal-c.height.ideal*(w/h))<=.5);}
 const mismatched=cameraViewport(390,797,1280,720);assert.ok(Math.abs(mismatched.visibleWidthFraction-.27525)<.001);assert.equal(mismatched.visibleHeightFraction,1);
});

test('感測旋轉座標、時間邊界及權限拒絕有明確行為',async()=>{
 const {cameraRotation,rotationBetween,MotionSensors}=await import('../3d/source/holds-3d-motion.js');
 const previous={at:100,screen:0,matrix:cameraRotation(0,0,0)},current={at:200,screen:0,matrix:cameraRotation(0,0,-10)},delta=rotationBetween(previous,current);assert.ok(Math.abs(delta.degrees-10)<1e-8);
 // 手機向右旋轉時，原來正前方的點應向畫面左移。
 assert.ok(delta.matrix[2]<0);assert.equal(rotationBetween(previous,{...current,at:400}),null);assert.equal(rotationBetween(previous,{...current,screen:90}),null);assert.equal(rotationBetween(previous,{...current,matrix:cameraRotation(0,0,40)}),null);
 const host=new EventTarget();host.DeviceOrientationEvent={requestPermission:async()=> 'denied'};const denied=new MotionSensors({host,now:()=>100});assert.equal(await denied.request(),false);denied.start();assert.equal(denied.attached,false);
 host.DeviceOrientationEvent={requestPermission:async()=> 'granted'};host.screen={orientation:{angle:0}};let now=200;const sensors=new MotionSensors({host,now:()=>now});assert.equal(await sensors.request(),true);sensors.start();const event=new Event('deviceorientation');Object.assign(event,{alpha:12,beta:3,gamma:4});Object.defineProperty(event,'timeStamp',{value:200});host.dispatchEvent(event);assert.ok(sensors.at(200));assert.equal(sensors.at(301),null);assert.equal(sensors.at(199),null);now=1300;sensors.tick(now,{mode:'rotation',running:true,frameAt:500});assert.equal(sensors.report().samples[0].videoAgeMs,800);assert.ok(!JSON.stringify(sensors.report()).includes('matrix'));sensors.stop();assert.equal(sensors.at(200),null);
});

test('只依實際首幀判斷 Safari 請求反向，並保留相同鏡頭參數',async()=>{
 const {cameraConstraints,reversedCameraFrame,reverseCameraConstraints,firstCameraFrame,cameraViewport}=await import('../3d/source/holds-3d-camera-view.js');const c=cameraConstraints(390,797);assert.equal(reversedCameraFrame(c,1280,626),true);assert.equal(reversedCameraFrame(c,626,1280),false);assert.equal(reversedCameraFrame(c,640,480),false);const reversed=reverseCameraConstraints(c);assert.deepEqual(reversed.width,c.height);assert.deepEqual(reversed.height,c.width);assert.equal(reversed.aspectRatio.ideal,1/c.aspectRatio.ideal);assert.deepEqual(reversed.resizeMode,c.resizeMode);assert.ok(cameraViewport(390,797,626,1280).visibleWidthFraction>.99);
 const video=new EventTarget();let callback;Object.assign(video,{videoWidth:0,videoHeight:0,readyState:0,requestVideoFrameCallback:fn=>{callback=fn;return 1;},cancelVideoFrameCallback:()=>{}});const waiting=firstCameraFrame(video);Object.assign(video,{videoWidth:1280,videoHeight:626,readyState:2});callback();assert.deepEqual(await waiting,{width:1280,height:626});
});

test('停止後掉追蹤時長固定，新工作階段不沿用舊影格延遲',()=>{
 let clock=0;const log=new TrackingLog({build:'test',manifest:{},device:{},now:()=>clock,date:()=>new Date(clock).toISOString()});const model={id:'balanced',bytes:1,triangles:1},pose={R:[1,0,0,0,1,0,0,0,1],t:[0,0,3],inliers:20,medianError:1};log.begin(model);clock=1000;log.frame({pose,mode:'tracking',latency:25,processingMs:13});clock=2000;log.frame({pose:null,mode:'searching',latency:20,processingMs:1});clock=3500;log.end();clock=130000;assert.equal(log.report().sessions[0].segments[0].openLossMs,1500);log.begin(model);clock=131000;log.tick({dt:1000,videoFrames:30});const sample=log.report().samples.at(-1);assert.equal(sample[5],null);assert.equal(sample[6],null);assert.equal(log.report().sessions[0].segments[0].openLossMs,1500);
});
test('黑邊檢查只回報摘要，暗畫面不被誤判為可裁切內容',async()=>{
 const {frameContentSummary}=await import('../3d/source/holds-3d-camera-view.js');const width=40,height=80,data=new Uint8ClampedArray(width*height*4);for(let y=20;y<60;y++)for(let x=10;x<30;x++){data[(y*width+x)*4]=120;data[(y*width+x)*4+3]=255;}const result=frameContentSummary({width,height,data});assert.equal(result.suspectedInset,true);assert.deepEqual(result.bounds,[.25,.25,.5,.5]);assert.equal(frameContentSummary({width,height,data:new Uint8ClampedArray(data.length)}).suspectedInset,false);assert.ok(!JSON.stringify(result).includes('data'));
});

test('定位診斷分辨特徵、匹配與幾何拒絕並保留標記當下摘要',()=>{
 let clock=0;const log=new TrackingLog({build:'test',manifest:{},device:{},now:()=>clock,date:()=>new Date(clock).toISOString()});log.begin({id:'balanced',bytes:1,triangles:1});clock=1000;const d={stage:'search',reason:'insufficient_matches',queryFeatures:800,matched3d:7,flowPoints:null,maxInliers:0,coverage:null,referenceHits:[[2,6],[1,4]],pnpRejected:0,coverageRejected:0,errorRejected:0,behindRejected:0};log.frame({pose:null,mode:'searching',latency:20,processingMs:15,diagnostics:d});const report=log.report(),row=Object.fromEntries(report.diagnosticColumns.map((key,i)=>[key,report.diagnosticSamples[0][i]]));assert.equal(row.session_started_s,0);assert.equal(row.query_features,800);assert.equal(row.matched_3d,7);assert.equal(row.best_reference,2);assert.equal(row.best_reference_matches,6);assert.equal(row.reason,'insufficient_matches');log.mark('missing_outline',{previewDiagnostics:{suspectedInset:false}});const mark=log.report().events.at(-1);assert.equal(mark.diagnostics.queryFeatures,800);assert.equal(mark.previewDiagnostics.suspectedInset,false);assert.ok(!('desc' in mark.diagnostics));
});

test('SPZ 解析支援 v2 點雲座標與透明度篩選並拒絕無效檔頭',async()=>{
 const {parseSpzBuffer}=await import('../3d/source/holds-3d-spz.js');
 const n=2,frac=9,scale=1<<frac,raw=new Uint8Array(16+n*16);
 const view=new DataView(raw.buffer);
 view.setUint32(0,0x5053474e,true);view.setUint32(4,2,true);view.setUint32(8,n,true);raw[12]=0;raw[13]=frac;
 const write24=(off,val)=>{const iv=Math.round(val*scale);raw[off]=iv&255;raw[off+1]=(iv>>8)&255;raw[off+2]=(iv>>16)&255;};
 write24(16,1.5);write24(19,-2.25);write24(22,3.0);
 write24(25,0.5);write24(28,0.5);write24(31,0.5);
 raw[16+n*9]=255;raw[16+n*9+1]=10;
 raw.fill(128,16+n*10,16+n*13);raw.fill(140,16+n*13,16+n*16);
 const parsed=parseSpzBuffer(raw);
 assert.equal(parsed.version,2);assert.equal(parsed.totalPoints,2);assert.equal(parsed.count,1);
 assert.ok(Math.abs(parsed.positions[0]-1.5)<1e-3);assert.ok(Math.abs(parsed.positions[1]+2.25)<1e-3);assert.ok(Math.abs(parsed.positions[2]-3.0)<1e-3);
 assert.throws(()=>parseSpzBuffer(new Uint8Array(16)));
});
