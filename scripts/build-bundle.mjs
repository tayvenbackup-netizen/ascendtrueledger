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

// ── USDT (multi-chain) injection ───────────────────────────────────────────
// Add Tether on ETH/SOL/TRON/BNB as separate coin keys. usdt_eth ships
// enabled by default; the others appear once the user puts a balance on them.
const USDT_KEYS = ['usdt_eth','usdt_sol','usdt_tron','usdt_bnb'];
const USDT_CHAIN_ICON = { usdt_eth:'ethereum-l.png', usdt_sol:'solana.avif', usdt_tron:'tron.webp', usdt_bnb:'bnb.webp' };
const USDT_CHAIN_LABEL = { usdt_eth:'Ethereum', usdt_sol:'Solana', usdt_tron:'Tron', usdt_bnb:'BNB Chain' };

function appendToObject(src, declRegex, entriesText) {
  return src.replace(declRegex, (m) => m.replace(/(,?\s*)\n\}/, `,\n${entriesText}\n}`));
}

ledgerJs = appendToObject(ledgerJs, /const COINGECKO_IDS = \{[\s\S]*?\n\};/,
  USDT_KEYS.map(k => `    ${k}: 'tether'`).join(',\n'));
ledgerJs = appendToObject(ledgerJs, /const COIN_NAMES = \{[\s\S]*?\n\};/,
  USDT_KEYS.map(k => `    ${k}: 'Tether'`).join(',\n'));
ledgerJs = appendToObject(ledgerJs, /const COIN_SYMBOLS = \{[\s\S]*?\n\};/,
  USDT_KEYS.map(k => `    ${k}: 'USDT'`).join(',\n'));
ledgerJs = appendToObject(ledgerJs, /const COIN_ICONS = \{[\s\S]*?\n\};/,
  USDT_KEYS.map(k => `    ${k}: 'usdt.png'`).join(',\n'));
ledgerJs = appendToObject(ledgerJs, /const FALLBACK_PRICES = \{[\s\S]*?\n\};/,
  USDT_KEYS.map(k => `    ${k}: 1`).join(',\n'));
ledgerJs = appendToObject(ledgerJs, /const COIN_COLORS = \{[\s\S]*?\n\};/,
  USDT_KEYS.map(k => `    ${k}: '#26A17B'`).join(',\n'));

// COIN_ORDER: only enable usdt_eth by default; other USDT chains appear
// when their balance is non-zero (handled by render filter below).
ledgerJs = ledgerJs.replace(
  /const COIN_ORDER = \[[^\]]*\];/,
  "const COIN_ORDER = ['btc','eth','xrp','bnb','sol','ltc','usdt_eth','usdt_sol','usdt_tron','usdt_bnb'];"
);

// COIN_ADDRESS_GEN: usdt on eth/bnb reuse eth gen, usdt on sol reuses sol,
// usdt on tron uses base58 starting with T (34 chars).
ledgerJs = ledgerJs.replace(/(const COIN_ADDRESS_GEN = \{[\s\S]*?)\n\};/,
  `$1,
    usdt_eth: () => COIN_ADDRESS_GEN.eth(),
    usdt_bnb: () => COIN_ADDRESS_GEN.eth(),
    usdt_sol: () => COIN_ADDRESS_GEN.sol(),
    usdt_tron: () => {
      const c='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
      let s='T'; for(let i=0;i<33;i++) s+=c[Math.floor(Math.random()*c.length)];
      return s;
    }
};`);

