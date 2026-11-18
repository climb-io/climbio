// 雲端函式部署前（firebase.json 的 predeploy）：把要一起部署的檔案複製到函式資料夾（$RESOURCE_DIR）底下。
//   node tools/functions-predeploy.mjs <子資料夾> <檔案…>
// 用 Node 寫，不用 mkdir -p、cp：predeploy 在 Windows 交給 cmd 跑，那兩個指令不能用。
import { mkdirSync, copyFileSync } from 'node:fs';
import { basename, join } from 'node:path';

const [sub, ...files] = process.argv.slice(2);
if (!process.env.RESOURCE_DIR || !sub || !files.length) throw new Error('用法：RESOURCE_DIR=<函式資料夾> node tools/functions-predeploy.mjs <子資料夾> <檔案…>');
const dir = join(process.env.RESOURCE_DIR, sub);
mkdirSync(dir, { recursive: true });
for (const f of files) copyFileSync(f, join(dir, basename(f)));
