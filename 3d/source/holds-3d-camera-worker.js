// 此函式在獨立 Worker 執行；不引用模組外變數，避免影像處理阻塞介面。
// 支援單一岩壁追蹤與多岩壁場域自動辨識（Coarse-to-Fine ORB + PnP RANSAC + LK 光流追蹤）。
export function cameraWorkerMain(){
 const decode=(value,Type=Uint8Array)=>new Type(Uint8Array.from(atob(value),c=>c.charCodeAt(0)).buffer);
 let cv,refs=[],focalRatio=.8,previous=null,tracked=null,lastPose=null,lastSearch=-Infinity,diagnostics=null;
 const wallBanks=new Map();
 let activeWallId='mingde',trackedWallId='mingde',autoDetect=false;
 const COARSE_N=280;
 const median=a=>{const b=[...a].sort((x,y)=>x-y);return b[Math.floor(b.length/2)]??Infinity;};
 function disposeBank(bank){
  if(!bank)return;
  for(const r of bank.refs){r.mat?.delete();r.coarseMat?.delete();}
 }
 function buildBank(wallId,map){
  const fRatio=map?.focalRatio||.8;
  const list=(map?.references||[]).map(r=>{
   const rawDesc=decode(r.desc),cn=Math.min(COARSE_N,r.n);
   return {
    ...r,
    xyz:Array.from(decode(r.xyz,Float32Array)),
    mat:cv.matFromArray(r.n,32,cv.CV_8U,rawDesc),
    coarseMat:cn>0?cv.matFromArray(cn,32,cv.CV_8U,rawDesc.subarray(0,cn*32)):null
   };
  });
  return {wallId,focalRatio:fRatio,refs:list};
 }
 function features(gray){
  const orb=new cv.ORB(),none=new cv.Mat(),keys=new cv.KeyPointVector(),desc=new cv.Mat();orb.setMaxFeatures(1200);orb.setFastThreshold(12);
  try{
   orb.detectAndCompute(gray,none,keys,desc);
   const order=Array.from({length:keys.size()},(_,i)=>i).sort((a,b)=>keys.get(b).response-keys.get(a).response),xy=[],bytes=new Uint8Array(order.length*32);
   for(let j=0;j<order.length;j++){const i=order[j],p=keys.get(i).pt;xy.push(p.x,p.y);bytes.set(desc.data.subarray(i*32,i*32+32),j*32);}
   const cn=Math.min(COARSE_N,order.length);
   return {
    xy,
    bytes,
    desc:cv.matFromArray(order.length,32,cv.CV_8U,bytes),
    coarseDesc:cn>0?cv.matFromArray(cn,32,cv.CV_8U,bytes.subarray(0,cn*32)):null
   };
  }finally{for(const x of [orb,none,keys,desc])x.delete();}
 }
 function buildRawBank(wallId,fRatio,views){
  const list=[];
  for(const v of (views||[])){
   if(!v?.image||!v?.depthRgba||!v?.matrixWorld)continue;
   const src=cv.matFromImageData(v.image),gray=new cv.Mat();cv.cvtColor(src,gray,cv.COLOR_RGBA2GRAY);src.delete();
   const q=features(gray);gray.delete();
   try{
    const dw=v.width,dh=v.height,m=v.matrixWorld,tanHalf=Math.tan((v.fov||50)*Math.PI/360),aspect=dw/dh;
    const keptXyz=[],keptIdx=[];
    for(let i=0;i<q.desc.rows;i++){
     const u=q.xy[i*2],py=q.xy[i*2+1];
     const ix=Math.min(dw-1,Math.max(0,Math.floor(u))),iy=Math.min(dh-1,Math.max(0,dh-1-Math.floor(py)));
     const pIdx=(iy*dw+ix)*4;
     if(v.depthRgba[pIdx+3]<200)continue;
     const tNorm=(v.depthRgba[pIdx]*65536+v.depthRgba[pIdx+1]*256+v.depthRgba[pIdx+2])/16777215;
     const posZ=v.near+tNorm*(v.far-v.near);
     const ndcX=((u+.5)/dw)*2-1,ndcY=1-((py+.5)/dh)*2;
     const camX=ndcX*posZ*tanHalf*aspect,camY=ndcY*posZ*tanHalf,camZ=-posZ;
     keptXyz.push(
      m[0]*camX+m[4]*camY+m[8]*camZ+m[12],
      m[1]*camX+m[5]*camY+m[9]*camZ+m[13],
      m[2]*camX+m[6]*camY+m[10]*camZ+m[14]
     );
     keptIdx.push(i);
    }
    if(keptIdx.length<16)continue;
    const rawDesc=new Uint8Array(keptIdx.length*32);
    for(let j=0;j<keptIdx.length;j++)rawDesc.set(q.bytes.subarray(keptIdx[j]*32,keptIdx[j]*32+32),j*32);
    const cn=Math.min(COARSE_N,keptIdx.length);
    list.push({
     n:keptIdx.length,
     xyz:keptXyz,
     mat:cv.matFromArray(keptIdx.length,32,cv.CV_8U,rawDesc),
     coarseMat:cn>0?cv.matFromArray(cn,32,cv.CV_8U,rawDesc.subarray(0,cn*32)):null
    });
   }finally{q.desc.delete();q.coarseDesc?.delete();}
  }
  return list.length?{wallId,focalRatio:fRatio||.95,refs:list}:null;
 }
 function selectActiveBank(wallId){
  const bank=wallBanks.get(wallId)||wallBanks.values().next().value;
  if(bank){
   activeWallId=bank.wallId;
   refs=bank.refs;
   focalRatio=bank.focalRatio;
  }
 }
 function coarseScoreBank(queryCoarse,bank){
  if(!queryCoarse||queryCoarse.rows<8)return {bestHits:0,totalHits:0};
  const bf=new cv.BFMatcher(cv.NORM_HAMMING,false);
  let bestHits=0,totalHits=0;
  try{
   for(const ref of bank.refs){
    if(!ref.coarseMat||ref.coarseMat.rows<8)continue;
    let hits=0;
    const pairs=new cv.DMatchVectorVector();
    try{
     bf.knnMatch(queryCoarse,ref.coarseMat,pairs,2);
     for(let j=0;j<pairs.size();j++){
      const neighbors=pairs.get(j);
      try{
       if(neighbors.size()<2)continue;
       const a=neighbors.get(0),b=neighbors.get(1);
       if(a.distance<b.distance*.75&&a.distance<=64)hits++;
      }finally{neighbors.delete();}
     }
    }finally{pairs.delete();}
    if(hits>bestHits)bestHits=hits;
    totalHits+=hits;
   }
  }finally{bf.delete();}
  return {bestHits,totalHits};
 }
 function match(query,bankRefs=refs){
  if(query.desc.rows<2)return {xyz:[],xy:[],refHits:[]};
  const bf=new cv.BFMatcher(cv.NORM_HAMMING,false),perRef=[],refHits=[];
  try{
   for(const [reference,ref] of bankRefs.entries()){
    if(!ref.mat||ref.mat.rows<2)continue;
    const matches=[];
    const pairs=new cv.DMatchVectorVector();
    try{
     bf.knnMatch(query.desc,ref.mat,pairs,2);
     for(let j=0;j<pairs.size();j++){
      const neighbors=pairs.get(j);
      try{
       if(neighbors.size()<2)continue;
       const a=neighbors.get(0),b=neighbors.get(1);
       if(a.distance>=b.distance*.72||a.distance>64)continue;
       matches.push({queryIdx:a.queryIdx,distance:a.distance,xyz:ref.xyz.slice(a.trainIdx*3,a.trainIdx*3+3)});
      }finally{neighbors.delete();}
     }
    }finally{pairs.delete();}
    refHits.push([reference,matches.length]);
    if(matches.length)perRef.push({reference,hits:matches.length,matches});
   }
  }finally{bf.delete();}
  perRef.sort((a,b)=>b.hits-a.hits);
  const topHits=perRef[0]?.hits||0;
  const minRefHits=perRef.length>4?Math.max(5,Math.floor(topHits*.22)):0;
  const activeRefs=perRef.filter((r,idx)=>idx<5&&r.hits>=minRefHits);
  const best=new Map();
  for(const r of (activeRefs.length?activeRefs:perRef.slice(0,3))){
   for(const m of r.matches){
    const old=best.get(m.queryIdx);
    if(!old||m.distance<old.distance)best.set(m.queryIdx,{distance:m.distance,xyz:m.xyz});
   }
  }
  const xyz=[],xy=[];for(const [i,p] of best){xyz.push(...p.xyz);xy.push(query.xy[i*2],query.xy[i*2+1]);}
  return {xyz,xy,refHits};
 }
 function project(R,t,xyz,f,w,h){const x=R[0]*xyz[0]+R[1]*xyz[1]+R[2]*xyz[2]+t[0],y=R[3]*xyz[0]+R[4]*xyz[1]+R[5]*xyz[2]+t[1],z=R[6]*xyz[0]+R[7]*xyz[1]+R[8]*xyz[2]+t[2];return [f*x/z+w/2,f*y/z+h/2,z];}
 function estimate(points,w,h,fixedFocal=null,bankFocalRatio=focalRatio){
  const count=points.xy.length/2;diagnostics.inputPoints=Math.max(diagnostics.inputPoints,count);if(count<16){diagnostics.reason=diagnostics.stage==='flow'?'insufficient_tracks':'insufficient_matches';return null;}
  const object=cv.matFromArray(count,3,cv.CV_64F,points.xyz),image=cv.matFromArray(count,2,cv.CV_64F,points.xy),dist=cv.Mat.zeros(5,1,cv.CV_64F),candidates=[];
  function solve(f){
   const K=cv.matFromArray(3,3,cv.CV_64F,[f,0,w/2,0,f,h/2,0,0,1]),rv=new cv.Mat(),tv=new cv.Mat(),ii=new cv.Mat(),rotation=new cv.Mat();
   try{diagnostics.pnpAttempts++;const solved=cv.solvePnPRansac(object,image,K,dist,rv,tv,false,180,4,.995,ii,cv.SOLVEPNP_EPNP);diagnostics.maxInliers=Math.max(diagnostics.maxInliers,ii.rows);if(!solved||ii.rows<16){diagnostics.pnpRejected++;return;}
    const ids=Array.from(ii.data32S),xyz=ids.flatMap(i=>points.xyz.slice(i*3,i*3+3)),xy=ids.flatMap(i=>points.xy.slice(i*2,i*2+2)),a=cv.matFromArray(ids.length,3,cv.CV_64F,xyz),b=cv.matFromArray(ids.length,2,cv.CV_64F,xy);
    try{cv.solvePnP(a,b,K,dist,rv,tv,true,cv.SOLVEPNP_ITERATIVE);}finally{a.delete();b.delete();}
    cv.Rodrigues(rv,rotation);const R=Array.from(rotation.data64F),t=Array.from(tv.data64F),errors=[],xs=[],ys=[];let positive=0;
    for(let i=0;i<ids.length;i++){const p=project(R,t,xyz.slice(i*3,i*3+3),f,w,h);errors.push(Math.hypot(p[0]-xy[i*2],p[1]-xy[i*2+1]));if(p[2]>0)positive++;xs.push(xy[i*2]);ys.push(xy[i*2+1]);}
    const coverage=(Math.max(...xs)-Math.min(...xs))*(Math.max(...ys)-Math.min(...ys))/(w*h),error=median(errors);if(positive/ids.length<.98){diagnostics.behindRejected++;return;}if(coverage<.025){diagnostics.coverageRejected++;return;}if(error>3.5){diagnostics.errorRejected++;return;}
    candidates.push({R,t,focal:f,width:w,height:h,inliers:ids.length,medianError:error,coverage,xyz,xy,score:error+(1-ids.length/count)*2});
   }finally{for(const x of [K,rv,tv,ii,rotation])x.delete();}
  }
  try{const size=Math.max(w,h);for(const f of fixedFocal?[fixedFocal]:[...new Set([bankFocalRatio,.6,.75,.9,1.05,1.2])].map(r=>r*size))solve(f);if(!candidates.length)return null;
   candidates.sort((a,b)=>a.score-b.score);if(!fixedFocal){const center=candidates[0].focal;for(const ratio of [.94,.97,1.03,1.06])solve(center*ratio);candidates.sort((a,b)=>a.score-b.score);}return candidates[0];
  }finally{object.delete();image.delete();dist.delete();}
 }
 function flow(gray,delta=null){
  const n=tracked.xy.length/2,a=cv.matFromArray(n,1,cv.CV_32FC2,tracked.xy),b=delta?cv.matFromArray(n,1,cv.CV_32FC2,tracked.xy):new cv.Mat(),status=new cv.Mat(),error=new cv.Mat(),back=new cv.Mat(),backStatus=new cv.Mat(),backError=new cv.Mat();
  try{if(delta){const f=lastPose.focal,w=gray.cols,h=gray.rows;for(let i=0;i<n;i++){const ray=[(tracked.xy[i*2]-w/2)/f,(tracked.xy[i*2+1]-h/2)/f,1],v=[0,1,2].map(j=>delta[j*3]*ray[0]+delta[j*3+1]*ray[1]+delta[j*3+2]);if(v[2]>.1){b.data32F[i*2]=f*v[0]/v[2]+w/2;b.data32F[i*2+1]=f*v[1]/v[2]+h/2;}}}const size=new cv.Size(21,21),criteria=new cv.TermCriteria(cv.TERM_CRITERIA_COUNT+cv.TERM_CRITERIA_EPS,20,.01);cv.calcOpticalFlowPyrLK(previous,gray,a,b,status,error,size,3,criteria,delta?4:0,.0001);cv.calcOpticalFlowPyrLK(gray,previous,b,back,backStatus,backError,size,3,criteria,0,.0001);const xyz=[],xy=[];
   for(let i=0;i<n;i++){const x=b.data32F[i*2],y=b.data32F[i*2+1];if(!status.data[i]||!backStatus.data[i]||Math.hypot(back.data32F[i*2]-tracked.xy[i*2],back.data32F[i*2+1]-tracked.xy[i*2+1])>1.5||x<4||y<4||x>gray.cols-4||y>gray.rows-4)continue;xy.push(x,y);xyz.push(...tracked.xyz.slice(i*3,i*3+3));}return {xyz,xy};
  }finally{for(const x of [a,b,status,error,back,backStatus,backError])x.delete();}
 }
 async function initialize(data){
  importScripts(data.runtimeUrl);for(let i=0;i<300&&!self.cv?.Mat;i++)await new Promise(r=>setTimeout(r,100));if(!self.cv?.Mat)throw new Error('影像辨識程式初始化逾時');cv=self.cv;
  for(const b of wallBanks.values())disposeBank(b);
  wallBanks.clear();
  if(Array.isArray(data.walls)){
   for(const w of data.walls){
    if(w?.wallId&&w?.map?.references)wallBanks.set(w.wallId,buildBank(w.wallId,w.map));
   }
  }
  if(data.map?.references){
   const wid=data.activeWallId||'mingde';
   if(!wallBanks.has(wid))wallBanks.set(wid,buildBank(wid,data.map));
  }
  autoDetect=!!data.autoDetect;
  activeWallId=data.activeWallId||'mingde';
  selectActiveBank(activeWallId);
  trackedWallId=activeWallId;
  self.postMessage({type:'ready'});
 }
 self.onmessage=async({data})=>{
  try{
   if(data.type==='init'){await initialize(data);return;}
   if(data.type==='set_wall'){
    autoDetect=!!data.autoDetect;
    if(data.wallId&&wallBanks.has(data.wallId)&&data.wallId!==activeWallId){
     selectActiveBank(data.wallId);
     tracked=null;lastPose=null;lastSearch=-Infinity;
    }
    return;
   }
   if(data.type==='add_wall'){
    if(data.wallId&&data.map?.references){
     disposeBank(wallBanks.get(data.wallId));
     wallBanks.set(data.wallId,buildBank(data.wallId,data.map));
     if(data.activate||data.wallId===activeWallId||!refs.length)selectActiveBank(data.wallId);
    }
    return;
   }
   if(data.type==='add_raw_wall'){
    if(data.wallId&&Array.isArray(data.views)){
     const bank=buildRawBank(data.wallId,data.focalRatio,data.views);
     if(bank){
      disposeBank(wallBanks.get(data.wallId));
      wallBanks.set(data.wallId,bank);
      if(data.activate||data.wallId===activeWallId||!refs.length)selectActiveBank(data.wallId);
      self.postMessage({type:'bank_ready',wallId:data.wallId,refs:bank.refs.length});
     }
    }
    return;
   }
   if(data.type==='reset'){tracked=null;lastPose=null;lastSearch=-Infinity;return;}
   if(data.type!=='frame')return;
   diagnostics={stage:'flow',reason:null,queryFeatures:null,matched3d:null,flowPoints:null,referenceHits:[],inputPoints:0,pnpAttempts:0,pnpRejected:0,maxInliers:0,coverageRejected:0,errorRejected:0,behindRejected:0,coverage:null};
   const start=performance.now(),src=cv.matFromImageData(data.image),gray=new cv.Mat();cv.cvtColor(src,gray,cv.COLOR_RGBA2GRAY);src.delete();let pose=null,mode='searching',motionAttempted=false,motionSeeded=false;
   try{
    if(tracked&&previous&&previous.cols===gray.cols&&previous.rows===gray.rows){
     const delta=Array.isArray(data.rotationDelta)&&data.rotationDelta.length===9&&data.rotationDelta.every(Number.isFinite)?data.rotationDelta:null;
     motionAttempted=!!delta;const points=flow(gray,delta);diagnostics.flowPoints=points.xy.length/2;
     pose=estimate(points,gray.cols,gray.rows,lastPose.focal,focalRatio);motionSeeded=!!delta&&!!pose;
     if(!pose&&delta)pose=estimate(flow(gray),gray.cols,gray.rows,lastPose.focal,focalRatio);
     if(pose)mode='tracking';
    }
    if(!pose&&performance.now()-lastSearch>650){
     lastSearch=performance.now();diagnostics.stage='search';diagnostics.reason=null;diagnostics.pnpAttempts=diagnostics.pnpRejected=diagnostics.maxInliers=diagnostics.coverageRejected=diagnostics.errorRejected=diagnostics.behindRejected=0;
     const query=features(gray);diagnostics.queryFeatures=query.desc.rows;
     try{
      if(query.desc.rows>=16&&refs.length){
       if(autoDetect&&wallBanks.size>1){
        const scored=[];
        for(const bank of wallBanks.values()){
         const sc=coarseScoreBank(query.coarseDesc,bank);
         scored.push({bank,bestHits:sc.bestHits,totalHits:sc.totalHits,isActive:bank.wallId===activeWallId});
        }
        scored.sort((a,b)=>(b.bestHits-a.bestHits)||(Number(b.isActive)-Number(a.isActive))||(b.totalHits-a.totalHits));
        const topBanks=scored.slice(0,2).filter(s=>s.bestHits>=6);
        if(!topBanks.length&&scored.length)topBanks.push(scored[0]);
        let bestCandidate=null,bestWallId=activeWallId,bestHits=[];
        for(const item of topBanks){
         const points=match(query,item.bank.refs);
         diagnostics.matched3d=Math.max(diagnostics.matched3d||0,points.xy.length/2);
         if(!bestHits.length)bestHits=points.refHits;
         const cand=estimate(points,gray.cols,gray.rows,null,item.bank.focalRatio);
         if(cand&&(!bestCandidate||cand.inliers>bestCandidate.inliers||(cand.inliers===bestCandidate.inliers&&cand.score<bestCandidate.score))){
          bestCandidate=cand;
          bestWallId=item.bank.wallId;
          bestHits=points.refHits;
          if(cand.inliers>=24)break;
         }
        }
        diagnostics.referenceHits=bestHits;
        if(bestCandidate){
         pose=bestCandidate;
         mode='localized';
         selectActiveBank(bestWallId);
         trackedWallId=bestWallId;
        }
       }else{
        const points=match(query,refs);
        diagnostics.referenceHits=points.refHits;
        diagnostics.matched3d=points.xy.length/2;
        pose=estimate(points,gray.cols,gray.rows,null,focalRatio);
        if(pose){mode='localized';trackedWallId=activeWallId;}
       }
      }
     }finally{query.desc.delete();query.coarseDesc?.delete();}
    }else if(!pose&&diagnostics.stage!=='search'){diagnostics.stage='cooldown';diagnostics.reason='search_cooldown';}
    diagnostics.referenceHits.sort((a,b)=>b[1]-a[1]);diagnostics.referenceHits=diagnostics.referenceHits.slice(0,3);if(pose){diagnostics.reason='pose';diagnostics.coverage=pose.coverage;}else if(diagnostics.stage==='search'&&diagnostics.queryFeatures<16)diagnostics.reason='insufficient_features';else if(!diagnostics.reason)diagnostics.reason='pnp_rejected';
    if(pose){const ids=Array.from({length:pose.xy.length/2},(_,i)=>i),used=new Set(),keep=[];for(const i of ids){const cell=`${Math.floor(pose.xy[i*2]/32)}:${Math.floor(pose.xy[i*2+1]/32)}`;if(!used.has(cell)){used.add(cell);keep.push(i);}}for(const i of ids){if(keep.length>=200)break;if(!keep.includes(i))keep.push(i);}tracked={xyz:keep.flatMap(i=>pose.xyz.slice(i*3,i*3+3)),xy:keep.flatMap(i=>pose.xy.slice(i*2,i*2+2))};lastPose=pose;delete pose.xyz;delete pose.xy;delete pose.score;}else{tracked=null;lastPose=null;}
    previous?.delete();previous=gray;self.postMessage({type:'pose',wallId:trackedWallId,pose,mode,diagnostics,motionAttempted,motionSeeded,frameId:data.frameId,epoch:data.epoch,processingMs:performance.now()-start});
   }catch(error){gray.delete();throw error;}
  }catch(error){self.postMessage({type:'error',error:typeof error==='number'?`影像辨識失敗（${error}）`:String(error.message||error)});}
 };
}
