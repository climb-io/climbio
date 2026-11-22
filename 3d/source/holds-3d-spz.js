// 解析 Niantic SPZ（v2／v3）解壓後的二進位點雲：輸出位置、線性顏色與 splat 半徑，供 3D 預覽與深度投影使用。
const SH_C0=0.28209479177387814;

export function parseSpzBuffer(raw,{maxPoints=600000,minAlpha=48}={}){
 if(!(raw instanceof Uint8Array))raw=new Uint8Array(raw);
 if(raw.byteLength<16)throw new Error('SPZ 檔頭過短');
 const view=new DataView(raw.buffer,raw.byteOffset,raw.byteLength);
 if(view.getUint32(0,true)!==0x5053474e)throw new Error('無效的 SPZ 格式');
 const version=view.getUint32(4,true);
 if(version!==2&&version!==3)throw new Error(`不支援的 SPZ 版本：${version}`);
 const numPoints=view.getUint32(8,true),frac=raw[13],invScale=1/(1<<frac);
 const posOff=16,alphaOff=posOff+numPoints*9,colorOff=alphaOff+numPoints,scaleOff=colorOff+numPoints*3;
 if(raw.byteLength<scaleOff+numPoints*3)throw new Error('SPZ 資料不完整');
 const step=Math.max(1,Math.ceil(numPoints/maxPoints));
 let kept=0;
 for(let i=0;i<numPoints;i+=step)if(raw[alphaOff+i]>=minAlpha)kept++;
 const positions=new Float32Array(kept*3),colors=new Float32Array(kept*3),sizes=new Float32Array(kept);
 let k=0;
 for(let i=0;i<numPoints;i+=step){
  if(raw[alphaOff+i]<minAlpha)continue;
  const p=posOff+i*9;
  for(let c=0;c<3;c++){
   let v=raw[p+c*3]|(raw[p+c*3+1]<<8)|(raw[p+c*3+2]<<16);
   if(v&0x800000)v|=0xff000000;
   positions[k*3+c]=v*invScale;
  }
  const co=colorOff+i*3;
  for(let c=0;c<3;c++){
   const srgb=Math.max(0,Math.min(1,0.5+SH_C0*((raw[co+c]/255-0.5)/0.15)));
   colors[k*3+c]=srgb*srgb;
  }
  const so=scaleOff+i*3;
  const avg=(Math.exp(raw[so]/16-10)+Math.exp(raw[so+1]/16-10)+Math.exp(raw[so+2]/16-10))/3;
  sizes[k]=Math.max(0.015,Math.min(0.25,avg*2.5));
  k++;
 }
 return {version,totalPoints:numPoints,count:kept,positions,colors,sizes};
}
