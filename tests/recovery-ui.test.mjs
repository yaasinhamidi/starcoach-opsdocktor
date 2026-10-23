import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { applyErrorDeployState, bindThemeControl, diagnosisFeedback, healthPresentationClass, initializeTheme, interpretDeployLock, recoveryHtml } from '../src/recovery-ui.mjs';

function makeThemeEnvironment({ stored = null, dark = false, denyStorage = false } = {}) {
  const listeners = new Set();
  const values = new Map(stored === null ? [] : [['starcoach.opsdocktor.theme', stored]]);
  const meta = { content: '' };
  const buttons = ['light', 'dark', 'system'].map(value => ({
    dataset: { themePreference: value }, attrs: {}, listeners: {},
    addEventListener(name, fn) { this.listeners[name] = fn; },
    setAttribute(name, value) { this.attrs[name] = value; },
    click() { this.listeners.click(); },
  }));
  const root = { attrs: {}, style: {}, setAttribute(name, value) { this.attrs[name] = value; } };
  const doc = { documentElement: root, querySelector(selector) {
    if (selector === 'meta[name="theme-color"]') return meta;
    return null;
  }, querySelectorAll(selector) { return selector === '#themePreference [data-theme-preference]' ? buttons : []; } };
  const media = { matches: dark, addEventListener(name, fn) { if (name === 'change') listeners.add(fn); }, change(value) { this.matches = value; for (const fn of listeners) fn({ matches: value }); } };
  const storage = {
    getItem(key) { if (denyStorage) throw new Error('blocked'); return values.get(key) ?? null; },
    setItem(key, value) { if (denyStorage) throw new Error('blocked'); values.set(key, value); },
  };
  const win = { localStorage: storage, matchMedia: query => { assert.equal(query, '(prefers-color-scheme: dark)'); return media; } };
  return { doc, win, meta, buttons, root, media, values };
}

test('theme defaults to SYSTEM and resolves the current system appearance before paint', () => {
  const env = makeThemeEnvironment({ dark: true });
  const theme = initializeTheme(env.doc, env.win);
  assert.equal(theme.preference, 'system');
  assert.equal(env.root.attrs['data-theme'], 'dark');
  assert.equal(env.root.style.colorScheme, 'dark');
  assert.equal(env.meta.content, '#101322');
  assert.equal(env.values.size, 0);
});

test('system changes update SYSTEM, manual choice overrides it, and returning to SYSTEM applies immediately', () => {
  const env = makeThemeEnvironment({ dark: false });
  const theme = initializeTheme(env.doc, env.win);
  bindThemeControl(env.doc, env.win, theme);
  assert.deepEqual(env.buttons.map(button => button.attrs['aria-pressed']), ['false', 'false', 'true']);
  env.media.change(true);
  assert.equal(env.root.attrs['data-theme'], 'dark');
  env.buttons[0].click();
  assert.equal(env.values.get('starcoach.opsdocktor.theme'), 'light');
  assert.deepEqual(env.buttons.map(button => button.attrs['aria-pressed']), ['true', 'false', 'false']);
  env.media.change(false);
  assert.equal(env.root.attrs['data-theme'], 'light');
  env.buttons[1].click();
  assert.deepEqual(env.buttons.map(button => button.attrs['aria-pressed']), ['false', 'true', 'false']);
  env.media.change(false);
  assert.equal(env.root.attrs['data-theme'], 'dark');
  env.buttons[2].click();
  assert.deepEqual(env.buttons.map(button => button.attrs['aria-pressed']), ['false', 'false', 'true']);
  assert.equal(env.root.attrs['data-theme'], 'light');
  assert.equal(env.values.get('starcoach.opsdocktor.theme'), 'system');
});

test('saved manual preference survives reload while a system preference remains SYSTEM', () => {
  const env = makeThemeEnvironment({ stored: 'dark', dark: false });
  const theme = initializeTheme(env.doc, env.win);
  assert.equal(theme.preference, 'dark');
  assert.equal(env.root.attrs['data-theme'], 'dark');
  const next = makeThemeEnvironment({ stored: env.values.get('starcoach.opsdocktor.theme'), dark: true });
  assert.equal(initializeTheme(next.doc, next.win).preference, 'dark');
  const system = makeThemeEnvironment({ stored: 'system', dark: true });
  assert.equal(initializeTheme(system.doc, system.win).preference, 'system');
  assert.equal(system.root.attrs['data-theme'], 'dark');
});

test('storage denial leaves the page usable and allows an in-memory manual override', () => {
  const env = makeThemeEnvironment({ dark: true, denyStorage: true });
  const theme = initializeTheme(env.doc, env.win);
  bindThemeControl(env.doc, env.win, theme);
  assert.equal(env.root.attrs['data-theme'], 'dark');
  assert.doesNotThrow(() => env.buttons[0].click());
  assert.equal(env.root.attrs['data-theme'], 'light');
  assert.equal(env.buttons[0].attrs['aria-pressed'], 'true');
});

