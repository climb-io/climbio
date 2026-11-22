import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const extension = new URL('../extension/', import.meta.url);
const read = (file) => readFileSync(new URL(file, extension), 'utf8');
const source = read('i18n.js');
const { messages, languageOf, t } = await import('data:text/javascript;charset=utf-8,' + encodeURIComponent(source));
const locales = ['zh_TW', 'zh_CN', 'en', 'ja', 'ko', 'fr', 'es', 'de'];

test('all eight supported locales provide the same collector message keys and parameters', () => {
  assert.deepEqual(Object.keys(messages).sort(), [...locales].sort());
  const keys = Object.keys(messages.en).sort();
  assert.ok(keys.length >= 50);
  for (const locale of locales) {
    assert.deepEqual(Object.keys(messages[locale]).sort(), keys, locale);
    for (const key of keys) {
      assert.ok(messages[locale][key].trim(), `${locale}.${key} is empty`);
      const params = (value) => [...value.matchAll(/\{(\d+)\}/g)].map((m) => m[1]).sort();
      assert.deepEqual(params(messages[locale][key]), params(messages.en[key]), `${locale}.${key} has mismatched parameters`);
    }
  }
});

test('Chrome UI language selects the corresponding collector language', () => {
  const cases = {
    'zh-TW': 'zh_TW', 'zh-HK': 'zh_TW', 'zh-CN': 'zh_CN', 'zh-SG': 'zh_CN',
    'en-US': 'en', 'ja-JP': 'ja', 'ko-KR': 'ko', 'fr-FR': 'fr',
    'es-ES': 'es', 'de-DE': 'de', 'it-IT': 'en',
  };
  for (const [uiLanguage, expected] of Object.entries(cases)) {
    assert.equal(languageOf(uiLanguage), expected, uiLanguage);
    globalThis.chrome = { i18n: { getUILanguage: () => uiLanguage } };
    assert.equal(t('appName'), messages[expected].appName, uiLanguage);
    assert.equal(t('topoCount', 3), messages[expected].topoCount.replace('{0}', '3'));
  }
  delete globalThis.chrome;
});

test('manifest advertises the same eight Chrome locales and localized metadata', () => {
  const manifest = JSON.parse(read('manifest.json'));
  assert.equal(manifest.default_locale, 'zh_TW');
  assert.equal(manifest.name, '__MSG_extensionName__');
  assert.equal(manifest.description, '__MSG_extensionDescription__');
  assert.equal(manifest.action.default_title, '__MSG_extensionName__');
  for (const locale of locales) {
    const messages = JSON.parse(read(`_locales/${locale}/messages.json`));
    assert.ok(messages.extensionName?.message, locale);
    assert.ok(messages.extensionDescription?.message, locale);
  }
});

test('all collector workflow keys exist and injected panel accepts translations', () => {
  const background = read('background.js');
  const keys = [...background.matchAll(/\bt\('([^']+)'/g)].map((m) => m[1]);
  for (const key of keys) assert.ok(messages.en[key], key);
  assert.match(background, /import \{ t \} from '\.\/i18n\.js'/);
  assert.match(background, /_locales\/\$\{locale\}\/messages\.json/);
  const panel = read('panel.js');
  assert.match(panel, /const ui = state\.ui \|\| \{\}/);
  assert.match(panel, /ui\.appName/);
  assert.match(panel, /ui\.processing/);
  assert.match(panel, /ui\.close/);
  assert.match(panel, /ui\.countUnit/);
});
