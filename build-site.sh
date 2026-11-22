#!/bin/sh
# 打包網站：把要公開的檔案複製到 dist/（網站根目錄 climbio.app/：家族首頁、各 App 的資料夾 hold/、studio/ 和共用的檔案）（排除清單在 .hostingignore），再用 firebase deploy --only hosting --project web 部署。
# 研究資料（data、datasets、runs、weights 是捷徑）一定不能放上去：打包完再檢查一次，有就失敗
# 參數是目標網站（climbio、climbio-dev，沒給就是正式版 climbio）：紅點貓收藏（瀏覽器擴充）的說明頁與下載檔供所有網站使用
set -e
cd "$(dirname "$0")"
site=${1:-climbio}
case "$site" in climbio|climbio-dev|climbio-eric) ;; *) echo "不認得的網站：$site（climbio、climbio-dev 或 climbio-eric）" >&2; exit 1 ;; esac
rm -rf dist
mkdir -p dist
# 只打包版控裡的檔案（工作目錄裡沒進版控的檔案，例如測試圖，不能放上去）；holdkit、holdscan 的雲端函式和只在雲端用的模型由 .hostingignore 排除。
# 用 git 比對排除清單、tar 複製（不用 rsync：Windows 的 Git Bash 沒有）；檔名有換行、引號等要跳脫的字元就停下來
all=$(mktemp)
skip=$(mktemp)
trap 'rm -f "$all" "$skip"' EXIT
git -c core.quotepath=off ls-files | LC_ALL=C sort > "$all"
git -c core.quotepath=off ls-files --cached --ignored --exclude-from=.hostingignore | LC_ALL=C sort > "$skip"
if grep -q '^"' "$all"; then echo "有檔名需要跳脫，打包不處理：$(grep '^"' "$all" | head -1)" >&2; exit 1; fi
LC_ALL=C comm -23 "$all" "$skip" | tar -cf - -T - | tar -xf - -C dist
# 測試站暫存的未公開資料夾（lab/hold-lab/preview/）只放測試站，正式站（climbio）打包時移除
if [ "$site" = "climbio" ]; then
  rm -rf dist/lab/hold-lab/preview
fi
# 紅點貓收藏：所有網站都提供說明頁和擴充 ZIP；只打包版控裡的 extension/。
ext_ver=$(sed -nE 's/.*"version": "([0-9.]+)".*/\1/p' extension/manifest.json | head -1)
[ -n "$ext_ver" ] || { echo "讀不到 extension/manifest.json 的 version" >&2; exit 1; }
for page in redpoint-collect en/redpoint-collect zh-cn/redpoint-collect ja/redpoint-collect ko/redpoint-collect fr/redpoint-collect es/redpoint-collect de/redpoint-collect; do
  mkdir -p "dist/$page"
  sed -E "s/v[0-9]+\.[0-9]+\.[0-9]+/v$ext_ver/g" "$page/index.html" > "dist/$page/index.html"
done
# 擴充 ZIP 必須包含八語 Chrome 名稱／說明與面板使用的翻譯。
for locale in zh_TW zh_CN en ja ko fr es de; do
  [ -f "extension/_locales/$locale/messages.json" ] || { echo "缺少 Chrome 語言檔：$locale" >&2; exit 1; }
done
[ -f extension/i18n.js ] || { echo "缺少擴充多語訊息：extension/i18n.js" >&2; exit 1; }
git archive --format=zip --prefix=redpoint-collect/ -o dist/redpoint-collect/redpoint-collect.zip HEAD:extension
# 測試站在打包階段產生有 DEV 標籤的獨立 App 圖示與安裝名稱；正式站不碰正式資產。
if [ "$site" != "climbio" ]; then
  python3 tools/dev-app-icons.py dist
fi
# 社群分享首頁橫幅：用已公開的真實岩場照片與官方 Logo 產生 1200×630 JPEG。
python3 tools/social-cover.py dist
[ -s dist/social/climbio-home.jpg ] || { echo "社群分享圖產生失敗" >&2; exit 1; }
# 測試站自己的網址被分享時，社群爬蟲也要拿到測試站的封面（正式 canonical 不變）。
if [ "$site" != "climbio" ]; then
  for f in dist/index.html dist/zh-cn/index.html dist/en/index.html dist/ja/index.html dist/ko/index.html dist/de/index.html dist/es/index.html dist/fr/index.html; do
    sed -i.bak "s@https://climbio.app/social/climbio-home.jpg@https://$site.web.app/social/climbio-home.jpg@g" "$f"
    rm -f "$f.bak"
  done
fi
# 部署的版本號加上 holdkit 版本：只換 holdkit 時版本號也會變，Service Worker 才會清掉舊的模型快取（模型檔名不帶版本）
hk=v$(sed -nE "s/.*VERSION = '([0-9.]+)'.*/\1/p" holdkit/holdkit.js | head -1)
[ "$hk" != v ] || { echo "讀不到 holdkit.js 的 VERSION" >&2; exit 1; }
sed -i.bak -E "s/(climbio-v[0-9]+)'/\1-hk${hk#v}'/" dist/version.js
sed -i.bak -E "s/(name=\"app-version\" content=\"climbio-v[0-9]+)/\1-hk${hk#v}/" dist/hold/index.html
rm -f dist/version.js.bak dist/hold/index.html.bak
grep -q "hk${hk#v}'" dist/version.js && grep -q "hk${hk#v}\"" dist/hold/index.html || { echo "版本號沒寫進 holdkit 版本" >&2; exit 1; }
# 頁面引用的本站程式、樣式表加版本後綴（?v=版本）：頁面永遠是最新的，資源依版本分開快取，Service Worker 才不會混到別版（見 appkit/sw.js）
node tools/stamp-assets.mjs dist
grep -q 'src="app.js?v=' dist/3d/index.html || { echo "3D 資源網址沒加版本後綴"; exit 1; }
grep -q 'src="../js/main.js?v=' dist/hold/index.html || { echo "資源網址沒加版本後綴" >&2; exit 1; }
for x in data datasets runs weights tools functions node_modules extension web/models holdkit/functions holdscan/functions; do
  if [ -e "dist/$x" ] || [ -L "dist/$x" ]; then echo "dist 裡不該有 $x" >&2; exit 1; fi
done
for f in dist/redpoint-collect/index.html dist/en/redpoint-collect/index.html dist/zh-cn/redpoint-collect/index.html dist/ja/redpoint-collect/index.html dist/ko/redpoint-collect/index.html dist/fr/redpoint-collect/index.html dist/es/redpoint-collect/index.html dist/de/redpoint-collect/index.html dist/redpoint-collect/redpoint-collect.zip; do
  [ -f "$f" ] || { echo "缺少紅點貓收藏檔案：$f" >&2; exit 1; }
done
if find dist -type l | grep -q .; then echo "dist 裡有捷徑（符號連結）" >&2; exit 1; fi
for f in holdkit/holdkit.js holdkit/samrefine.js holdkit/samworker.js holdkit/ort.js holdkit/models/mobilesam-decoder.onnx holdkit/models/mobilesam-encoder.onnx; do
  [ -f "dist/$f" ] || { echo "dist 裡少了 $f" >&2; exit 1; }
done
echo "dist 打包完成：$(du -sh dist | cut -f1)"
