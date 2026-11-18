// 測試依產品分組：改哪個產品就只跑它的測試（node tools/test-product.mjs <產品>、交付工具的 product 參數），不因別的產品的測試互卡。
// 每個測試檔（tools/*.test.mjs、functions/*.test.js、tests/e2e/*.spec.mjs）恰好屬於一組；新增測試時在這裡加進對應的組，
// tools/test-groups.test.mjs 會擋掉沒歸屬或重複歸屬的檔案。改共用層（shared、kits）時另外跑用到它的產品。
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const u = (names) => new RegExp(`^tools/(${names})\\.test\\.mjs$`);
const e = (names) => new RegExp(`^tests/e2e/(${names})\\.spec\\.mjs$`);

export const PRODUCTS = {
  hold: {
    label: '岩點貓（/hold/）：拍牆、岩點、定線、看線、分享、同步',
    unit: [u('retrace-auth|share-(commit|format)|linkfrom|gym|hold-fallback|lasso|despike|crop-suggest|sam-preload|public-wall')],
    e2e: [e('hold-interactions|legacy-wall|add-wall|nearby|back-overlay|contributions|edge-back|edit-leave|find-walls|gym|hold-edit|holdcat|journey|mobile|offline|overlap-pick|public-wall|pwa-lifecycle|rename|resume-spot|route-card|route-swipe|sam-preload|seq-tap|share-(link|local|preview|receive|route|simple)|signin-back|storage|tablet|tour|tour-tape')],
  },
  redpoint: {
    label: '紅點貓（/redpoint/）與收藏擴充功能：收岩場、Topo、世界、OpenClimbing',
    unit: [u('redpoint-.+|openclimbing.*|thecrag-.+|world-stacks|extension-.+|sourcekit')],
    e2e: [e('redpoint|redpoint-.+|nearby-redpoint')],
  },
  studio: {
    label: 'Climbio Studio（/studio/）：Crag、轉換路線書、發佈',
    unit: [u('author.*|studio-modes|dataset-publish')],
    e2e: [e('author|author-(publish|routes|topo)|wall-phone|phone-landing')],
  },
  kits: {
    label: '開源元件（format、routekit、topokit、mapkit 的資料格式、Viewer、Editor）',
    unit: [u('kit-packages|kit-pages|format|format-placement|route-.+|foot-label|sequence-label|topokit-render|wall-files')],
    e2e: [e('routekit|topokit|mapkit|topokit-demo|mapkit-demo|kit-external|holdscan-external')],
  },
  shared: {
    label: '共用層（appkit、站台設定、登入、品牌）與跨產品的入口、同步',
    unit: [u('appkit|appkit-share|appkit-idb|manual-backup|brand-.+|site|sign|auth')],
    e2e: [e('entry|sync|sync-hint|backend-none|environment|pc-landing|nickname')],
  },
  backend: {
    label: '後端：雲端函式與它的資料規則',
    unit: [/^functions\/[a-z0-9-]+\.test\.js$/],
    e2e: [],
  },
  tooling: {
    label: '開發工具：交付、部署、測試執行器、改名、版本',
    unit: [u('delivery|deploy-current|deploy-verified|e2e-runner|iphone|stamp-assets|rebrand|test-groups|public-boundary')],
    e2e: [e('boot-smoke')],
  },
  wall3d: {
    label: '3D 牆實驗（只在內部 dev，公開版不含）',
    unit: [u('tracking3d')],
    e2e: [],
  },
};

const list = (dir, re) => readdirSync(new URL(`../${dir}/`, import.meta.url)).filter(f => re.test(f)).map(f => `${dir}/${f}`).sort();
/** 目前所有測試檔：{ unit: [tools/…, functions/…], e2e: [tests/e2e/…] } */
export const allTests = () => ({
  unit: [...list('tools', /\.test\.mjs$/), ...list('functions', /\.test\.js$/)],
  e2e: list('tests/e2e', /\.spec\.mjs$/),
});

/** 哪些產品認領這個檔案（正常恰好一個） */
export const ownersOf = (file) => Object.entries(PRODUCTS).filter(([, p]) => [...p.unit, ...p.e2e].some(re => re.test(file))).map(([k]) => k);

/** 產品的測試檔：{ unit, e2e }（e2e 是檔名，給交付工具的 cases 與 e2e.py 用） */
export function filesOf(...products) {
  const all = allTests(), out = { unit: [], e2e: [] };
  for (const name of products) {
    const p = PRODUCTS[name];
    if (!p) throw new Error(`沒有這個產品：${name}（有：${Object.keys(PRODUCTS).join('、')}）`);
    out.unit.push(...all.unit.filter(f => p.unit.some(re => re.test(f))));
    out.e2e.push(...all.e2e.filter(f => p.e2e.some(re => re.test(f))).map(f => f.slice('tests/e2e/'.length)));
  }
  return { unit: [...new Set(out.unit)], e2e: [...new Set(out.e2e)] };
}
export { root };
