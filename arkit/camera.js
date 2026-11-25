// ArKit 的相機工具：選主鏡頭、cover 視埠、直／橫寬高反過來的處理、等第一個影格（3D 追蹤頁與 2D AR 看線共用）
// 只用明確的主鏡頭名稱選取；不依裝置順序猜測倍率。
export function mainCamera(devices){
 const main=/^(back camera|rear camera|後置相機|后置相机|后置摄像头|背面カメラ|후면 카메라|rückkamera|caméra arrière|cámara trasera)$/i;
 return devices.find(d=>d.kind==='videoinput'&&main.test(d.label.trim()));
}
export function cameraViewport(width,height,frameWidth,frameHeight){
 const scale=Math.max(width/frameWidth,height/frameHeight);
 return {x:(width-frameWidth*scale)/2,y:(height-frameHeight*scale)/2,width:frameWidth*scale,height:frameHeight*scale,visibleWidthFraction:Math.min(1,width/(frameWidth*scale)),visibleHeightFraction:Math.min(1,height/(frameHeight*scale))};
}

export function cameraConstraints(width,height){
 const aspect=width/height;
 return {width:{ideal:Math.round(aspect>=1?1280:1280*aspect)},height:{ideal:Math.round(aspect>=1?1280/aspect:1280)},aspectRatio:{ideal:aspect},resizeMode:{ideal:'none'}};
}

// 判斷真正影格是否把請求的寬高反過來；不能用首幀前的 getSettings 判斷。
export function reversedCameraFrame(constraints,width,height){
 const requested=constraints.aspectRatio.ideal,actual=width/height;
 return (requested>1)!==(actual>1)&&Math.abs(Math.log(requested*actual))<.04;
}
export function reverseCameraConstraints(constraints){
 return {...constraints,width:constraints.height,height:constraints.width,aspectRatio:{ideal:1/constraints.aspectRatio.ideal}};
}
export function firstCameraFrame(video,timeoutMs=5000){
 return new Promise((resolve,reject)=>{
  let callback=null;
  const cleanup=()=>{clearTimeout(timer);video.removeEventListener('loadeddata',loaded);if(callback!==null)video.cancelVideoFrameCallback?.(callback);};
  // 第一個影格回呼時 video 可能還沒 readyState≥2：再等下一個影格，不然會一直等到逾時
  const loaded=()=>{if(video.readyState<2||!video.videoWidth||!video.videoHeight){if(video.requestVideoFrameCallback)callback=video.requestVideoFrameCallback(loaded);return;}cleanup();resolve({width:video.videoWidth,height:video.videoHeight});};
  const timer=setTimeout(()=>{cleanup();reject(new Error('相機沒有提供影格'));},timeoutMs);
  if(video.requestVideoFrameCallback)callback=video.requestVideoFrameCallback(loaded);
  else{video.addEventListener('loadeddata',loaded);loaded();}
 });
}

// 僅輸出黑邊診斷摘要；暗場也可能有邊界，不能用這個結果自動裁切影像。
export function frameContentSummary(image){
 const {width:w,height:h,data}=image,rows=new Uint32Array(h),cols=new Uint32Array(w);let bright=0;
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=(y*w+x)*4;if(Math.max(data[i],data[i+1],data[i+2])>10){rows[y]++;cols[x]++;bright++;}}
 const xs=Array.from(cols).flatMap((n,i)=>n>h*.08?[i]:[]),ys=Array.from(rows).flatMap((n,i)=>n>w*.08?[i]:[]);
 if(!xs.length||!ys.length)return {brightFraction:bright/(w*h),bounds:null,suspectedInset:false};
 const x=xs[0]/w,y=ys[0]/h,r=(xs.at(-1)+1)/w,b=(ys.at(-1)+1)/h,iw=r-x,ih=b-y;
 return {brightFraction:Math.round(bright/(w*h)*1000)/1000,bounds:[x,y,iw,ih],suspectedInset:x>.1&&y>.1&&1-r>.1&&1-b>.1&&Math.abs(x-(1-r))<.04&&Math.abs(y-(1-b))<.04&&Math.abs(iw-ih)<.04};
}
