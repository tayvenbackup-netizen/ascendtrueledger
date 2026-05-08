// Build the protected app bundle from the original index.html + ledger.js/css
// Outputs to protected-build/bundle.json AND supabase/functions/get-app-bundle/bundle.json
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import JsObfuscator from 'javascript-obfuscator';

const ROOT = process.cwd();
// Pull pristine sources from the last known-good commit (before the security refactor stripped them)
const SRC_COMMIT = process.env.SRC_COMMIT || 'd8835d0';

function gitShow(p) {
  return execSync(`git show ${SRC_COMMIT}:${p}`, { maxBuffer: 50 * 1024 * 1024 }).toString();
}

const html = gitShow('index.html');
let ledgerJs = gitShow('public/js/ledger.js');
const ledgerCss = gitShow('public/css/ledger.css');

// The protected loader already performs server-verified key authentication and
// mobile gating. Remove the old public-page bootstrap from the legacy wallet JS
// so it cannot redirect, blur, or lock the dynamically injected app.
ledgerJs = ledgerJs.replace(/\/\/ ── Auth \/ device-guard bootstrap[\s\S]*?\/\/ ── Constants/m, '// ── Constants');

// 1) Extract the body markup (between <body> and </body>) but strip ALL <script> tags
//    and the <style> block we already capture separately.
const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
if (!bodyMatch) throw new Error('No <body> in source');
let body = bodyMatch[1];

// Capture scripts in their original order so wallet bootstrapping remains intact.
// Drop legacy auth-blur scripts; the React shell now owns auth state.
const orderedScripts = [];
body = body.replace(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi, (_, code) => {
  if (!/body\[data-authed="0"\]\s+\.app/.test(code) && !/document\.body\.dataset\.authed\s*=\s*['"]0['"]/.test(code) && !/document\.documentElement\.style\.setProperty\('--vh'/.test(code)) {
    orderedScripts.push(code);
  }
  return '';
});
// Replace the legacy script tag with the protected ledger payload at the same
// point in execution order; drop the Vite public shell script.
body = body.replace(/<script\b([^>]*)\bsrc=["']([^"']+)["'][^>]*>\s*<\/script>/gi, (_, _attrs, src) => {
  if (src.includes('/js/ledger.js')) orderedScripts.push(ledgerJs);
  return '';
});

// Capture inline <style> blocks too and merge with ledger.css
let extraCss = '';
body = body.replace(/<style[^>]*>([\s\S]*?)<\/style>/gi, (_, css) => {
  extraCss += '\n' + css;
  return '';
});

// 2) Combine all JS in original page order, then replay lifecycle events because
// this bundle is injected after the shell document already finished loading.
const viewportRuntime = `;(() => {
    const setViewportVars = () => {
      const vv = window.visualViewport;
      const h = Math.round((vv && vv.height) || window.innerHeight || document.documentElement.clientHeight || 0);
      const w = Math.round((vv && vv.width) || window.innerWidth || document.documentElement.clientWidth || 0);
      if (h > 0) {
        document.documentElement.style.setProperty('--app-h', h + 'px');
        document.documentElement.style.setProperty('--vh', (h * 0.01) + 'px');
      }
      if (w > 0) document.documentElement.style.setProperty('--app-w', w + 'px');
    };
    setViewportVars();
    window.addEventListener('resize', setViewportVars, { passive: true });
    window.addEventListener('orientationchange', () => setTimeout(setViewportVars, 80), { passive: true });
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', setViewportVars, { passive: true });
      window.visualViewport.addEventListener('scroll', setViewportVars, { passive: true });
    }
  })();`;

const combinedJs = [
  viewportRuntime,
  ...orderedScripts,
  `;(() => {
    document.body.dataset.authed = '1';
    window.dispatchEvent(new CustomEvent('ascend:auth-changed'));
    document.dispatchEvent(new Event('DOMContentLoaded', { bubbles: true, cancelable: true }));
    window.dispatchEvent(new Event('load'));
  })();`,
].join('\n\n');

// 3) Obfuscate (medium preset)
console.log('Obfuscating', combinedJs.length, 'bytes of JS…');
// LIGHT obfuscation only — no control-flow flattening, no self-defending,
// no anti-debug. Keeps app fast and stable on mobile.
const obfuscated = JsObfuscator.obfuscate(combinedJs, {
  compact: true,
  controlFlowFlattening: false,
  deadCodeInjection: false,
  stringArray: true,
  stringArrayEncoding: ['base64'],
  stringArrayThreshold: 0.5,
  unicodeEscapeSequence: false,
  identifierNamesGenerator: 'mangled',
  renameGlobals: false,
  selfDefending: false,
  debugProtection: false,
  disableConsoleOutput: false,
  target: 'browser',
}).getObfuscatedCode();
console.log('Obfuscated to', obfuscated.length, 'bytes');

// Viewport-fit overrides: iOS Safari's 100vh extends below the visible
// viewport (behind the URL bar), clipping the bottom of the app. Use dvh
// where supported and let position:fixed inset:0 own the sizing.
const viewportFix = `
:root{--app-h:100dvh;--app-w:100vw;}
html,body,#protected-root{margin:0 !important;padding:0 !important;width:100vw !important;min-width:100vw !important;height:var(--app-h,100dvh) !important;min-height:var(--app-h,100dvh) !important;max-height:var(--app-h,100dvh) !important;overflow:hidden !important;background:#0a0a0c !important;}
#protected-root{position:fixed !important;inset:0 !important;}
.app,.txn-detail-overlay{position:fixed !important;inset:0 !important;width:100vw !important;max-width:none !important;height:var(--app-h,100dvh) !important;min-height:var(--app-h,100dvh) !important;max-height:var(--app-h,100dvh) !important;margin:0 !important;overflow:hidden !important;}
.scrollable{height:var(--app-h,100dvh) !important;min-height:var(--app-h,100dvh) !important;max-height:var(--app-h,100dvh) !important;width:100% !important;overflow-y:auto !important;overflow-x:hidden !important;padding-bottom:calc(148px + env(safe-area-inset-bottom)) !important;}
.txn-detail-screen{height:var(--app-h,100dvh) !important;min-height:var(--app-h,100dvh) !important;max-height:var(--app-h,100dvh) !important;}
.bottom-nav{bottom:calc(1px + env(safe-area-inset-bottom)) !important;left:0 !important;right:0 !important;width:100vw !important;max-width:none !important;margin:0 !important;padding-left:14px !important;padding-right:14px !important;}
.bg-glow{height:567px !important;}
`;

const bundle = {
  html: body,
  css: ledgerCss + extraCss + viewportFix,
  js: obfuscated,
};

const outA = path.join(ROOT, 'protected-build', 'bundle.json');
const outB = path.join(ROOT, 'supabase', 'functions', 'get-app-bundle', 'bundle.json');
fs.mkdirSync(path.dirname(outA), { recursive: true });
fs.mkdirSync(path.dirname(outB), { recursive: true });
fs.writeFileSync(outA, JSON.stringify(bundle));
fs.writeFileSync(outB, JSON.stringify(bundle));
console.log('Wrote', outA, 'and', outB);
console.log('Sizes — html:', bundle.html.length, 'css:', bundle.css.length, 'js:', bundle.js.length);
