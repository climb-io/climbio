const rad=Math.PI/180;
const mul=(a,b)=>Array.from({length:9},(_,i)=>[0,1,2].reduce((s,k)=>s+a[Math.floor(i/3)*3+k]*b[k*3+i%3],0));
const transpose=a=>[a[0],a[3],a[6],a[1],a[4],a[7],a[2],a[5],a[8]];
// W3C 裝置姿態為 Z-X-Y；轉成後鏡頭的右、下、前座標，不輸出絕對朝向。
export function cameraRotation(alpha,beta,gamma,screenAngle=0){
 const a=alpha*rad,b=beta*rad,g=gamma*rad,s=-screenAngle*rad;
 return mul(mul(mul([Math.cos(a),-Math.sin(a),0,Math.sin(a),Math.cos(a),0,0,0,1],[1,0,0,0,Math.cos(b),-Math.sin(b),0,Math.sin(b),Math.cos(b)]),[Math.cos(g),0,Math.sin(g),0,1,0,-Math.sin(g),0,Math.cos(g)]),mul([Math.cos(s),-Math.sin(s),0,Math.sin(s),Math.cos(s),0,0,0,1],[1,0,0,0,-1,0,0,0,-1]));
}
export function rotationBetween(previous,current){
 if(!previous||!current||current.at<=previous.at||current.at-previous.at>250||previous.screen!==current.screen)return null;
 const matrix=mul(transpose(current.matrix),previous.matrix),degrees=Math.acos(Math.max(-1,Math.min(1,(matrix[0]+matrix[4]+matrix[8]-1)/2)))/rad;
 return degrees<=20?{matrix,degrees}:null;
}
export class MotionSensors{
 constructor({host=window,origin=0,now=()=>performance.now()}={}){this.host=host;this.now=now;this.origin=origin;this.permission='not_requested';this.attached=false;this.history=[];this.orientationCount=0;this.motionCount=0;this.samples=[];this.lastSample=0;this.lastCounts=[0,0];this.rate=null;this.acceleration=null;this.latestMotionAt=0;
  this.orientation=e=>{if(![e.alpha,e.beta,e.gamma].every(Number.isFinite))return;const now=this.now(),at=Number.isFinite(e.timeStamp)&&Math.abs(e.timeStamp-now)<1000?e.timeStamp:now,screen=this.host.screen?.orientation?.angle??this.host.orientation??0;this.history.push({at,screen,matrix:cameraRotation(e.alpha,e.beta,e.gamma,screen)});if(this.history.length>180)this.history.shift();this.orientationCount++;};
  this.motion=e=>{const r=e.rotationRate,a=e.acceleration;this.rate=r&&[r.alpha,r.beta,r.gamma].every(Number.isFinite)?Math.hypot(r.alpha,r.beta,r.gamma):null;this.acceleration=a&&[a.x,a.y,a.z].every(Number.isFinite)?Math.hypot(a.x,a.y,a.z):null;this.motionCount++;this.latestMotionAt=this.now();};
 }
 async request(){
  const orientation=this.host.DeviceOrientationEvent,motion=this.host.DeviceMotionEvent;
  if(!orientation){this.permission='unsupported';return false;}
  try{const requests=[orientation,motion].filter(x=>typeof x?.requestPermission==='function').map(x=>x.requestPermission());const results=await Promise.all(requests);this.permission=results.every(x=>x==='granted')?'granted':'denied';}catch{this.permission='denied';}
  return this.permission==='granted';
 }
 start(){if(this.permission!=='granted'||this.attached)return;this.host.addEventListener('deviceorientation',this.orientation);this.host.addEventListener('devicemotion',this.motion);this.attached=true;this.history=[];this.lastSample=this.now();this.lastCounts=[this.orientationCount,this.motionCount];}
 stop(){this.host.removeEventListener('deviceorientation',this.orientation);this.host.removeEventListener('devicemotion',this.motion);this.attached=false;this.history=[];}
 at(time){for(let i=this.history.length-1;i>=0;i--){const s=this.history[i];if(s.at<=time)return time-s.at<=100?s:null;}return null;}
 tick(now,{mode,running,frameAt}){if(!running||now-this.lastSample<1000)return;const dt=this.lastSample?now-this.lastSample:1000;this.lastSample=now;const current=[this.orientationCount,this.motionCount],recent=now-this.latestMotionAt<250;this.samples.push({t_s:Math.round((now-this.origin)/10)/100,mode,orientationHz:Math.round((current[0]-this.lastCounts[0])*1000/dt),motionHz:Math.round((current[1]-this.lastCounts[1])*1000/dt),angularSpeedDegS:recent?this.rate:null,accelerationMS2:recent?this.acceleration:null,videoAgeMs:frameAt?Math.round(now-frameAt):null});this.lastCounts=current;if(this.samples.length>240)this.samples.shift();return true;}
 report(){return {permission:this.permission,orientationEvents:this.orientationCount,motionEvents:this.motionCount,samples:this.samples,containsAbsoluteOrientation:false};}
}
