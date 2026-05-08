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
      const h = Math.ceil(Math.max(
        window.innerHeight || 0,
        document.documentElement.clientHeight || 0,
        vv ? vv.height + (vv.offsetTop || 0) : 0
      ));
      const w = Math.round((vv && vv.width) || window.innerWidth || document.documentElement.clientWidth || 0);
      if (h > 0) {
        document.documentElement.style.setProperty('--app-h', h + 'px');
        document.documentElement.style.setProperty('--vh', (h * 0.01) + 'px');
      }
      if (w > 0) document.documentElement.style.setProperty('--app-w', w + 'px');
      document.documentElement.style.setProperty('--edge-bleed', '96px');
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
:root{--app-h:100dvh;--app-w:100vw;--edge-bleed:96px;--nav-side:10px;--nav-bottom:12px;--nav-height:82px;--safe-bottom:0px;}
html,body,#root,#app-gate,#protected-root{margin:0 !important;padding:0 !important;width:100vw !important;min-width:100vw !important;height:100vh !important;height:100dvh !important;min-height:100vh !important;min-height:100dvh !important;overflow:hidden !important;background:#0a0a0c !important;}
body::before{content:"" !important;position:fixed !important;inset:-128px 0 !important;background:#0a0a0c !important;z-index:-2147483647 !important;pointer-events:none !important;}
#protected-root{position:fixed !important;top:0 !important;left:0 !important;right:0 !important;bottom:calc(-1 * var(--edge-bleed)) !important;min-height:calc(var(--app-h,100dvh) + var(--edge-bleed)) !important;}
.app,.txn-detail-overlay{position:fixed !important;top:0 !important;left:0 !important;right:0 !important;bottom:calc(-1 * var(--edge-bleed)) !important;width:100vw !important;max-width:none !important;height:calc(var(--app-h,100dvh) + var(--edge-bleed)) !important;min-height:calc(var(--app-h,100dvh) + var(--edge-bleed)) !important;margin:0 !important;overflow:hidden !important;background:#0a0a0c !important;}
.scrollable{height:calc(var(--app-h,100dvh) + var(--edge-bleed)) !important;min-height:calc(var(--app-h,100dvh) + var(--edge-bleed)) !important;max-height:none !important;width:100% !important;overflow-y:auto !important;overflow-x:hidden !important;padding-bottom:calc(var(--nav-height) + var(--nav-bottom) + 18px) !important;background:#0a0a0c !important;}
.txn-detail-screen{height:var(--app-h,100dvh) !important;min-height:var(--app-h,100dvh) !important;max-height:none !important;background:#0a0a0c !important;}
.bottom-nav{position:fixed !important;bottom:var(--nav-bottom) !important;left:var(--nav-side) !important;right:var(--nav-side) !important;width:auto !important;height:var(--nav-height) !important;max-width:none !important;margin:0 !important;padding:0 !important;isolation:isolate !important;background:transparent !important;}
.bottom-nav::before{content:none !important;}
.nav-pill{width:100% !important;height:var(--nav-height) !important;min-height:var(--nav-height) !important;padding:7px 10px !important;border-radius:34px !important;overflow:visible !important;background:rgba(20,20,24,0.92) !important;box-sizing:border-box !important;}
.nav-btn{height:68px !important;min-height:68px !important;border-radius:28px !important;gap:4px !important;font-size:11px !important;font-weight:600 !important;}
.nav-btn.active{background:rgba(255,255,255,0.075) !important;}
.nav-btn svg{width:25px !important;height:25px !important;}
.nav-btn .nav-icon-img{width:36px !important;height:36px !important;}
#appIntro{top:0 !important;left:0 !important;right:0 !important;bottom:calc(-1 * var(--edge-bleed)) !important;width:100vw !important;height:calc(var(--app-h,100dvh) + var(--edge-bleed)) !important;min-height:calc(var(--app-h,100dvh) + var(--edge-bleed)) !important;max-height:none !important;background:#0a0a0c !important;}
#appIntro video{width:100vw !important;height:calc(var(--app-h,100dvh) + var(--edge-bleed)) !important;object-fit:cover !important;}
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