// Txn metadata for usdt_* coins
ledgerJs = ledgerJs.replace(
  /const TXN_COIN_PREFIX = \{[^}]*\};/,
  (m) => m.replace(/\};$/, `, usdt_eth:'0x', usdt_bnb:'0x', usdt_sol:'', usdt_tron:'T' };`)
);
ledgerJs = ledgerJs.replace(
  /const TXN_COIN_FEE = \{[^}]*\};/,
  (m) => m.replace(/\};$/, `, usdt_eth:0.5, usdt_bnb:0.1, usdt_sol:0.0001, usdt_tron:1 };`)
);
ledgerJs = ledgerJs.replace(
  /const EXPLORER_URLS = \{([\s\S]*?)\n\};/,
  (_, inner) => `const EXPLORER_URLS = {${inner.replace(/,\s*$/, '')},
  usdt_eth: (id) => \`https://etherscan.io/tx/\${id.startsWith('0x') ? id : '0x'+id}\`,
  usdt_bnb: (id) => \`https://bscscan.com/tx/\${id.startsWith('0x') ? id : '0x'+id}\`,
  usdt_sol: (id) => \`https://solscan.io/tx/\${id}\`,
  usdt_tron: (id) => \`https://tronscan.org/#/transaction/\${id}\`,
};`
);
ledgerJs = ledgerJs.replace(
  /let TXID_POOL = \{[^}]*\};/,
  `let TXID_POOL = { btc:[], eth:[], sol:[], bnb:[], xrp:[], ltc:[], usdt_eth:[], usdt_sol:[], usdt_tron:[], usdt_bnb:[] };`
);
ledgerJs = ledgerJs.replace(
  /let TXID_POOL_TS = \{[^}]*\};/,
  `let TXID_POOL_TS = { btc:0, eth:0, sol:0, bnb:0, xrp:0, ltc:0, usdt_eth:0, usdt_sol:0, usdt_tron:0, usdt_bnb:0 };`
);
ledgerJs = ledgerJs.replace(
  /const TX_FETCHERS = \{[^}]*\};/,
  (m) => m.replace(/\};$/, `, usdt_eth:async()=>[], usdt_sol:async()=>[], usdt_tron:async()=>[], usdt_bnb:async()=>[] };`)
);

// txnGenAddr length table
ledgerJs = ledgerJs.replace(
  /const len = coin==='btc' \? 38 : coin==='eth' \? 40 : coin==='sol' \? 44 : coin==='xrp' \? 33 : 38;/,
  "const len = coin==='btc' ? 38 : (coin==='eth'||coin==='usdt_eth'||coin==='usdt_bnb') ? 40 : (coin==='sol'||coin==='usdt_sol') ? 44 : coin==='xrp' ? 33 : coin==='usdt_tron' ? 34 : 38;"
);

// Render: filter the asset list so usdt_eth always shows but the other
// USDT-on-chain entries only appear when they have a balance > 0.
ledgerJs = ledgerJs.replace(
  /const withoutBalance = COIN_ORDER\s*\n\s*\.filter\(k => !withBalance\.some\(a => a\.key === k\)\)\s*\n\s*\.map\(k => assetList\.find\(a => a\.key === k\)\)\s*\n\s*\.filter\(Boolean\);/,
  `const withoutBalance = COIN_ORDER
        .filter(k => !withBalance.some(a => a.key === k))
        .filter(k => !(k.startsWith('usdt_') && k !== 'usdt_eth'))
        .map(k => assetList.find(a => a.key === k))
        .filter(Boolean);`
);

// Render: add chain badge overlay on USDT asset logos (asset list).
ledgerJs = ledgerJs.replace(
  /<div class="asset-logo"><img src="\/assets\/\$\{COIN_ICONS\[asset\.key\]\}" alt="\$\{COIN_SYMBOLS\[asset\.key\]\}"\/><\/div>/,
  `<div class="asset-logo"><img src="/assets/\${COIN_ICONS[asset.key]}" alt="\${COIN_SYMBOLS[asset.key]}"/>\${asset.key.startsWith('usdt_') ? \`<img class="asset-chain-badge" src="/assets/\${({usdt_eth:'ethereum-l.png',usdt_sol:'solana.avif',usdt_tron:'tron.webp',usdt_bnb:'bnb.webp'})[asset.key]}" alt=""/>\` : ''}</div>`
);

// Explore card pct setter: include USDT
ledgerJs = ledgerJs.replace(
  /setPct\('exploreSolPct','sol'\);\n\}/,
  "setPct('exploreSolPct','sol');\n    setPct('exploreUsdtPct','usdt_eth');\n}"
);

