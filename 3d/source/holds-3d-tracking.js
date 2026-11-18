import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {MeshoptDecoder} from 'three/addons/libs/meshopt_decoder.module.js';
import {cameraWorkerMain} from './holds-3d-camera-worker.js';
import {MotionSensors,rotationBetween} from './holds-3d-motion.js';
import {mainCamera,cameraViewport,cameraConstraints,reversedCameraFrame,reverseCameraConstraints,firstCameraFrame,frameContentSummary} from './holds-3d-camera-view.js';
import {TrackingLog} from './holds-3d-tracking-log.js';
const assetBase=new URL('/3d/',location.origin);
const $=id=>document.getElementById(id),t=(key,...args)=>AppKit.i18n.t(key,...args);
const decode=(value,Type=Float32Array)=>new Type(Uint8Array.from(atob(value),c=>c.charCodeAt(0)).buffer);
function setTools(open){document.body.dataset.tools=open?'open':'closed';$('tools-toggle').setAttribute('aria-expanded',String(open));}
async function main(){
 AppKit.i18n.apply();
 if(document.body.dataset.trackingUi!=='2'){
  const url=new URL(location.href);
  if(url.searchParams.get('ui')==='2')throw new Error(t('trkUpdatePage'));
  url.searchParams.set('ui','2');location.replace(url.href);return;
 }
 let manifest=await fetch(new URL('model-manifest.json',assetBase)).then(r=>{if(!r.ok)throw new Error(t('trkLoadError'));return r.json();});
 const common=await fetch(new URL(manifest.common.url,assetBase)).then(r=>{if(!r.ok)throw new Error(t('trkLoadError'));return r.json();});
 const log=new TrackingLog({build:manifest.build,manifest:{models:manifest.models,commonBytes:manifest.common.bytes,overlayTriangles:manifest.overlayTriangles,holds:manifest.holds,featurePoints:manifest.featurePoints,referenceViews:manifest.referenceViews},device:{userAgent:navigator.userAgent,language:navigator.language,timezone:Intl.DateTimeFormat().resolvedOptions().timeZone,screen:[innerWidth,innerHeight],devicePixelRatio,renderPixelRatio:Math.min(devicePixelRatio,1.5),hardwareConcurrency:navigator.hardwareConcurrency??null,deviceMemoryGB:navigator.deviceMemory??null},storage:localStorage});
 const renderer=new THREE.WebGLRenderer({alpha:true,antialias:true,preserveDrawingBuffer:true});renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.setClearColor(0,0);renderer.domElement.id='tracking-canvas';$('stage').append(renderer.domElement);
 const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(50,1,.005,100),view=new THREE.PerspectiveCamera();view.matrixAutoUpdate=false;view.matrixWorldAutoUpdate=false;
 const controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;controls.zoomSpeed=3;controls.zoomToCursor=true;
 const light=new THREE.DirectionalLight(0xffffff,2.5);light.position.set(2,4,6);scene.add(light,new THREE.HemisphereLight(0xdfefff,0x27343d,2));
 const solidMaterial=new THREE.MeshStandardMaterial({color:0x849298,roughness:1,side:THREE.DoubleSide}),depthMaterial=new THREE.MeshBasicMaterial({colorWrite:false,depthWrite:true,side:THREE.DoubleSide});
 let base=null,current=null,modelToken=0,mode='model',running=false,ready=false,busy=false,worker=null,workerUrl=null,stream=null,generation=0,pose=null,poseAt=0,lastSent=0,frames=0,videoFrames=0,videoCallback=null,errors=0,lastTick=performance.now(),sceneScale=1,lastModelFetch=null,selectedCamera='',cameraDevices=[],trackingMode='vision',frameClock=null,lastInputFrame=null,lastInputSensor=null,trackingEpoch=0,requestedAspect=null,shapeBusy=false,autoCameraId='',autoMain=false,lastPreviewFrame=null;
 const cameraProfiles=new Map();
 const sensors=new MotionSensors({origin:log.start});
 const positions=decode(common.positions),triangles=decode(common.triangles,Uint32Array),weights=decode(common.weights,Uint8Array),offsets=decode(common.offsets,Uint32Array),outlines=[],geometryCache=new Map();
 if(weights.length!==triangles.length||offsets.length!==common.holds.length+1)throw new Error(t('trkDataError'));
 const sampleGeometry=new THREE.BufferGeometry();sampleGeometry.setAttribute('position',new THREE.BufferAttribute(positions,3));sampleGeometry.computeBoundingBox();const box=sampleGeometry.boundingBox,center=box.getCenter(new THREE.Vector3());sceneScale=box.getSize(new THREE.Vector3()).length();controls.target.copy(center);
 const outlineMaterial=new THREE.MeshBasicMaterial({color:0x78d4d6,transparent:true,depthWrite:false,side:THREE.DoubleSide,polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-2});
 outlineMaterial.onBeforeCompile=shader=>{shader.vertexShader='attribute float holdWeight;varying float weight;\n'+shader.vertexShader;shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nweight=holdWeight;');shader.fragmentShader='varying float weight;\n'+shader.fragmentShader;shader.fragmentShader=shader.fragmentShader.replace('#include <opaque_fragment>','float aa=max(fwidth(weight),.001);float edge=1.-smoothstep(aa,aa*2.5,abs(weight-.4));if(edge<.02)discard;gl_FragColor=vec4(outgoingLight,edge);');};
 for(let h=0;h<common.holds.length;h++){const begin=offsets[h]*3,end=offsets[h+1]*3,p=new Float32Array((end-begin)*3),w=new Float32Array(end-begin);for(let j=begin;j<end;j++){p.set(positions.subarray(triangles[j]*3,triangles[j]*3+3),(j-begin)*3);w[j-begin]=weights[j]/255;}const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(p,3));g.setAttribute('holdWeight',new THREE.BufferAttribute(w,1));const mesh=new THREE.Mesh(g,outlineMaterial);mesh.renderOrder=2;scene.add(mesh);outlines.push(mesh);}
 const preview=document.createElement('canvas');preview.id='live-preview';$('stage').insertBefore(preview,renderer.domElement);const previewCtx=preview.getContext('2d',{alpha:false});
 const video=$('live-video'),capture=document.createElement('canvas'),ctx=capture.getContext('2d',{willReadFrequently:true});
 function drawPreview(){
  if(!running||video.readyState<2||!video.videoWidth||!video.videoHeight)return;
  const rect=$('stage').getBoundingClientRect(),ratio=renderer.getPixelRatio(),w=Math.round(rect.width*ratio),h=Math.round(rect.height*ratio),key=frameClock?`frame:${frameClock.serial}`:`time:${video.currentTime}`;
  const resized=preview.width!==w||preview.height!==h;if(resized){preview.width=w;preview.height=h;}
  if(!resized&&key===lastPreviewFrame)return;lastPreviewFrame=key;
  const v=cameraViewport(w,h,video.videoWidth,video.videoHeight);previewCtx.drawImage(video,v.x,v.y,v.width,v.height);
 }
 function previewDiagnostics(){
  try{if(video.readyState<2||!video.videoWidth)return null;
  const probe=document.createElement('canvas');probe.width=96;probe.height=Math.min(256,Math.max(1,Math.round(96*video.videoHeight/video.videoWidth)));const c=probe.getContext('2d',{willReadFrequently:true});c.drawImage(video,0,0,probe.width,probe.height);const rect=video.getBoundingClientRect();
  return {...frameContentSummary(c.getImageData(0,0,probe.width,probe.height)),videoElement:[rect.x,rect.y,rect.width,rect.height],canvas:[preview.width,preview.height]};}catch(error){return {unavailable:String(error.name||'Error')};}
 }
 function status(key){$('status').textContent=t(key);}
 function fit(){const rect=$('stage').getBoundingClientRect();renderer.setSize(Math.max(1,rect.width),Math.max(1,rect.height),false);camera.aspect=rect.width/Math.max(1,rect.height);camera.updateProjectionMatrix();const distance=sceneScale/(2*Math.tan(THREE.MathUtils.degToRad(25)))*Math.max(1,1/camera.aspect);camera.position.copy(center).add(new THREE.Vector3(0,.05,1).normalize().multiplyScalar(distance*.9));controls.target.copy(center);controls.update();}
 new ResizeObserver(()=>{const r=$('stage').getBoundingClientRect();renderer.setSize(Math.max(1,r.width),Math.max(1,r.height),false);camera.aspect=r.width/Math.max(1,r.height);camera.updateProjectionMatrix();adjustCamera().catch(error=>log.error(error));}).observe($('stage'));
 $('tools-toggle').onclick=()=>setTools(document.body.dataset.tools!=='open');
 function modeUi(){document.body.dataset.running=String(running);document.body.dataset.mode=mode;$('mode-model').setAttribute('aria-pressed',String(mode==='model'));$('mode-camera').setAttribute('aria-pressed',String(mode==='camera'));controls.enabled=mode==='model';if(base)base.material=mode==='model'?solidMaterial:depthMaterial;$('camera-toggle').textContent=t(running?'trkStop':'trkStart');$('mark-drift').disabled=!running;$('mark-loss').disabled=!running;}
 async function loadModel(id){const model=manifest.models.find(m=>m.id===id),token=++modelToken,start=performance.now();$('model-size').disabled=true;try{let geometry=geometryCache.get(id),cached=!!geometry;if(!geometry){const url=new URL(model.url,assetBase).href,response=await fetch(url);if(!response.ok)throw new Error(t('trkLoadError'));const bytes=await response.arrayBuffer(),loader=new GLTFLoader().setMeshoptDecoder(MeshoptDecoder),gltf=await loader.parseAsync(bytes,'');gltf.scene.updateMatrixWorld(true);const meshes=[];gltf.scene.traverse(o=>{if(o.isMesh)meshes.push(o);});if(meshes.length!==1)throw new Error(t('trkDataError'));const mesh=meshes[0],source=mesh.geometry.attributes.position,p=new Float32Array(source.count*3),point=new THREE.Vector3();for(let i=0;i<source.count;i++){point.fromBufferAttribute(source,i).applyMatrix4(mesh.matrixWorld);point.toArray(p,i*3);}geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(p,3));geometry.setIndex(mesh.geometry.index.clone());geometry.computeVertexNormals();geometry.computeBoundingSphere();geometryCache.set(id,geometry);for(const m of meshes){m.geometry.dispose();m.material.dispose();}}if(token!==modelToken)return;
   if(base)scene.remove(base);base=new THREE.Mesh(geometry,mode==='model'?solidMaterial:depthMaterial);base.renderOrder=0;scene.add(base);current=model;lastModelFetch={model:id,ms:performance.now()-start,geometryCache:cached};log.variant(model,trackingMode);log.event('model_loaded',lastModelFetch);$('model-info').textContent=`${(model.bytes/1000000).toFixed(2)} MB · ${model.triangles.toLocaleString()} ${t('trkFaces')}`;$('model-size').value=id;
  }catch(error){log.error(error);status('trkLoadError');if(current)$('model-size').value=current.id;}finally{if(token===modelToken)$('model-size').disabled=false;}}
 function stop(reason='trkStopped'){if(log.active)log.active.previewDiagnostics=previewDiagnostics();generation++;lastPreviewFrame=null;preview.width=preview.width;sensors.stop();frameClock=null;lastInputFrame=null;lastInputSensor=null;if(videoCallback!==null&&video.cancelVideoFrameCallback)video.cancelVideoFrameCallback(videoCallback);videoCallback=null;running=false;ready=false;busy=false;pose=null;controls.enabled=mode==='model';worker?.terminate();worker=null;if(workerUrl)URL.revokeObjectURL(workerUrl);workerUrl=null;stream?.getTracks().forEach(track=>track.stop());stream=null;video.pause();video.srcObject=null;log.end();status(reason);$('camera-toggle').disabled=false;$('camera-device').disabled=false;modeUi();}
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
 async function start(){if(running){stop();return;}if(!navigator.mediaDevices?.getUserMedia){status('trkSecure');return;}const token=++generation;mode='camera';setTools(false);modeUi();$('camera-toggle').disabled=true;$('camera-device').disabled=true;status('trkPermission');log.begin(current,trackingMode);
  try{const opened=await openCamera(token);if(!opened)return;stream=opened;log.stream(stream.getVideoTracks()[0].getSettings());log.event('render_config',{pixelRatio:renderer.getPixelRatio(),antialias:renderer.getContext().getContextAttributes().antialias});stream.getVideoTracks()[0].addEventListener('ended',()=>{if(token===generation&&running)stop('trkInterrupted');});if(token!==generation)return;const track=stream.getVideoTracks()[0];for(const kind of ['mute','unmute'])track.addEventListener(kind,()=>{if(token===generation)log.event('camera_'+kind,{muted:track.muted});});running=true;sensors.start();errors=0;lastSent=0;status('trkRuntime');modeUi();$('camera-toggle').disabled=false;$('camera-device').disabled=false;
   if(video.requestVideoFrameCallback){const count=(now,metadata)=>{if(!running||token!==generation)return;videoFrames++;frameClock={serial:(frameClock?.serial??0)+1,at:Number.isFinite(metadata.presentationTime)&&Math.abs(now-metadata.presentationTime)<1000?metadata.presentationTime:now,mediaTime:metadata.mediaTime};videoCallback=video.requestVideoFrameCallback(count);};videoCallback=video.requestVideoFrameCallback(count);}
   workerUrl=URL.createObjectURL(new Blob([`(${cameraWorkerMain.toString()})()`],{type:'text/javascript'}));worker=new Worker(workerUrl);worker.onmessage=({data})=>{if(token!==generation)return;if(data.type==='ready'){ready=true;log.ready();status('trkSearching');return;}busy=false;if(data.type==='error'){log.error(data.error);pose=null;if(!ready||++errors>=3)stop('trkRuntimeError');return;}if(data.type==='pose'){if(data.epoch!==trackingEpoch)return;fpsProcessed++;errors=0;pose=data.pose;poseAt=lastSent;const latency=performance.now()-lastSent;log.frame({pose,mode:data.mode,latency,processingMs:data.processingMs,sceneScale,motionAttempted:data.motionAttempted,motionSeeded:data.motionSeeded,diagnostics:data.diagnostics});status(pose?'trkTracking':'trkSearching');$('latency').textContent=pose?`${Math.round(latency)} ms`:'—';}};
   worker.onerror=e=>{log.error(e.message);stop('trkRuntimeError');};worker.postMessage({type:'init',map:common.camera,runtimeUrl:new URL('../redpoint/vendor/opencv-4.10.0.js',location.href).href});
  }catch(error){if(token!==generation)return;log.error(error);stop(error.name==='NotAllowedError'?'trkDenied':error.name==='CameraOrientationError'?'trkCameraFormat':'trkCameraError');}
 }
 function setView(p){const R=p.R,v=p.t;view.matrixWorldInverse.set(R[0],R[1],R[2],v[0],-R[3],-R[4],-R[5],-v[1],-R[6],-R[7],-R[8],-v[2],0,0,0,1);view.matrixWorld.copy(view.matrixWorldInverse).invert();const n=.005,f=100;view.projectionMatrix.set(2*p.focal/p.width,0,0,0,0,2*p.focal/p.height,0,0,0,0,-(f+n)/(f-n),-2*f*n/(f-n),0,0,-1,0);view.projectionMatrixInverse.copy(view.projectionMatrix).invert();}
 let fpsAt=performance.now(),fpsFrames=0,fpsProcessed=0;
 function tick(now){requestAnimationFrame(tick);drawPreview();const dt=Math.min(1000,now-lastTick);lastTick=now;const r=$('stage').getBoundingClientRect(),fresh=!!pose&&now-poseAt<=650;renderer.setViewport(0,0,r.width,r.height);renderer.clear();if(document.body.dataset.located!==String(fresh))document.body.dataset.located=String(fresh);let rendered=false;
  if(mode==='model'){controls.update();renderer.render(scene,camera);rendered=true;}else if(fresh){setView(pose);const v=cameraViewport(r.width,r.height,pose.width,pose.height);renderer.setViewport(v.x,v.y,v.width,v.height);renderer.render(scene,view);rendered=true;}
  if(sensors.tick(now,{mode:trackingMode,running,frameAt:frameClock?.at}))log.data.motion=sensors.report();
  if(running){log.tick({dt,rendered,visible:fresh,videoFrames,drawCalls:rendered?renderer.info.render.calls:0,triangles:rendered?renderer.info.render.triangles:0});videoFrames=0;if(ready&&!busy&&video.readyState>=2&&now-lastSent>100){const scale=640/Math.max(video.videoWidth,video.videoHeight),w=Math.round(video.videoWidth*scale),h=Math.round(video.videoHeight*scale);const mediaTime=frameClock?`frame:${frameClock.serial}`:`time:${video.currentTime}`;if(w&&h&&mediaTime!==lastInputFrame){const frameAt=frameClock?.at??now,inputSensor=sensors.at(frameAt),delta=trackingMode==='rotation'&&stream?.getVideoTracks()[0].getSettings().facingMode!=='user'?rotationBetween(lastInputSensor,inputSensor):null;lastInputSensor=inputSensor;lastInputFrame=mediaTime;capture.width=w;capture.height=h;ctx.drawImage(video,0,0,w,h);const image=ctx.getImageData(0,0,w,h);busy=true;lastSent=now;worker.postMessage({type:'frame',image,frameId:++frames,epoch:trackingEpoch,rotationDelta:delta?.matrix??null},[image.data.buffer]);}}}
  if(rendered)fpsFrames++;if(now-fpsAt>=1000){$('fps').textContent=`${Math.round(fpsFrames*1000/(now-fpsAt))} FPS`;$('hz').textContent=mode==='camera'?`${(fpsProcessed*1000/(now-fpsAt)).toFixed(1)} Hz`:'—';fpsAt=now;fpsFrames=0;fpsProcessed=0;}
 }
 $('mode-model').onclick=()=>{stop();mode='model';modeUi();};$('mode-camera').onclick=()=>{if(mode==='camera')return;mode='camera';modeUi();start();};$('camera-toggle').onclick=()=>{mode='camera';modeUi();start();};$('model-size').onchange=()=>loadModel($('model-size').value);
 for(const [id,mark] of [['mark-drift','drift'],['mark-loss','missing_outline']])$(id).onclick=()=>{log.mark(mark,{previewDiagnostics:previewDiagnostics()});$('notice').textContent=t('trkMarked');};
 $('motion-mode').onclick=async()=>{const button=$('motion-mode');button.disabled=true;try{if(trackingMode==='vision'){if(sensors.permission!=='granted'&&!await sensors.request()){log.event('motion_permission',{state:sensors.permission});$('notice').textContent=t('trkMotionUnavailable');return;}if(running)sensors.start();trackingMode='rotation';}else trackingMode='vision';button.textContent=t(trackingMode==='rotation'?'trkRotation':'trkVision');log.event('tracking_mode',{mode:trackingMode});if(running){log.variant(current,trackingMode);trackingEpoch++;lastInputSensor=null;pose=null;worker?.postMessage({type:'reset'});}}finally{button.disabled=false;}};
 $('camera-device').onchange=()=>{selectedCamera=$('camera-device').value;if(running){stop();start();}};
 $('copy-log').onclick=async()=>{log.data.motion=sensors.report();log.data.previewDiagnostics=previewDiagnostics();log.data.display={fit:'cover',previewRenderer:'canvas-2d',viewport:[$('stage').clientWidth,$('stage').clientHeight],video:[video.videoWidth,video.videoHeight],imageViewport:video.videoWidth?cameraViewport($('stage').clientWidth,$('stage').clientHeight,video.videoWidth,video.videoHeight):null,toolsOpen:document.body.dataset.tools==='open',renderPixelRatio:renderer.getPixelRatio()};log.data.resources=performance.getEntriesByType('resource').filter(x=>{const p=new URL(x.name).pathname;return p.startsWith('/3d/')||p.includes('opencv-4.10.0.js');}).map(x=>({asset:new URL(x.name).pathname.split('/').at(-1),durationMs:Math.round(x.duration),transferBytes:x.transferSize,encodedBytes:x.encodedBodySize,decodedBytes:x.decodedBodySize}));log.data.rendererMemory={...renderer.info.memory};const text=log.text();log.persist();try{await navigator.clipboard.writeText(text);$('notice').textContent=t('trkCopied');}catch{$('log-text').value=text;$('log-dialog').showModal();$('log-text').select();}};
 $('close-log').onclick=()=>$('log-dialog').close();$('download-log').onclick=()=>{const url=URL.createObjectURL(new Blob([log.text()],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='climbio-3d-tracking.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
 window.addEventListener('error',e=>log.error(e.message));window.addEventListener('unhandledrejection',e=>log.error(e.reason));window.addEventListener('pagehide',()=>{stop();log.persist();});document.addEventListener('visibilitychange',()=>{if(document.hidden&&running)stop();});
 await loadModel('balanced');fit();modeUi();for(const id of ['mode-model','mode-camera','camera-toggle'])$(id).disabled=!current;status('trkReady');document.body.dataset.ready='true';requestAnimationFrame(tick);
 window.trackingTest={get state(){return {mode,running,ready,trackingMode,motionPermission:sensors.permission,located:!!pose&&performance.now()-poseAt<=650,pose:pose?structuredClone(pose):null,model:current,frames,load:lastModelFetch,display:{fit:'cover',previewRenderer:'canvas-2d',width:$('stage').clientWidth,height:$('stage').clientHeight,imageViewport:video.videoWidth?cameraViewport($('stage').clientWidth,$('stage').clientHeight,video.videoWidth,video.videoHeight):null,toolsOpen:document.body.dataset.tools==='open'},triangles:renderer.info.render.triangles,drawCalls:renderer.info.render.calls};},report:()=>log.report(),project:xyz=>pose?new THREE.Vector3(...xyz).project(view).toArray():null};
}
main().catch(error=>{setTools(true);$('tools-toggle').onclick=()=>setTools(document.body.dataset.tools!=='open');document.getElementById('status').textContent=t('trkStartupError');console.error(error);const text=JSON.stringify({schema:'climbio-tracking-log/1',startupError:String(error.message),userAgent:navigator.userAgent,at:new Date().toISOString()});$('copy-log').onclick=async()=>{try{await navigator.clipboard.writeText(text);$('notice').textContent=t('trkCopied');}catch{$('log-text').value=text;$('log-dialog').showModal();$('log-text').select();}};$('close-log').onclick=()=>$('log-dialog').close();});
