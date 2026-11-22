import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {PAGES} from './stamp-assets.mjs';
test('部署打包同時替主 App、3D 與 Studio 各頁的資源加版本',()=>{
 const dir=mkdtempSync(join(tmpdir(),'climbio-stamp-'));
 try{mkdirSync(join(dir,'hold'));mkdirSync(join(dir,'3d'));writeFileSync(join(dir,'version.js'),"const CLIMBIO_VERSION = 'climbio-v123-hk1.9.0';");writeFileSync(join(dir,'hold/index.html'),'<script src="../js/main.js"></script>');writeFileSync(join(dir,'3d/index.html'),readFileSync(new URL('../3d/index.html',import.meta.url)));
  for(const page of PAGES.filter(p=>p.startsWith('studio/'))){mkdirSync(dirname(join(dir,page)),{recursive:true});writeFileSync(join(dir,page),readFileSync(new URL('../'+page,import.meta.url)));}
  const result=spawnSync(process.execPath,[fileURLToPath(new URL('./stamp-assets.mjs',import.meta.url)),dir],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);assert.match(readFileSync(join(dir,'hold/index.html'),'utf8'),/main\.js\?v=v123-hk1\.9\.0/);const html=readFileSync(join(dir,'3d/index.html'),'utf8');assert.match(html,/app\.js\?v=v123-hk1\.9\.0/);assert.match(html,/style\.css\?v=v123-hk1\.9\.0/);assert.match(html,/boot\.js\?v=v123-hk1\.9\.0/);
  const crag=readFileSync(join(dir,'studio/crag/index.html'),'utf8');assert.match(crag,/type="module" src="app\.js\?v=v123-hk1\.9\.0"/);assert.match(crag,/shell\.css\?v=v123-hk1\.9\.0/);
  // 頁面有 meta CSP 時 Chrome 不預先掃描：程式、樣式的 preload 放在 <head> 最前面（CSP、第一支程式之前），模組用 modulepreload
  const head=crag.slice(0,crag.indexOf('Content-Security-Policy'));assert.match(head,/<link rel="modulepreload" href="app\.js\?v=v123-hk1\.9\.0">/);assert.match(head,/<link rel="preload" as="script" href="\.\.\/shell\.js\?v=v123-hk1\.9\.0">/);assert.match(head,/<link rel="preload" as="style" href="\.\.\/shell\.css\?v=v123-hk1\.9\.0">/);assert.ok(crag.indexOf('rel="preload"')<crag.indexOf('<script'),'preload 在第一支程式之前');
 }finally{rmSync(dir,{recursive:true,force:true});}
});
