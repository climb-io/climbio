// 戶外介面 token 的對比：文字 4.5:1、必要圖形 3:1（WCAG AA），讀 css/brand-tokens.css 的 outdoor 區塊
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../css/brand-tokens.css', import.meta.url), 'utf8');
const block = css.match(/\[data-climbio-theme="outdoor"\]\s*\{([^}]*)\}/)[1];
const token = (name) => block.match(new RegExp(`--brand-${name}:\\s*(#[0-9a-fA-F]{6})`))[1];
const luminance = (hex) => {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(v => v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => { const [x, y] = [luminance(token(a)), luminance(token(b))].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

test('戶外 token：文字在各種底上至少 4.5:1，核取框外框與主色至少 3:1', () => {
  const grounds = ['bg', 'surface', 'surface-2', 'surface-hover'];
  for (const fg of ['text', 'text-muted', 'action']) for (const bg of grounds) assert.ok(contrast(fg, bg) >= 4.5, `${fg} 在 ${bg} 上只有 ${contrast(fg, bg).toFixed(2)}`);
  for (const bg of ['action', 'action-hover']) assert.ok(contrast('on-action', bg) >= 4.5, `on-action 在 ${bg} 上不夠`);
  assert.ok(contrast('on-danger', 'danger') >= 4.5);
  for (const bg of ['bg', 'surface']) {
    assert.ok(contrast('danger', bg) >= 4.5, `danger 在 ${bg} 上不夠`);
    assert.ok(contrast('control', bg) >= 3, `control 在 ${bg} 上不夠`);
    assert.ok(contrast('layer', bg) >= 3, `layer 在 ${bg} 上不夠`);
  }
});
