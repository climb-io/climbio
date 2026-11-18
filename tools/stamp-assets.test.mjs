import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
test('部署打包同時替主 App 與 3D 頁面的資源加版本',()=>{
 const dir=mkdtempSync(join(tmpdir(),'climbio-stamp-'));
 try{mkdirSync(join(dir,'hold'));mkdirSync(join(dir,'3d'));writeFileSync(join(dir,'version.js'),"const CLIMBIO_VERSION = 'climbio-v123-hk1.9.0';");writeFileSync(join(dir,'hold/index.html'),'<script src="../js/main.js"></script>');writeFileSync(join(dir,'3d/index.html'),readFileSync(new URL('../3d/index.html',import.meta.url)));
  const result=spawnSync(process.execPath,[fileURLToPath(new URL('./stamp-assets.mjs',import.meta.url)),dir],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);assert.match(readFileSync(join(dir,'hold/index.html'),'utf8'),/main\.js\?v=v123-hk1\.9\.0/);const html=readFileSync(join(dir,'3d/index.html'),'utf8');assert.match(html,/app\.js\?v=v123-hk1\.9\.0/);assert.match(html,/style\.css\?v=v123-hk1\.9\.0/);assert.match(html,/boot\.js\?v=v123-hk1\.9\.0/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
