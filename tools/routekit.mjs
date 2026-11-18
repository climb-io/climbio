// Node 測試用：跟瀏覽器一樣的全域 RouteKit（給用 vm 跑 js/ 片段的測試放進 context）
import { createRequire } from 'node:module';
export const RouteKit = createRequire(import.meta.url)('../routekit/index.js');