// USDT crypto editor controller — single visible row "USDT [amount] [chain]"
// that mirrors into per-chain hidden inputs (set-usdt_eth/sol/tron/bnb)
// which the existing confirmSettings() loop already reads via COIN_ORDER.
const usdtEditorController = `;(() => {
  const tryInit = () => {
    const sel = document.getElementById('set-usdt-chain');
    const amt = document.getElementById('set-usdt-amount');
    const overlay = document.getElementById('settingsOverlay');
    if (!sel || !amt || !overlay) return false;
    const syncFromHidden = () => {
      const h = document.getElementById('set-' + sel.value);
      amt.value = (h && h.value && parseFloat(h.value)) ? h.value : '';
    };
    sel.addEventListener('change', syncFromHidden);
    amt.addEventListener('input', () => {
      const h = document.getElementById('set-' + sel.value);
      if (h) h.value = amt.value;
    });
    new MutationObserver(() => {
      if (overlay.classList.contains('open')) {
        // Pick first chain that has a non-zero balance (default usdt_eth).
        const chains = ['usdt_eth','usdt_sol','usdt_tron','usdt_bnb'];
        const found = chains.find(c => {
          const h = document.getElementById('set-' + c);
          return h && parseFloat(h.value) > 0;
        });
        sel.value = found || 'usdt_eth';
        syncFromHidden();
      }
    }).observe(overlay, { attributes: true, attributeFilter: ['class'] });
    syncFromHidden();
    return true;
  };
  const iv = setInterval(() => { if (tryInit()) clearInterval(iv); }, 200);
})();`;

// USDT explore card markup is inserted into `body` after extraction below.
const USDT_EXPLORE_CARD = `
      <div class="explore-card coin-card" data-coin="usdt_eth">
        <div class="cc-logo"><img src="/assets/usdt.png" alt="USDT"/></div>
        <div class="cc-name">USDT</div>
        <div class="cc-pct" id="exploreUsdtPct">+0.00%</div>
      </div>
`;


// 1) Extract the body markup (between <body> and </body>) but strip ALL <script> tags
//    and the <style> block we already capture separately.
const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
if (!bodyMatch) throw new Error('No <body> in source');
let body = bodyMatch[1];
body = body.replace(
  /(<div class="explore-card coin-card" data-coin="sol">[\s\S]*?<\/div>\s*<\/div>)/,
  `$1\n${USDT_EXPLORE_CARD}`
);

// Inject USDT row into the crypto editor (after LTC row).
body = body.replace(
  /(<div class="settings-row"><label>LTC<\/label><input id="set-ltc"[^>]*><\/div>)/,
  `$1
        <div class="settings-row usdt-edit-row">
          <label>USDT</label>
          <input id="set-usdt-amount" type="number" min="0" step="any" placeholder="0" style="flex:1;min-width:0">
          <select id="set-usdt-chain" class="usdt-chain-select">
            <option value="usdt_eth">ETH</option>
            <option value="usdt_sol">SOL</option>
            <option value="usdt_tron">TRON</option>
            <option value="usdt_bnb">BNB</option>
          </select>
          <input id="set-usdt_eth" type="hidden">
          <input id="set-usdt_sol" type="hidden">
          <input id="set-usdt_tron" type="hidden">
          <input id="set-usdt_bnb" type="hidden">
        </div>`
);

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
  usdtEditorController,
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
:root{--app-h:100dvh;--app-w:100vw;--edge-bleed:96px;--nav-side:10px;--nav-bottom:6px;--nav-height:82px;--safe-bottom:0px;}
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
.asset-logo{position:relative !important;overflow:visible !important;}
.asset-chain-badge{position:absolute !important;right:-4px !important;bottom:-4px !important;width:20px !important;height:20px !important;border-radius:50% !important;background:#0a0a0c !important;padding:1.5px !important;box-sizing:border-box !important;border:2px solid #0a0a0c !important;object-fit:cover !important;z-index:5 !important;box-shadow:0 2px 6px rgba(0,0,0,0.5) !important;}
.asset-logo img[alt="ETH"]{object-fit:contain !important;background:#627EEA !important;padding:6px !important;box-sizing:border-box !important;border-radius:50% !important;}
.asset-logo img[alt="XRP"]{object-fit:contain !important;background:#000 !important;padding:5px !important;box-sizing:border-box !important;border-radius:50% !important;}
.asset-logo img[alt="USDT"]{background:#26A17B !important;}
.usdt-edit-row{display:flex !important;align-items:center !important;gap:8px !important;}
.usdt-edit-row label{flex-shrink:0 !important;}
.usdt-chain-select{background:#1a1a1f !important;color:#fff !important;border:1px solid #2a2a30 !important;border-radius:8px !important;padding:6px 8px !important;font-size:13px !important;flex-shrink:0 !important;}
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
