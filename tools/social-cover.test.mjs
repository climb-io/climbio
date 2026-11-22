import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const file = p => new URL(p, root);
const read = p => readFileSync(file(p), 'utf8');
const homes = ['index.html', ...['zh-cn', 'en', 'ja', 'ko', 'de', 'es', 'fr'].map(l => l + '/index.html')];
const official = 'https://climbio.app/social/climbio-home.jpg';

test('All eight homepages use the same 1200x630 social cover', () => {
  for (const path of homes) {
    const s = read(path);
    assert.ok(s.includes('<meta property="og:image" content="' + official + '">'), path);
    assert.ok(s.includes('<meta name="twitter:image" content="' + official + '">'), path);
    for (const value of [
      '<meta property="og:image:type" content="image/jpeg">',
      '<meta property="og:image:width" content="1200">',
      '<meta property="og:image:height" content="630">',
      '<meta name="twitter:card" content="summary_large_image">',
      '<meta property="og:image:alt" content="',
      '<meta name="twitter:image:alt" content="',
    ]) assert.ok(s.includes(value), path + ': ' + value);
  }
});

test('Social cover uses the existing real photo and official wordmark', () => {
  assert.ok(existsSync(file('demo/reel/crag-guidebook.webp')));
  assert.ok(existsSync(file('icons/brand/climbio-horizontal-dark.svg')));
  const source = read('tools/social-cover.py');
  assert.ok(source.includes('crag-guidebook.webp'));
  assert.ok(source.includes('climbio-horizontal-dark.svg'));
  assert.ok(read('build-site.sh').includes('python3 tools/social-cover.py dist'));
  if (existsSync(file('.github/workflows/deploy.yml'))) assert.ok(read('.github/workflows/deploy.yml').includes('CairoSVG'));   // 部署流程只在內部，公開版沒有
  assert.ok(read('tools/social-meta.mjs').includes("HOME_IMAGE = '/social/climbio-home.jpg'"));
  assert.ok(read('tools/social-meta.mjs').includes('summary_large_image'));
  assert.ok(read('build-site.sh').includes('https://$site.web.app/social/climbio-home.jpg'));
});