test('theme control uses three accessible native buttons and theme changes do not call workflow APIs', () => {
  assert.match(recoveryHtml, /id="themePreference" class="theme-segment" role="group" aria-label="انتخاب پوسته"/);
  assert.equal((recoveryHtml.match(/<button type="button" data-theme-preference=/g) || []).length, 3);
  assert.match(recoveryHtml, /data-theme-preference="light" aria-label="روشن" aria-pressed="false"/);
  assert.match(recoveryHtml, /data-theme-preference="dark" aria-label="تاریک" aria-pressed="false"/);
  assert.match(recoveryHtml, /data-theme-preference="system" aria-label="خودکار" aria-pressed="false"/);
  assert.match(recoveryHtml, /<span>روشن<\/span>/);
  assert.match(recoveryHtml, /<span>تاریک<\/span>/);
  assert.match(recoveryHtml, /<span>خودکار<\/span>/);
  assert.match(recoveryHtml, /<svg viewBox="0 0 24 24" aria-hidden="true">/);
  assert.doesNotMatch(recoveryHtml, /<select id="themePreference"/);
  assert.match(recoveryHtml, /meta name="theme-color"/);
  assert.match(bindThemeControl.toString(), /addEventListener\('click'/);
  assert.match(recoveryHtml, /button:focus-visible/);
  assert.doesNotMatch(bindThemeControl.toString(), /fetch\(|request\(/);
});

test('each theme button click updates only local theme state and keeps exactly one selected', () => {
  const env = makeThemeEnvironment();
  const theme = initializeTheme(env.doc, env.win);
  let workflowRequests = 0;
  const request = () => { workflowRequests += 1; };
  bindThemeControl(env.doc, env.win, theme);
  for (const [index, mode] of ['light', 'dark', 'system'].entries()) {
    env.buttons[index].click();
    assert.equal(theme.preference, mode);
    assert.deepEqual(env.buttons.map(button => button.attrs['aria-pressed']), env.buttons.map((_, i) => String(i === index)));
  }
  assert.equal(workflowRequests, 0);
});

test('candidate outcomes use Persian labels and UNKNOWN uses a distinct warning presentation', () => {
  assert.match(recoveryHtml, /شناسهٔ نامزد:/);
  assert.match(recoveryHtml, /جاری بودن:/);
  assert.match(recoveryHtml, /نتیجهٔ عملیات نامشخص است/);
  assert.match(recoveryHtml, /className='result-unknown'/);
  assert.match(recoveryHtml, /UNKNOWN_REQUIRES_RECONCILIATION:'نتیجهٔ انتشار قبلی هنوز نامشخص است/);
  assert.match(recoveryHtml, /interpretDeployLock\(s\?\.unresolvedDeployments\)/);
  assert.match(recoveryHtml, /وضعیت مرجع انتشار ناقص یا نامعتبر است/);
  assert.match(recoveryHtml, /تأیید و اجرای انتشار جدید در دسترس نیست/);
  assert.doesNotMatch(recoveryHtml, /թեկնածու|ընթացիկ/);
});

test('deploy lock fails closed for missing and malformed authoritative state', () => {
  assert.deepEqual(interpretDeployLock([]), { state: 'CLEAR', items: [] });
  assert.deepEqual(interpretDeployLock([{ runId: 'old-run', source: 'MOCK' }]), { state: 'BLOCKED', items: [{ runId: 'old-run', source: 'MOCK' }] });
  for (const value of [undefined, null, {}, 'clear']) assert.deepEqual(interpretDeployLock(value), { state: 'INCOMPLETE', items: [] });
  assert.match(recoveryHtml, /deployBlocked=lock\.state!=='CLEAR'/);
});

test('error envelopes update only current authoritative lock state and never clear a prior UNKNOWN automatically', () => {
  const current = { serverInstanceId: 'server-a', runId: 'run-a', generation: 4, status: 'REPAIRED', unresolvedDeployments: [{ runId: 'old-run', source: 'MOCK' }] };
  const envelope = { serverInstanceId: 'server-a', runId: 'run-a', generation: 4, error: 'UNKNOWN_REQUIRES_RECONCILIATION', unresolvedDeployments: [{ runId: 'old-run', source: 'MOCK' }] };
  const updated = applyErrorDeployState(current, envelope, 8, 7);
  assert.deepEqual(updated.unresolvedDeployments, envelope.unresolvedDeployments);
  assert.equal(updated.status, 'REPAIRED');
  assert.equal(updated.error, undefined);
  for (const response of [
    { ...envelope, serverInstanceId: 'server-b' },
    { ...envelope, runId: 'run-b' },
    { ...envelope, generation: 3 },
  ]) assert.equal(applyErrorDeployState(current, response, 8, 7), null);
  assert.equal(applyErrorDeployState(current, envelope, 6, 7), null);
  assert.equal(applyErrorDeployState(current, { ...envelope, unresolvedDeployments: [] }, 8, 7).unresolvedDeployments, undefined);
  assert.equal(applyErrorDeployState(current, { ...envelope, unresolvedDeployments: null }, 8, 7).unresolvedDeployments, null);
  assert.equal(applyErrorDeployState(current, { ...envelope, unresolvedDeployments: undefined }, 8, 7).unresolvedDeployments, undefined);
});

test('health status classes are semantic and NOT_RUN or NOT_APPLICABLE stay neutral', () => {
  assert.equal(healthPresentationClass('VERIFIED'), 'health verified');
  assert.equal(healthPresentationClass('FAILED'), 'health failed');
  assert.equal(healthPresentationClass('UNKNOWN'), 'health unknown');
  assert.equal(healthPresentationClass('NOT_RUN'), 'health neutral');
  assert.equal(healthPresentationClass('NOT_APPLICABLE'), 'health neutral');
  assert.match(recoveryHtml, /\.health\.verified\{border-color:var\(--success\);background:var\(--success-bg\)\}/);
  assert.match(recoveryHtml, /\.health\.neutral\{border-color:var\(--border\);background:var\(--surface-elevated\)\}/);
});

test('diagnosis feedback announces loading and distinguishes unavailable LIVE evidence from provider failure', () => {
  assert.deepEqual(diagnosisFeedback({ phase: 'loading' }), { text: 'در حال بررسی شواهد تشخیص؛ لطفاً صبر کنید…', role: 'status', live: 'polite' });
  const live = diagnosisFeedback({ phase: 'failed', errorCode: 'LIVE_EVIDENCE_UNAVAILABLE', inputMode: 'LIVE_READ_ONLY' });
  const provider = diagnosisFeedback({ phase: 'failed', errorCode: 'DIAGNOSIS_PROVIDER_FAILED', inputMode: 'LIVE_READ_ONLY' });
  assert.equal(live.role, 'alert');
  assert.match(live.text, /شواهد زنده در دسترس نیست/);
  assert.match(provider.text, /ارائه‌دهندهٔ تشخیص نتوانست پاسخ دهد/);
  assert.doesNotMatch(provider.text, /دسترسی .*Liara/);
  assert.match(recoveryHtml, /id="llmDiagnosis" class="muted" role="status" aria-live="polite" aria-atomic="true" tabindex="-1"/);
  assert.match(recoveryHtml, /trigger\?\.isConnected\)trigger\.focus\(\)/);
});

test('page includes responsive wrapping, bounded evidence panels, and visible keyboard focus rules', () => {
  assert.match(recoveryHtml, /overflow-wrap:anywhere/);
  assert.match(recoveryHtml, /pre\{max-width:100%/);
  assert.match(recoveryHtml, /:focus-visible/);
  assert.match(recoveryHtml, /aria-live="polite"/);
  assert.match(recoveryHtml, /verifiedPort\.port\+verifiedPort\.path/);
  assert.match(recoveryHtml, /نشانی بررسی‌شده: http:\/\/127\.0\.0\.1:/);
});

test('OpsDocktor mark assets use the bounded recovery geometry and contain no active or remote content', async () => {
  const files = ['opsdocktor-logo-primary.svg', 'opsdocktor-logo-mono.svg', 'opsdocktor-logo-light.svg',
    'opsdocktor-logo-dark.svg', 'opsdocktor-favicon.svg'];
  const assets = await Promise.all(files.map(file => readFile(new URL(`../assets/brand/${file}`, import.meta.url), 'utf8')));
  for (const svg of assets) {
    assert.match(svg, /<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 64 64"/);
    assert.match(svg, /stroke-width="2\.8"/);
    assert.match(svg, /M22 10h-6/);
    assert.match(svg, /M24 22 32 32 40 42/);
    assert.doesNotMatch(svg, /<script\b|<animate\b|<foreignObject\b|\bhref\s*=|url\(/i);
  }
  const lockup = await readFile(new URL('../assets/brand/opsdocktor-lockup.svg', import.meta.url), 'utf8');
  assert.match(lockup, /viewBox="0 0 300 64"/);
  assert.match(lockup, /Starcoach OpsDocktor/);
  assert.doesNotMatch(lockup, /<script\b|<animate\b|<foreignObject\b|\bhref\s*=|url\(/i);
  assert.match(recoveryHtml, /class="brand-mark" viewBox="0 0 64 64"/);
  assert.match(recoveryHtml, /<h1>Starcoach OpsDocktor<\/h1>/);
});

test('semantic brand tokens retain distinct status colors and the requested palette', () => {
  assert.match(recoveryHtml, /--bg:#f5f7ff/);
  assert.match(recoveryHtml, /--bg:#101322/);
  assert.match(recoveryHtml, /--brand:#4338ca/);
  assert.match(recoveryHtml, /--brand:#a5b4fc/);
  assert.match(recoveryHtml, /--accent:#0f766e/);
  assert.match(recoveryHtml, /--accent:#5eead4/);
  assert.match(recoveryHtml, /--success:/);
  assert.match(recoveryHtml, /--warning:/);
  assert.match(recoveryHtml, /--danger:/);
  assert.match(recoveryHtml, /\.result-unknown\{border-inline-start:5px solid var\(--warning\)/);
  assert.match(recoveryHtml, /\.result-ok\{border-inline-start:5px solid var\(--success\)/);
  assert.match(recoveryHtml, /button\[aria-pressed="true"\]\{background:var\(--brand\)/);
});
