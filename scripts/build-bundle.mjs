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
const USDT_CHAIN_ICON = { usdt_eth:'coin-eth.png', usdt_sol:'coin-sol.png', usdt_tron:'coin-tron.png', usdt_bnb:'coin-bnb.png' };
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
  USDT_KEYS.map(k => `    ${k}: 'coin-usdt.png'`).join(',\n'));
ledgerJs = ledgerJs.replace(/const COIN_ICONS = \{[\s\S]*?\n\};/, `const COIN_ICONS = {
    btc: 'coin-btc.png',
    eth: 'coin-eth.png',
    xrp: 'coin-xrp.png',
    bnb: 'coin-bnb.png',
    sol: 'coin-sol.png',
    ltc: 'coin-ltc.png',
    usdt_eth: 'coin-usdt.png',
    usdt_sol: 'coin-usdt.png',
    usdt_tron: 'coin-usdt.png',
    usdt_bnb: 'coin-usdt.png'
};`);
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

// Random transaction generator: spread timestamps EVENLY across the chosen day range
// (with small jitter so they don't sit on identical seconds), instead of clustering randomly.
ledgerJs = ledgerJs.replace(
  /\/\/ random ts within selected range\s*\n\s*const ts = now - Math\.floor\(Math\.random\(\) \* rangeDays \* 86400000\);/,
  `// Spread ts evenly across the selected day range, with a tiny jitter
      const _spanMs = rangeDays * 86400000;
      const _step = _spanMs / Math.max(1, count);
      const _jitter = (Math.random() - 0.5) * _step * 0.25;
      const ts = now - Math.floor(i * _step + _step/2 + _jitter);`
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
  `<div class="asset-logo"><img src="/assets/\${COIN_ICONS[asset.key]}" alt="\${COIN_SYMBOLS[asset.key]}"/>\${asset.key.startsWith('usdt_') ? \`<img class="asset-chain-badge" src="/assets/\${({usdt_eth:'coin-eth.png',usdt_sol:'coin-sol.png',usdt_tron:'coin-tron.png',usdt_bnb:'coin-bnb.png'})[asset.key]}" alt=""/>\` : ''}</div>`
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
        <div class="cc-logo"><img src="/assets/coin-usdt.png" alt="USDT"/></div>
        <div class="cc-name">USDT</div>
        <div class="cc-pct" id="exploreUsdtPct">+0.00%</div>
      </div>
`;


// 1) Extract the body markup (between <body> and </body>) but strip ALL <script> tags
//    and the <style> block we already capture separately.
const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
if (!bodyMatch) throw new Error('No <body> in source');
let body = bodyMatch[1];
body = body
  .replace(/\/assets\/bitcoin\.avif/g, '/assets/coin-btc.png')
  .replace(/\/assets\/ethereum-l\.png/g, '/assets/coin-eth.png')
  .replace(/\/assets\/xrp\.png/g, '/assets/coin-xrp.png')
  .replace(/\/assets\/bnb\.webp/g, '/assets/coin-bnb.png')
  .replace(/\/assets\/solana\.avif/g, '/assets/coin-sol.png')
  .replace(/\/assets\/litecoin\.png/g, '/assets/coin-ltc.png')
  .replace(/\/assets\/usdt\.png/g, '/assets/coin-usdt.png')
  .replace(/\/assets\/tron\.webp/g, '/assets/coin-tron.png');
body = body.replace(
  /(<div class="explore-card coin-card" data-coin="sol">[\s\S]*?<\/div>\s*<\/div>)/,
  `$1\n${USDT_EXPLORE_CARD}`
);

// Remove promo carousel block (the scrollable promo cards above Explore market)
body = body.replace(/<!--\s*PROMO CAROUSEL\s*-->[\s\S]*?(?=<!--\s*EXPLORE MARKET\s*-->)/i,
`<!-- PROMO CARD -->
    <div class="promo-single-wrap">
      <div class="promo-single">
        <div class="ps-text">
          <div class="ps-title">Diversify your assets securely</div>
          <div class="ps-sub">Compare quotes for your swap →</div>
        </div>
        <img class="ps-art" src="/assets/promo-swap.png" alt=""/>
        <button class="ps-close" aria-label="Dismiss">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>
        </button>
      </div>
    </div>
    `);
// Remove "For you" section header + cards row
body = body.replace(/<!--\s*FOR YOU\s*-->[\s\S]*?(?=<!--\s*TRANSACTION HISTORY\s*-->)/i, '');

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

// Inject Remove All / Remove Some controls into the txn editor
body = body.replace(
  /(<div class="txn-edit-title">Existing Transactions<\/div>)/,
  `$1
          <div class="txn-edit-actions">
            <button id="txnRemoveSome" class="txn-edit-action-btn">Remove some…</button>
            <button id="txnRemoveAll" class="txn-edit-action-btn danger">Remove all</button>
          </div>`
);

// Inject "See all transactions" full-screen overlay (slides in from the right)
body = body.replace(/<\/body>\s*$/i, `
  <div id="txnAllOverlay" class="txn-all-overlay" aria-hidden="true">
    <div class="txn-all-screen">
      <div class="txn-all-header">
        <button class="txn-all-back" id="txnAllBack" aria-label="Back">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
        </button>
        <div class="txn-all-title">Transaction history</div>
        <div class="txn-all-spacer"></div>
      </div>
      <div class="txn-all-body" id="txnAllBody"></div>
    </div>
  </div>
</body>`);

// See-all overlay controller — slide in from right, render every txn, click row → existing detail
const seeAllController = `;(() => {
  const tryInit = () => {
    const btn = document.getElementById('txnSeeAll');
    const overlay = document.getElementById('txnAllOverlay');
    const back = document.getElementById('txnAllBack');
    const body = document.getElementById('txnAllBody');
    if (!btn || !overlay || !back || !body) return false;
    if (btn.dataset.allBound === '1') return true;
    btn.dataset.allBound = '1';

    const fmtDate = (ts) => {
      const d = new Date(ts);
      const today = new Date(); today.setHours(0,0,0,0);
      const dd = new Date(d); dd.setHours(0,0,0,0);
      const diffDays = Math.round((today - dd) / 86400000);
      const mdy = (d.getMonth()+1) + '/' + d.getDate() + '/' + d.getFullYear();
      let label;
      if (diffDays === 0) label = 'TODAY';
      else if (diffDays === 1) label = 'YESTERDAY';
      else label = d.toLocaleDateString('en-US', { weekday: 'long' }).toUpperCase();
      return mdy + ' - ' + label;
    };
    const fmtTime = (ts) => {
      try { return (typeof fmtTxnTime === 'function') ? fmtTxnTime(ts) : new Date(ts).toLocaleTimeString(); }
      catch { return new Date(ts).toLocaleTimeString(); }
    };
    const ARROW_UP = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="6 11 12 5 18 11"/></svg>';
    const ARROW_DOWN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><polyline points="18 13 12 19 6 13"/></svg>';

    const render = () => {
      let txns = [];
      try { txns = (typeof loadTxns === 'function') ? loadTxns() : (JSON.parse(localStorage.getItem('ledgerTxns'))||[]); } catch {}
      txns = txns.slice().sort((a,b) => b.ts - a.ts);
      body.innerHTML = '';
      if (!txns.length) { body.innerHTML = '<div class="txn-empty" style="padding:40px;text-align:center;color:#9c9ca1">No transactions yet</div>'; return; }
      let s = {}; try { s = (typeof loadSettings === 'function') ? loadSettings() : {}; } catch {}
      const currency = (s && s.currency) || 'usd';
      let lastDate = '';
      for (const t of txns) {
        const ds = fmtDate(t.ts);
        if (ds !== lastDate) {
          const pill = document.createElement('div');
          pill.className = 'txn-date-pill';
          pill.textContent = ds;
          body.appendChild(pill);
          lastDate = ds;
        }
        let price = 0;
        try {
          const c = (typeof getCachedPrice === 'function') ? getCachedPrice(t.coin, currency) : null;
          price = c ? c.price : ((typeof FALLBACK_PRICES !== 'undefined' && FALLBACK_PRICES[t.coin]) || 0);
        } catch {}
        const fiat = Math.abs(t.amount) * price;
        const isSent = t.type === 'sent';
        const sign = isSent ? '-' : '+';
        const fmtAmt = (typeof fmtAmount === 'function') ? fmtAmount : (n => n.toString());
        const fmtU = (typeof fmtUSD === 'function') ? fmtUSD : (n => '$' + n.toFixed(2));
        const sym = (typeof COIN_SYMBOLS !== 'undefined' && COIN_SYMBOLS[t.coin]) || '';
        const name = (typeof COIN_NAMES !== 'undefined' && COIN_NAMES[t.coin]) || t.coin;
        const row = document.createElement('div');
        row.className = 'txn-row';
        row.innerHTML = \`
          <div class="txn-icon">\${isSent ? ARROW_UP : ARROW_DOWN}</div>
          <div class="txn-mid">
            <div class="txn-name">\${name} 1</div>
            <div class="txn-sub">\${isSent ? 'Sent' : 'Received'} \${fmtTime(t.ts)}</div>
          </div>
          <div class="txn-right">
            <div class="txn-amt">\${sign}\${fmtAmt(Math.abs(t.amount))} \${sym}</div>
            <div class="txn-fiat">\${sign}\${fmtU(fiat)}</div>
          </div>\`;
        row.addEventListener('click', () => {
          if (typeof openTxnDetail === 'function') openTxnDetail(t);
        });
        body.appendChild(row);
      }
    };

    const open = (e) => {
      if (e) { e.preventDefault(); e.stopPropagation(); }
      render();
      overlay.classList.add('open');
      overlay.setAttribute('aria-hidden', 'false');
    };
    const close = () => {
      overlay.classList.remove('open');
      overlay.setAttribute('aria-hidden', 'true');
    };

    btn.addEventListener('click', open, true);
    back.addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    return true;
  };
  const iv = setInterval(() => { if (tryInit()) clearInterval(iv); }, 200);
})();`;

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
  seeAllController,
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
:root{--app-h:100dvh;--app-w:100vw;--edge-bleed:96px;--nav-side:10px;--nav-bottom:6px;--nav-height:77px;--safe-bottom:0px;}
html,body,#root,#app-gate,#protected-root{margin:0 !important;padding:0 !important;width:100vw !important;min-width:100vw !important;height:100vh !important;height:100dvh !important;min-height:100vh !important;min-height:100dvh !important;overflow:hidden !important;background:#0a0a0c !important;}
body::before{content:"" !important;position:fixed !important;inset:-128px 0 !important;background:#0a0a0c !important;z-index:-2147483647 !important;pointer-events:none !important;}
#protected-root{position:fixed !important;top:0 !important;left:0 !important;right:0 !important;bottom:calc(-1 * var(--edge-bleed)) !important;min-height:calc(var(--app-h,100dvh) + var(--edge-bleed)) !important;}
.app,.txn-detail-overlay{position:fixed !important;top:0 !important;left:0 !important;right:0 !important;bottom:calc(-1 * var(--edge-bleed)) !important;width:100vw !important;max-width:none !important;height:calc(var(--app-h,100dvh) + var(--edge-bleed)) !important;min-height:calc(var(--app-h,100dvh) + var(--edge-bleed)) !important;margin:0 !important;overflow:hidden !important;background:#0a0a0c !important;}
.scrollable{height:calc(var(--app-h,100dvh) + var(--edge-bleed)) !important;min-height:calc(var(--app-h,100dvh) + var(--edge-bleed)) !important;max-height:none !important;width:100% !important;overflow-y:auto !important;overflow-x:hidden !important;padding-bottom:calc(var(--nav-height) + var(--nav-bottom) + 220px) !important;background:#0a0a0c !important;}
.txn-detail-screen{height:var(--app-h,100dvh) !important;min-height:var(--app-h,100dvh) !important;max-height:none !important;background:#0a0a0c !important;}
.bottom-nav{position:fixed !important;bottom:var(--nav-bottom) !important;left:var(--nav-side) !important;right:var(--nav-side) !important;width:auto !important;height:77px !important;max-width:none !important;margin:0 !important;padding:0 !important;isolation:isolate !important;background:transparent !important;background-image:url('/assets/nav-bar.png') !important;background-repeat:no-repeat !important;background-size:100% 77px !important;background-position:center !important;}
.bottom-nav::before{content:none !important;}
.nav-pill{display:flex !important;width:100% !important;height:77px !important;min-height:77px !important;padding:0 !important;margin:0 !important;background:transparent !important;border:none !important;box-shadow:none !important;border-radius:0 !important;}
.nav-btn{flex:1 1 0 !important;height:77px !important;min-height:77px !important;background:transparent !important;border:none !important;border-radius:0 !important;color:transparent !important;cursor:pointer !important;padding:0 !important;margin:0 !important;}
.nav-btn.active{background:transparent !important;}
.nav-btn > *{visibility:hidden !important;pointer-events:none !important;}
#appIntro{top:0 !important;left:0 !important;right:0 !important;bottom:calc(-1 * var(--edge-bleed)) !important;width:100vw !important;height:calc(var(--app-h,100dvh) + var(--edge-bleed)) !important;min-height:calc(var(--app-h,100dvh) + var(--edge-bleed)) !important;max-height:none !important;background:#0a0a0c !important;}
#appIntro video{width:100vw !important;height:calc(var(--app-h,100dvh) + var(--edge-bleed)) !important;object-fit:cover !important;}
.bg-glow{height:567px !important;}
.asset-logo{position:relative !important;overflow:visible !important;background:transparent !important;border-radius:50% !important;}
.cc-logo{position:relative !important;overflow:hidden !important;background:transparent !important;border-radius:50% !important;}
.asset-logo > img:not(.asset-chain-badge),.cc-logo > img{width:100% !important;height:100% !important;aspect-ratio:1/1 !important;object-fit:cover !important;background:transparent !important;border-radius:50% !important;display:block !important;}
.acc-coin-ic{width:16px !important;height:16px !important;aspect-ratio:1/1 !important;object-fit:cover !important;background:transparent !important;border-radius:50% !important;display:inline-block !important;flex-shrink:0 !important;}
.asset-chain-badge{position:absolute !important;right:-2px !important;bottom:-2px !important;top:auto !important;left:auto !important;width:18px !important;height:18px !important;border-radius:50% !important;background:#0a0a0c !important;padding:0 !important;box-sizing:border-box !important;border:2px solid #0a0a0c !important;object-fit:cover !important;z-index:5 !important;box-shadow:0 2px 6px rgba(0,0,0,0.5) !important;}
.usdt-edit-row{display:flex !important;align-items:center !important;gap:8px !important;}
.usdt-edit-row label{flex-shrink:0 !important;}
.usdt-chain-select{background:#1a1a1f !important;color:#fff !important;border:1px solid #2a2a30 !important;border-radius:8px !important;padding:6px 8px !important;font-size:13px !important;flex-shrink:0 !important;}
.balance-amount{font-size:38px !important;letter-spacing:-1.2px !important;font-weight:700 !important;line-height:1 !important;}
 /* Zoom UI out + extend so it still fills the screen, and add scroll spacing */
 #ptr-wrapper{zoom:0.84 !important;}
 /* Lock the purple background — it must NOT translate when pulling to refresh.
    Keep it BEHIND content (z-index:-1) so it never covers the balance/text. */
 .bg-glow{position:fixed !important;top:0 !important;left:0 !important;right:0 !important;height:567px !important;z-index:-1 !important;pointer-events:none !important;transform:none !important;}
 /* Make sure header/balance text always sits above the fixed bg-glow */
 .header,.balance-section{position:relative !important;z-index:2 !important;}
 /* Kill the backdrop blur on the bottom nav so the PNG renders crisply */
 .bottom-nav,.nav-pill{backdrop-filter:none !important;-webkit-backdrop-filter:none !important;}
 /* Purple pull-to-refresh spinner */
 #pullSpinner .spinner-blade{animation-name:ptr-fade-purple !important;}
 @keyframes ptr-fade-purple{0%{background-color:#BBAEFC}100%{background-color:transparent}}
 /* Tighten gap between promo card and Explore market header */
 .section-header{padding-top:18px !important;}
 /* Smaller explore market cards */
 .explore-row{gap:10px !important;padding-left:16px !important;padding-right:16px !important;scroll-padding-left:16px !important;}
 .explore-row > *{scroll-snap-align:start !important;}
  .explore-card{flex:0 0 95px !important;height:115px !important;padding:10px 6px !important;}
  .quick-actions{gap:10px !important;padding-left:22px !important;padding-right:22px !important;}
  .qa-btn{padding-top:10px !important;padding-bottom:10px !important;font-size:13px !important;}
 .explore-card.coin-card{padding-top:14px !important;gap:6px !important;}
 .cc-logo{width:38px !important;height:38px !important;}
 .cc-name{font-size:13px !important;}
 .cc-pct{font-size:12px !important;}
 /* Smaller Mood card contents to match */
 .mood-gauge{width:48px !important;height:30px !important;margin-bottom:2px !important;}
 .mood-num{font-size:14px !important;}
 .mood-label{font-size:12px !important;margin-top:3px !important;}
 .mood-state{font-size:11px !important;margin-top:1px !important;}
 .asset-list{gap:10px !important;}
 /* Single promo card — slightly wider (less side padding) and a touch taller */
 .promo-single-wrap{padding:22px 10px 8px !important;}
 .promo-single{position:relative;display:flex;align-items:center;justify-content:space-between;background:#16161a;border-radius:14px;padding:10px 14px;min-height:74px;max-height:74px;overflow:hidden;}
 .promo-single .ps-text{flex:1;min-width:0;padding-right:8px;}
 .promo-single .ps-title{color:#fff;font-size:14px;font-weight:700;line-height:1.2;margin-bottom:3px;}
 .promo-single .ps-sub{color:#9a9aa2;font-size:12px;line-height:1.2;}
 .promo-single .ps-art{height:72px !important;width:auto;max-width:44% !important;object-fit:contain;flex-shrink:0;margin-right:6px;}
 .promo-single .ps-close{position:absolute;top:10px;right:10px;background:transparent;border:none;color:#9a9aa2;width:22px;height:22px;padding:0;cursor:pointer;}
 .promo-single .ps-close svg{width:18px;height:18px;}
 /* Assets / Account tabs — rectangular with rounded corners */
 .aa-tabs{border-radius:14px !important;padding:4px !important;gap:4px !important;}
 .aa-tab{border-radius:10px !important;}
 .aa-tab.active{background:rgba(80,80,90,0.55) !important;border-radius:10px !important;}
 /* See-all transactions full-screen overlay (slides in from the right) */
 .txn-all-overlay{position:fixed !important;inset:0 !important;z-index:300 !important;pointer-events:none !important;background:transparent !important;}
 .txn-all-overlay.open{pointer-events:auto !important;}
 .txn-all-screen{position:absolute !important;inset:0 !important;background:#0a0a0c !important;transform:translateX(100%) !important;transition:transform .32s cubic-bezier(.25,1,.5,1) !important;display:flex !important;flex-direction:column !important;overflow:hidden !important;}
 .txn-all-overlay.open .txn-all-screen{transform:translateX(0) !important;}
 .txn-all-header{display:flex !important;align-items:center !important;gap:10px !important;padding:calc(env(safe-area-inset-top,0px) + 14px) 16px 14px !important;flex:none !important;}
 .txn-all-back{width:36px !important;height:36px !important;display:flex !important;align-items:center !important;justify-content:center !important;background:transparent !important;border:none !important;color:#fff !important;padding:0 !important;cursor:pointer !important;}
 .txn-all-back svg{width:22px !important;height:22px !important;}
 .txn-all-title{flex:1 !important;text-align:center !important;color:#fff !important;font-size:18px !important;font-weight:700 !important;letter-spacing:-.3px !important;margin-right:36px !important;}
 .txn-all-spacer{width:0 !important;}
 .txn-all-body{flex:1 1 auto !important;overflow-y:auto !important;-webkit-overflow-scrolling:touch !important;padding:6px 16px calc(40px + env(safe-area-inset-bottom,0px)) !important;}
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
