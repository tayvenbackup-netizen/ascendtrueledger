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
const ledgerJs = gitShow('public/js/ledger.js');
const ledgerCss = gitShow('public/css/ledger.css');

// 1) Extract the body markup (between <body> and </body>) but strip ALL <script> tags
//    and the <style> block we already capture separately.
const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
if (!bodyMatch) throw new Error('No <body> in source');
let body = bodyMatch[1];

// Capture every inline <script>…</script> (no src) so we can re-inject them later
const inlineScripts = [];
body = body.replace(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi, (_, code) => {
  inlineScripts.push(code);
  return '';
});
// Drop <script src="..."></script> tags entirely (ledger.js is fetched as part of the bundle)
body = body.replace(/<script\b[^>]*\bsrc=[^>]*>\s*<\/script>/gi, '');

// Capture inline <style> blocks too and merge with ledger.css
let extraCss = '';
body = body.replace(/<style[^>]*>([\s\S]*?)<\/style>/gi, (_, css) => {
  extraCss += '\n' + css;
  return '';
});

// 2) Combine all JS: the inline blocks (in original order) + ledger.js
//    Wrap each inline block in an IIFE to preserve original isolation semantics.
const combinedJs = [
  ledgerJs,
  ...inlineScripts.map(s => `;(function(){\n${s}\n})();`),
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

const bundle = {
  html: body,
  css: ledgerCss + extraCss,
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
