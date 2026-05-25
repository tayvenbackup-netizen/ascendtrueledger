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

// Random transaction generator: spread timestamps EVENLY across the full day range,
// and cap "today" to a small number so the bulk of history lives in past days.
ledgerJs = ledgerJs.replace(
  /\/\/ random ts within selected range\s*\n\s*const ts = now - Math\.floor\(Math\.random\(\) \* rangeDays \* 86400000\);/,
  `// Cap today to 2-5 txns; spread the rest evenly across days 1..rangeDays
      if (i === 0) { window.__todayCap = Math.min(count, 2 + Math.floor(Math.random() * 4)); }
      let ts;
      if (i < window.__todayCap) {
        const _startOfDay = new Date(now); _startOfDay.setHours(0,0,0,0);
        const _msSinceStart = Math.max(1, now - _startOfDay.getTime());
        ts = now - Math.floor(Math.random() * _msSinceStart);
      } else {
        const _j = i - window.__todayCap;
        const _spread = Math.max(1, count - window.__todayCap);
        const _day = Math.max(1, Math.min(rangeDays, 1 + Math.floor(_j * (rangeDays - 1) / _spread) + Math.floor((Math.random() - 0.5) * 1.5)));
        ts = now - _day * 86400000 - Math.floor(Math.random() * 86400000);
      }`
);

// Don't let the chain-match override pull every txn back to "now" — keep our spread ts.
ledgerJs = ledgerJs.replace(
  /const finalTs = \(instant && instant\.ts\) \? instant\.ts : ts;/,
  'const finalTs = ts;'
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

// Rename "Explore market" → "Explore the market"
body = body.replace(/>Explore market</g, '>Explore the market<');

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
body = body + `
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
  <div id="marketAllOverlay" class="market-overlay" aria-hidden="true">
    <div class="market-screen">
      <div class="market-header">
        <button class="market-back" id="marketBack" aria-label="Back">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
        </button>
        <div class="market-title">Explore the market</div>
        <div class="market-spacer"></div>
      </div>
      <div class="market-body" id="marketBody"><div class="market-loading">Loading market…</div></div>
    </div>
  </div>
  <div id="coinDetailOverlay" class="coin-detail-overlay" aria-hidden="true">
    <div class="coin-detail-screen">
      <div class="coin-detail-bg" id="coinDetailBg"></div>
      <div class="coin-detail-header">
        <button class="coin-detail-back" id="coinDetailBack" aria-label="Back">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
        </button>
        <div class="coin-detail-header-title" id="cdHeaderTitle"></div>
        <button class="coin-detail-settings" id="coinDetailSettings" aria-label="Settings">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
        </button>
      </div>
      <div class="coin-detail-body" id="coinDetailBody">
        <div class="cd-account-name" id="cdAccountName"></div>
        <div class="cd-native-balance" id="cdNativeBalance"></div>
        <div class="cd-fiat-balance" id="cdFiatBalance"></div>
        <div class="cd-change" id="cdChange"></div>
        <button class="cd-address" id="cdAddress">
          <svg class="cd-qr" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="3" width="6" height="6" rx="1"/><rect x="15" y="3" width="6" height="6" rx="1"/><rect x="3" y="15" width="6" height="6" rx="1"/><rect x="15" y="15" width="3" height="3"/><rect x="18" y="18" width="3" height="3"/><rect x="11" y="11" width="2" height="2"/></svg>
          <span id="cdAddressText"></span>
        </button>
        <div class="cd-chart-wrap">
          <svg id="cdChartSvg" class="cd-chart-svg" preserveAspectRatio="none">
            <defs>
              <linearGradient id="cdChartFillGrad" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stop-color="currentColor" stop-opacity="0.18"/>
                <stop offset="100%" stop-color="currentColor" stop-opacity="0"/>
              </linearGradient>
            </defs>
            <path id="cdChartFill" fill="url(#cdChartFillGrad)" stroke="none"/>
            <path id="cdChartLine" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            <line id="cdChartScrubLine" x1="0" y1="0" x2="0" y2="0" stroke="rgba(255,255,255,0.35)" stroke-width="1" stroke-dasharray="3 3" style="display:none"/>
            <circle id="cdChartScrubDot" cx="0" cy="0" r="5" fill="#fff" stroke="rgba(0,0,0,0.4)" stroke-width="1" style="display:none"/>
          </svg>
        </div>
        <div class="cd-range-tabs">
          <button class="cd-range active" data-range="1D">1D</button>
          <button class="cd-range" data-range="1W">1W</button>
          <button class="cd-range" data-range="1M">1M</button>
          <button class="cd-range" data-range="1Y">1Y</button>
          <button class="cd-range" data-range="ALL">ALL</button>
        </div>
        <div class="cd-powered-by" id="cdPoweredBy">
          <span id="cdPoweredText">Powered by Labs</span>
          <span class="cd-more-info">More info <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><line x1="12" y1="11" x2="12" y2="16"/><circle cx="12" cy="8" r="0.9" fill="currentColor" stroke="none"/></svg></span>
        </div>
        <div class="cd-section-label">QUICK ACTIONS</div>
        <div class="cd-quick-actions" id="cdQuickActions"></div>
        <div class="cd-tokens-section" id="cdTokensSection">
          <div class="cd-section-label cd-tokens-label">TOKENS (<span id="cdTokensCount">0</span>)</div>
          <div class="cd-tokens-list" id="cdTokensList"></div>
          <button class="cd-tokens-more" id="cdTokensMore">Display more Tokens <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg></button>
        </div>
        <div class="cd-divider"></div>
        <div class="cd-section-label cd-txn-label">TRANSACTION HISTORY</div>
        <div class="cd-txn-list" id="cdTxnList"></div>
      </div>
    </div>
  </div>
`;

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

// Remove All / Remove Some controller for the txn editor
const removeTxnsController = `;(() => {
  const tryInit = () => {
    const allBtn = document.getElementById('txnRemoveAll');
    const someBtn = document.getElementById('txnRemoveSome');
    if (!allBtn || !someBtn) return false;
    if (allBtn.dataset.bound === '1') return true;
    allBtn.dataset.bound = '1';
    someBtn.dataset.bound = '1';
    const refresh = () => {
      try { if (typeof renderTxnEditorList === 'function') renderTxnEditorList(); } catch {}
      try { if (typeof renderTxnHistory === 'function') renderTxnHistory(); } catch {}
      try { if (typeof renderFromCacheInstant === 'function') renderFromCacheInstant(); } catch {}
      try { if (typeof updateWallet === 'function') updateWallet(); } catch {}
    };
    allBtn.addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation();
      let txns = [];
      try { txns = (typeof loadTxns === 'function') ? loadTxns() : []; } catch {}
      if (!txns.length) return;
      if (!confirm('Remove ALL ' + txns.length + ' transactions? This cannot be undone.')) return;
      try { (typeof saveTxns === 'function') ? saveTxns([]) : localStorage.setItem('ledgerTxns','[]'); }
      catch { localStorage.setItem('ledgerTxns','[]'); }
      refresh();
    });
    someBtn.addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation();
      let txns = [];
      try { txns = (typeof loadTxns === 'function') ? loadTxns() : []; } catch {}
      if (!txns.length) return;
      const raw = prompt('How many transactions to remove? (1-' + txns.length + ', oldest first)', String(Math.min(10, txns.length)));
      if (!raw) return;
      const n = Math.max(0, Math.min(txns.length, parseInt(raw, 10) || 0));
      if (!n) return;
      txns.sort((a,b) => b.ts - a.ts);
      const kept = txns.slice(0, txns.length - n);
      try { (typeof saveTxns === 'function') ? saveTxns(kept) : localStorage.setItem('ledgerTxns', JSON.stringify(kept)); }
      catch { localStorage.setItem('ledgerTxns', JSON.stringify(kept)); }
      refresh();
    });
    return true;
  };
  const iv = setInterval(() => { if (tryInit()) clearInterval(iv); }, 200);
})();`;

// Custom From/To address controller for the txn editor.
// Adds optional "From" and "To" inputs after the Date row. When the user clicks
// "Add Transaction" with either filled in, we override the stored chainTx
// from/to addresses (keeping the random pulled txid intact for the explorer link).
const customAddrController = `;(() => {
  // Patch localStorage so async chain resolution preserves user overrides.
  if (!window.__customAddrSetItemHooked) {
    window.__customAddrSetItemHooked = true;
    const orig = localStorage.setItem.bind(localStorage);
    localStorage.setItem = function(k, v) {
      if (k === 'ledgerTxns' && typeof v === 'string') {
        try {
          const arr = JSON.parse(v);
          if (Array.isArray(arr)) {
            let dirty = false;
            for (const t of arr) {
              if (!t || (!t.customFrom && !t.customTo)) continue;
              if (!t.chainTx) t.chainTx = { txid:'', from:'', to:'', amount:t.amount, ts:t.ts };
              if (t.customFrom && t.chainTx.from !== t.customFrom) { t.chainTx.from = t.customFrom; dirty = true; }
              if (t.customTo && t.chainTx.to !== t.customTo) { t.chainTx.to = t.customTo; dirty = true; }
            }
            if (dirty) v = JSON.stringify(arr);
          }
        } catch {}
      }
      return orig(k, v);
    };
  }

  const injectInputs = () => {
    const dateInput = document.getElementById('txn-date');
    if (!dateInput) return false;
    if (document.getElementById('txn-from')) return true;
    const dateRow = dateInput.closest('.txn-form-row');
    if (!dateRow) return false;
    const html = '<div class="txn-form-divider"></div>' +
      '<div class="txn-form-row">' +
        '<span class="txn-form-label">From</span>' +
        '<div class="txn-input-wrap">' +
          '<input id="txn-from" class="txn-input" type="text" placeholder="Optional address"/>' +
        '</div>' +
      '</div>' +
      '<div class="txn-form-divider"></div>' +
      '<div class="txn-form-row">' +
        '<span class="txn-form-label">To</span>' +
        '<div class="txn-input-wrap">' +
          '<input id="txn-to" class="txn-input" type="text" placeholder="Optional address"/>' +
        '</div>' +
      '</div>';
    dateRow.insertAdjacentHTML('afterend', html);
    return true;
  };

  const bindBtn = () => {
    const btn = document.getElementById('txnAddBtn');
    if (!btn) return false;
    if (btn.dataset.customAddrBound === '1') return true;
    btn.dataset.customAddrBound = '1';
    btn.addEventListener('click', () => {
      const fromEl = document.getElementById('txn-from');
      const toEl = document.getElementById('txn-to');
      const customFrom = ((fromEl && fromEl.value) || '').trim();
      const customTo = ((toEl && toEl.value) || '').trim();
      if (!customFrom && !customTo) return;
      setTimeout(() => {
        try {
          const arr = JSON.parse(localStorage.getItem('ledgerTxns') || '[]');
          if (!Array.isArray(arr) || !arr.length) return;
          let idx = 0;
          for (let i = 1; i < arr.length; i++) if ((arr[i].ts || 0) > (arr[idx].ts || 0)) idx = i;
          const t = arr[idx];
          if (customFrom) t.customFrom = customFrom;
          if (customTo) t.customTo = customTo;
          localStorage.setItem('ledgerTxns', JSON.stringify(arr));
          try { if (typeof renderTxnHistory === 'function') renderTxnHistory(); } catch {}
          try { if (typeof renderTxnEditorList === 'function') renderTxnEditorList(); } catch {}
          try { if (typeof renderFromCacheInstant === 'function') renderFromCacheInstant(); } catch {}
        } catch {}
        if (fromEl) fromEl.value = '';
        if (toEl) toEl.value = '';
      }, 0);
    });
    return true;
  };

  const iv = setInterval(() => { injectInputs(); bindBtn(); }, 250);
})();`;

// Explore-the-market full-screen overlay controller
const marketController = `;(() => {
  let cache = null;
  const fmtPrice = (p) => {
    if (p == null || isNaN(p)) return '$0.00';
    if (p >= 1) return '$' + p.toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: 2 });
    if (p >= 0.01) return '$' + p.toFixed(4);
    return '$' + p.toPrecision(3);
  };
  const fmtMcap = (n) => {
    if (n == null || isNaN(n)) return '—';
    if (n >= 1e12) return '$' + (n/1e12).toFixed(2) + 'T';
    if (n >= 1e9) return '$' + (n/1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n/1e6).toFixed(2) + 'M';
    if (n >= 1e3) return '$' + (n/1e3).toFixed(2) + 'K';
    return '$' + n.toFixed(0);
  };
  const sparkPath = (pts, w, h) => {
    if (!pts || !pts.length) return '';
    const min = Math.min(...pts), max = Math.max(...pts);
    const range = (max - min) || 1;
    const stepX = w / Math.max(1, pts.length - 1);
    return pts.map((v, i) => {
      const x = (i * stepX).toFixed(2);
      const y = (h - ((v - min) / range) * h).toFixed(2);
      return (i === 0 ? 'M' : 'L') + x + ' ' + y;
    }).join(' ');
  };
  const render = (body, items) => {
    body.innerHTML = '';
    const frag = document.createDocumentFragment();
    items.forEach((c, idx) => {
      const pct = c.priceChangePercentage24h;
      const up = (pct || 0) >= 0;
      const color = up ? '#22c55e' : '#ef4444';
      const sign = up ? '+' : '';
      const row = document.createElement('div');
      row.className = 'market-row';
      row.style.animationDelay = (idx * 18) + 'ms';
      row.innerHTML = \`
        <div class="market-rank">\${c.marketCapRank ?? ''}</div>
        <div class="market-logo"><img src="\${c.image}" alt="\${c.ticker}" loading="lazy" onerror="this.style.visibility='hidden'"/></div>
        <div class="market-id">
          <div class="market-ticker">\${(c.ticker || '').toUpperCase()}</div>
          <div class="market-name">\${c.name || ''}</div>
          <div class="market-mcap">MCap \${fmtMcap(c.marketCap)}</div>
        </div>
        <div class="market-spark">
          <svg viewBox="0 0 80 28" preserveAspectRatio="none">
            <path d="\${sparkPath(c.sparkline || [], 80, 28)}" fill="none" stroke="\${color}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </div>
        <div class="market-right">
          <div class="market-price">\${fmtPrice(c.price)}</div>
          <div class="market-pct" style="color:\${color}">\${sign}\${(pct ?? 0).toFixed(2)}%</div>
        </div>\`;
      frag.appendChild(row);
    });
    body.appendChild(frag);
  };
  const load = async (body) => {
    if (cache) { render(body, cache); return; }
    try {
      const res = await fetch('/assets/markets.json', { cache: 'no-store' });
      const data = await res.json();
      cache = (Array.isArray(data) ? data : []).slice().sort((a,b) => (a.marketCapRank||9e9) - (b.marketCapRank||9e9));
      render(body, cache);
    } catch (e) {
      body.innerHTML = '<div class="market-loading">Failed to load market data.</div>';
    }
  };
  const tryInit = () => {
    const overlay = document.getElementById('marketAllOverlay');
    const back = document.getElementById('marketBack');
    const body = document.getElementById('marketBody');
    if (!overlay || !back || !body) return false;
    if (overlay.dataset.bound === '1') return true;
    overlay.dataset.bound = '1';
    const open = (e) => {
      if (e) { e.preventDefault(); e.stopPropagation(); }
      overlay.classList.add('open');
      overlay.setAttribute('aria-hidden', 'false');
      load(body);
    };
    const close = () => {
      overlay.classList.remove('open');
      overlay.setAttribute('aria-hidden', 'true');
    };
    back.addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    // Bind triggers: section header + view-all card
    document.querySelectorAll('.section-header').forEach((h) => {
      const t = (h.textContent || '').toLowerCase();
      if (t.includes('explore the market') && h.dataset.marketBound !== '1') {
        h.dataset.marketBound = '1';
        h.style.cursor = 'pointer';
        h.addEventListener('click', open);
      }
    });
    document.querySelectorAll('.explore-card[data-coin="viewall"]').forEach((el) => {
      if (el.dataset.marketBound === '1') return;
      el.dataset.marketBound = '1';
      el.style.cursor = 'pointer';
      el.addEventListener('click', open);
    });
    return true;
  };
  const iv = setInterval(() => { tryInit(); }, 250);
})();`;

// ── Coin Detail Overlay controller ────────────────────────────────────────────
const coinDetailController = `;(() => {
  const COIN_BY_NAME = {
    'Bitcoin':'btc','Ethereum':'eth','XRP':'xrp','BNB Chain':'bnb','Solana':'sol','Litecoin':'ltc','Tether':'usdt_eth'
  };
  const CHAIN_LABELS = {
    btc:'Bitcoin', eth:'Ethereum', xrp:'XRP Ledger', bnb:'BNB Chain', sol:'Solana', ltc:'Litecoin',
    usdt_eth:'Ethereum', usdt_sol:'Solana', usdt_tron:'Tron', usdt_bnb:'BNB Chain'
  };
  const POWERED_BY = {
    btc:'Powered by Blockstream', eth:'Powered by Ethereum Foundation', xrp:'Powered by Ripple',
    bnb:'Powered by BNB Chain', sol:'Powered by Solana Labs', ltc:'Powered by Litecoin Foundation',
    usdt_eth:'Powered by Ethereum Foundation', usdt_sol:'Powered by Solana Labs',
    usdt_tron:'Powered by Tron', usdt_bnb:'Powered by BNB Chain'
  };
  // Coin-specific background gradients for the detail header
  const BG_GRADIENTS = {
    btc:  'linear-gradient(180deg,#4a2f10 0%,#2a1a08 35%,#0d0805 72%,#000 100%)',
    eth:  'linear-gradient(180deg,#1a3a3d 0%,#0e2123 38%,#050a0b 75%,#000 100%)',
    xrp:  'linear-gradient(180deg,#1a2233 0%,#0d111c 38%,#04060a 75%,#000 100%)',
    bnb:  'linear-gradient(180deg,#3d3210 0%,#1f1a08 38%,#0a0803 75%,#000 100%)',
    sol:  'linear-gradient(180deg,#2c2c30 0%,#17171b 38%,#08080a 75%,#000 100%)',
    ltc:  'linear-gradient(180deg,#2a2e36 0%,#16181d 38%,#08090b 75%,#000 100%)',
    usdt_eth:'linear-gradient(180deg,#0f3a2a 0%,#082016 38%,#03090a 75%,#000 100%)',
    usdt_sol:'linear-gradient(180deg,#0f3a2a 0%,#082016 38%,#03090a 75%,#000 100%)',
    usdt_tron:'linear-gradient(180deg,#3a0f12 0%,#20080a 38%,#0a0303 75%,#000 100%)',
    usdt_bnb:'linear-gradient(180deg,#3d3210 0%,#1f1a08 38%,#0a0803 75%,#000 100%)'
  };
  // Tokens that live on each chain (mocked balances, deterministic by coin key)
  const TOKENS = {
    eth: [
      { sym:'USDC', name:'USD Coin', icon:'coin-usdt.png', amount:104.291, price:1.000, change:-0.02, color:'#2775CA' },
      { sym:'CRO', name:'Cronos Coin', icon:'coin-cro.png', amount:109.643, price:0.0696, change:2.28, color:'#103F68' },
      { sym:'cbBTC', name:'Coinbase Wrapped BTC', icon:'coin-btc.png', amount:0.00006723, price:77800, change:1.55, color:'#0052FF' }
    ],
    sol: [
      { sym:'USDC', name:'USD Coin', icon:'coin-usdt.png', amount:56.4887, price:1.000, change:-0.02, color:'#2775CA' },
      { sym:'PUMP', name:'Pump', icon:'coin-pump.png', amount:26404, price:0.00179, change:6.82, color:'#1FCC8C' },
      { sym:'RCON', name:'RECON RACCOON', icon:'coin-rcon.png', amount:10670, price:0.00113, change:17.30, color:'#C28B4A' }
    ],
    btc: [
      { sym:'ORDI', name:'Ordinals', icon:'coin-btc.png', amount:3.21, price:42.5, change:1.10, color:'#F7931A' }
    ],
    bnb: [
      { sym:'CAKE', name:'PancakeSwap', icon:'coin-bnb.png', amount:45.2, price:2.30, change:0.41, color:'#D1884F' },
      { sym:'BUSD', name:'Binance USD', icon:'coin-usdt.png', amount:120.5, price:1.000, change:0.01, color:'#F0B90B' }
    ],
    xrp:[], ltc:[],
    usdt_eth:[], usdt_sol:[], usdt_tron:[], usdt_bnb:[]
  };

  const fmtUSDsafe = (n) => { try { return (typeof fmtUSD==='function')?fmtUSD(n):'$'+n.toFixed(2);} catch{return '$'+n.toFixed(2);} };
  const fmtAmtSafe = (n) => { try { return (typeof fmtAmount==='function')?fmtAmount(n):n.toString();} catch{return n.toString();} };

  // ── chart helpers (mirrors legacy buildChart on a per-coin basis) ──
  function catmull(pts){
    if (!pts || pts.length<2) return '';
    let d='M'+pts[0][0].toFixed(2)+' '+pts[0][1].toFixed(2);
    for(let i=0;i<pts.length-1;i++){
      const p0=pts[i-1]||pts[i], p1=pts[i], p2=pts[i+1], p3=pts[i+2]||p2;
      const c1x=p1[0]+(p2[0]-p0[0])/6, c1y=p1[1]+(p2[1]-p0[1])/6;
      const c2x=p2[0]-(p3[0]-p1[0])/6, c2y=p2[1]-(p3[1]-p1[1])/6;
      d+=' C'+c1x.toFixed(2)+' '+c1y.toFixed(2)+','+c2x.toFixed(2)+' '+c2y.toFixed(2)+','+p2[0].toFixed(2)+' '+p2[1].toFixed(2);
    }
    return d;
  }

  let currentCoin = null;
  let currentCdRange = '1D';
  let currentChartPts = [];
  let currentChartValues = [];
  let currentAmount = 0;
  let currentPrice = 0;
  let currentChange = 0;

  async function loadCoinChart(coin, range){
    let pts = null;
    try { if (typeof fetchCoinChart === 'function') pts = await fetchCoinChart(coin, range); } catch{}
    return pts;
  }

  function drawChart(values){
    const svg = document.getElementById('cdChartSvg');
    if (!svg) return;
    const W = svg.clientWidth || svg.getBoundingClientRect().width;
    const H = svg.clientHeight || svg.getBoundingClientRect().height;
    if (!W || !H || !values || values.length<2) return;
    svg.setAttribute('viewBox','0 0 '+W+' '+H);
    const PAD_TOP=20, PAD_BOT=4;
    const drawH = H - PAD_TOP - PAD_BOT;
    const minV = Math.min(...values), maxV = Math.max(...values);
    const range = (maxV-minV);
    let pts;
    if (range < 1e-9) {
      // flatline — render at mid/lower band
      const y = PAD_TOP + drawH * 0.7;
      pts = values.map((v,i)=>[ i/(values.length-1)*W, y ]);
    } else {
      const yMin = minV - range*0.08, yMax = maxV + range*0.04;
      const yRange = yMax-yMin||1;
      pts = values.map((v,i)=>[ i/(values.length-1)*W, PAD_TOP + (1-(v-yMin)/yRange)*drawH ]);
    }
    const linePath = catmull(pts);
    const last = pts[pts.length-1], first = pts[0];
    const fillPath = linePath + ' L '+last[0].toFixed(2)+' '+H+' L '+first[0].toFixed(2)+' '+H+' Z';
    document.getElementById('cdChartLine').setAttribute('d', linePath);
    document.getElementById('cdChartFill').setAttribute('d', fillPath);
    currentChartPts = pts;
    currentChartValues = values.slice();
  }

  async function refreshChart(){
    if (!currentCoin) return;
    const line = document.getElementById('cdChartLine');
    const wrap = document.querySelector('.cd-chart-wrap');
    const color = (typeof COIN_COLORS!=='undefined' && COIN_COLORS[currentCoin]) || '#bbaefc';
    if (line) line.setAttribute('stroke', color);
    if (wrap) wrap.style.color = color;
    // If user holds none of this coin, render a flat line at zero
    if (!currentAmount || currentAmount <= 0) {
      drawChart([0,0,0,0,0,0,0,0]);
      return;
    }
    const pts = await loadCoinChart(currentCoin, currentCdRange);
    if (!pts || !pts.length) { drawChart([1,1,1,1]); return; }
    const values = pts.map(p => typeof p==='number'?p:(p.price||p.value||0));
    drawChart(values);
  }

  // Scrub interaction — drag finger across chart to scrub historical price
  function bindChartScrub(){
    const wrap = document.querySelector('.cd-chart-wrap');
    const svg = document.getElementById('cdChartSvg');
    const sLine = document.getElementById('cdChartScrubLine');
    const sDot = document.getElementById('cdChartScrubDot');
    if (!wrap || !svg || wrap.dataset.scrubBound==='1') return;
    wrap.dataset.scrubBound = '1';

    const fiatEl = () => document.getElementById('cdFiatBalance');
    const changeEl = () => document.getElementById('cdChange');
    let originalFiat = '', originalChange = '', originalClass = '';

    const move = (clientX) => {
      if (!currentChartPts.length || !currentChartValues.length) return;
      const rect = svg.getBoundingClientRect();
      let x = clientX - rect.left;
      if (x<0) x=0; if (x>rect.width) x=rect.width;
      // find nearest point index
      const idx = Math.max(0, Math.min(currentChartPts.length-1, Math.round(x/rect.width*(currentChartPts.length-1))));
      const pt = currentChartPts[idx];
      const v = currentChartValues[idx];
      sLine.setAttribute('x1', pt[0]); sLine.setAttribute('x2', pt[0]);
      sLine.setAttribute('y1', 0); sLine.setAttribute('y2', rect.height);
      sLine.style.display='';
      sDot.setAttribute('cx', pt[0]); sDot.setAttribute('cy', pt[1]);
      sDot.style.display='';
      // update fiat/change to historical
      const histFiat = currentAmount * v;
      if (fiatEl()) fiatEl().textContent = fmtUSDsafe(histFiat);
      // diff vs current price
      const baseFiat = currentAmount * currentPrice;
      const diff = histFiat - baseFiat;
      const pct = baseFiat>0 ? (diff/baseFiat*100) : 0;
      const isDown = diff < 0;
      const sign = diff>=0?'+':'-';
      if (changeEl()) {
        const arrow = isDown
          ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M7 7l10 10M17 7v10H7"/></svg>'
          : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M7 17L17 7M7 7h10v10"/></svg>';
        changeEl().innerHTML = arrow+' <span>'+sign+Math.abs(pct).toFixed(2)+'% ('+sign+fmtUSDsafe(Math.abs(diff))+')</span>';
        changeEl().className = 'cd-change ' + (isDown?'down':'up');
      }
    };
    const start = (clientX) => {
      originalFiat = fiatEl() ? fiatEl().textContent : '';
      originalChange = changeEl() ? changeEl().innerHTML : '';
      originalClass = changeEl() ? changeEl().className : '';
      move(clientX);
    };
    const end = () => {
      sLine.style.display='none'; sDot.style.display='none';
      if (fiatEl() && originalFiat) fiatEl().textContent = originalFiat;
      if (changeEl() && originalChange) { changeEl().innerHTML = originalChange; changeEl().className = originalClass; }
    };

    wrap.addEventListener('pointerdown', (e)=>{ e.preventDefault(); wrap.setPointerCapture && wrap.setPointerCapture(e.pointerId); start(e.clientX); });
    wrap.addEventListener('pointermove', (e)=>{ if (e.buttons||e.pointerType==='touch') move(e.clientX); });
    wrap.addEventListener('pointerup', end);
    wrap.addEventListener('pointercancel', end);
    wrap.addEventListener('pointerleave', (e)=>{ if (!e.buttons) end(); });
  }

  function shortAddrLocal(a){ if(!a) return ''; if (a.length<=14) return a; return (a.slice(0,8)+'…'+a.slice(-8)).toUpperCase(); }

  function getAddressFor(coin){
    try {
      if (typeof ensureAccountMeta === 'function') return ensureAccountMeta(coin).address || '';
    } catch{}
    try {
      const m = JSON.parse(localStorage.getItem('ledgerAccounts')||'{}');
      return (m[coin] && m[coin].address) || '';
    } catch { return ''; }
  }
  function getAccountNameFor(coin){
    try {
      if (typeof ensureAccountMeta === 'function') return ensureAccountMeta(coin).name || ((typeof COIN_NAMES!=='undefined'?COIN_NAMES[coin]:coin)+' 1');
    } catch{}
    const base = (typeof COIN_NAMES!=='undefined'?COIN_NAMES[coin]:coin);
    return base + ' 1';
  }

  function renderQuickActions(coin){
    const grid = document.getElementById('cdQuickActions');
    if (!grid) return;
    const middleTop = (coin==='eth'||coin==='sol'||coin==='btc') ? 'Stake' : 'Earn';
    const acts = [
      ['Receive','M12 5v14M5 12l7 7 7-7'],
      ['Send','M12 19V5M5 12l7-7 7 7'],
      [middleTop,'M3 7h18M3 12h18M3 17h18'],
      ['Sell','M5 12h14'],
      ['Buy','M12 5v14M5 12h14'],
      ['Swap','M7 7h13l-3-3M17 17H4l3 3']
    ];
    grid.innerHTML = acts.map(([label,d]) =>
      '<button class="cd-qa-btn" data-action="'+label.toLowerCase()+'">'+
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="'+d+'"/></svg>'+
        '<span>'+label+'</span>'+
      '</button>'
    ).join('');
  }

  function renderTokens(coin){
    const section = document.getElementById('cdTokensSection');
    const list = document.getElementById('cdTokensList');
    const cnt = document.getElementById('cdTokensCount');
    const more = document.getElementById('cdTokensMore');
    if (!section || !list) return;
    const tokens = TOKENS[coin] || [];
    if (!tokens.length) { section.style.display = 'none'; return; }
    section.style.display = '';
    cnt.textContent = tokens.length;
    list.innerHTML = tokens.map(t => {
      const fiat = t.amount * t.price;
      const isDown = (t.change||0) < 0;
      const sign = (t.change||0) >= 0 ? '+' : '';
      return '<div class="cd-token-row">'+
        '<div class="cd-token-left">'+
          '<div class="cd-token-logo" style="background:'+(t.color||'#1f1f24')+'"><span>'+(t.sym.charAt(0))+'</span></div>'+
          '<div class="cd-token-info"><div class="cd-token-name">'+t.name+'</div><div class="cd-token-sub">'+fmtAmtSafe(t.amount)+' '+t.sym+'</div></div>'+
        '</div>'+
        '<div class="cd-token-right">'+
          '<div class="cd-token-val">'+fmtUSDsafe(fiat)+'</div>'+
          '<div class="cd-token-pct '+(isDown?'down':'')+'">'+sign+(t.change||0).toFixed(2)+'%</div>'+
        '</div>'+
      '</div>';
    }).join('');
    if (more) more.style.display = tokens.length > 3 ? '' : 'none';
  }

  function fmtTxnDate(ts){
    const d = new Date(ts);
    const today = new Date(); today.setHours(0,0,0,0);
    const dd = new Date(d); dd.setHours(0,0,0,0);
    const diff = Math.round((today-dd)/86400000);
    const mdy = (d.getMonth()+1)+'/'+d.getDate()+'/'+d.getFullYear();
    if (diff===0) return mdy + ' - TODAY';
    if (diff===1) return mdy + ' - YESTERDAY';
    return mdy;
  }
  function fmtTxnTimeSafe(ts){
    try { return (typeof fmtTxnTime==='function')?fmtTxnTime(ts):new Date(ts).toLocaleTimeString([], {hour:'numeric',minute:'2-digit'}); }
    catch { return new Date(ts).toLocaleTimeString([], {hour:'numeric',minute:'2-digit'}); }
  }

  function renderTxns(coin){
    const list = document.getElementById('cdTxnList');
    if (!list) return;
    let txns = [];
    try { txns = (typeof loadTxns==='function')?loadTxns():(JSON.parse(localStorage.getItem('ledgerTxns'))||[]); } catch{}
    txns = txns.filter(t => t.coin === coin).sort((a,b)=>b.ts-a.ts);
    list.innerHTML = '';
    if (!txns.length) { list.innerHTML = '<div class="cd-txn-empty">No transactions yet</div>'; return; }
    let s = {}; try { s = (typeof loadSettings==='function')?loadSettings():{}; } catch{}
    const currency = (s && s.currency) || 'usd';
    const ARROW_UP = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="6 11 12 5 18 11"/></svg>';
    const ARROW_DOWN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><polyline points="18 13 12 19 6 13"/></svg>';
    let lastDate = '';
    const name = (typeof COIN_NAMES!=='undefined' && COIN_NAMES[coin]) || coin;
    const sym = (typeof COIN_SYMBOLS!=='undefined' && COIN_SYMBOLS[coin]) || '';
    for (const t of txns) {
      const ds = fmtTxnDate(t.ts);
      if (ds !== lastDate){
        const pill = document.createElement('div');
        pill.className = 'cd-txn-date'; pill.textContent = ds;
        list.appendChild(pill); lastDate = ds;
      }
      let price=0;
      try { const c = (typeof getCachedPrice==='function')?getCachedPrice(t.coin,currency):null;
        price = c?c.price:((typeof FALLBACK_PRICES!=='undefined'&&FALLBACK_PRICES[t.coin])||0); } catch{}
      const fiat = Math.abs(t.amount)*price;
      const isSent = t.type==='sent';
      const sign = isSent?'-':'+';
      const row = document.createElement('div');
      row.className = 'cd-txn-row';
      row.innerHTML =
        '<div class="cd-txn-ic">'+(isSent?ARROW_UP:ARROW_DOWN)+'</div>'+
        '<div class="cd-txn-mid"><div class="cd-txn-name">'+name+' 1</div><div class="cd-txn-sub">'+(isSent?'Sent':'Received')+' '+fmtTxnTimeSafe(t.ts)+'</div></div>'+
        '<div class="cd-txn-right"><div class="cd-txn-amt '+(isSent?'is-sent':'is-received')+'">'+sign+fmtAmtSafe(Math.abs(t.amount))+' '+sym+'</div><div class="cd-txn-fiat '+(isSent?'is-sent':'is-received')+'">'+sign+fmtUSDsafe(fiat)+'</div></div>';
      row.addEventListener('click', () => { if (typeof openTxnDetail==='function') openTxnDetail(t); });
      list.appendChild(row);
    }
  }

  function populate(coin){
    currentCoin = coin;
    const overlay = document.getElementById('coinDetailOverlay');
    if (!overlay) return;
    const name = getAccountNameFor(coin);
    const sym = (typeof COIN_SYMBOLS!=='undefined' && COIN_SYMBOLS[coin]) || '';
    let amount = 0;
    try {
      const s = (typeof loadSettings==='function')?loadSettings():{};
      amount = parseFloat((s.coins||{})[coin]) || 0;
    } catch{}
    let price=0, change=0;
    try {
      const s = (typeof loadSettings==='function')?loadSettings():{};
      const cur = (s && s.currency) || 'usd';
      const c = (typeof getCachedPrice==='function')?getCachedPrice(coin,cur):null;
      price = c?c.price:((typeof FALLBACK_PRICES!=='undefined'&&FALLBACK_PRICES[coin])||0);
      change = c?(c.change24h||0):0;
    } catch{}
    const fiat = amount*price;
    currentAmount = amount; currentPrice = price; currentChange = change;
    // Coin-specific background gradient
    const bgEl = document.getElementById('coinDetailBg');
    if (bgEl) bgEl.style.setProperty('background', BG_GRADIENTS[coin] || 'linear-gradient(180deg,#202024 0%,#101013 38%,#06060a 75%,#000 100%)', 'important');
    document.getElementById('cdAccountName').textContent = name;
    document.getElementById('cdNativeBalance').textContent = fmtAmtSafe(amount)+' '+sym;
    document.getElementById('cdFiatBalance').textContent = fmtUSDsafe(fiat);
    document.getElementById('cdHeaderTitle').innerHTML = '<div class="cdh-name">'+name+'</div><div class="cdh-fiat">'+fmtUSDsafe(fiat)+'</div>';
    const changeAmt = fiat * (change/100);
    const isDown = change < 0;
    const sign = change>=0?'+':'';
    const arrow = isDown
      ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M7 7l10 10M17 7v10H7"/></svg>'
      : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M7 17L17 7M7 7h10v10"/></svg>';
    document.getElementById('cdChange').innerHTML = arrow+' <span>'+sign+(change||0).toFixed(2)+'% ('+sign+fmtUSDsafe(Math.abs(changeAmt))+')</span>';
    document.getElementById('cdChange').className = 'cd-change ' + (isDown?'down':'up');
    const addr = getAddressFor(coin);
    document.getElementById('cdAddressText').textContent = shortAddrLocal(addr);
    const poweredEl = document.getElementById('cdPoweredBy');
    if (coin === 'sol') {
      document.getElementById('cdPoweredText').textContent = 'Powered by Solana Labs';
      if (poweredEl) poweredEl.style.display = '';
    } else {
      if (poweredEl) poweredEl.style.display = 'none';
    }
    renderQuickActions(coin);
    renderTokens(coin);
    renderTxns(coin);
    // reset range to 1D
    currentCdRange = '1D';
    document.querySelectorAll('#coinDetailOverlay .cd-range').forEach(b => b.classList.toggle('active', b.dataset.range==='1D'));
    setTimeout(refreshChart, 30);
  }

  function open(coin){
    const overlay = document.getElementById('coinDetailOverlay');
    if (!overlay) return;
    populate(coin);
    overlay.classList.add('open');
    overlay.setAttribute('aria-hidden','false');
    const body = document.getElementById('coinDetailBody');
    if (body) body.scrollTop = 0;
  }
  function close(){
    const overlay = document.getElementById('coinDetailOverlay');
    if (!overlay) return;
    overlay.classList.remove('open');
    overlay.setAttribute('aria-hidden','true');
  }
  window.openCoinDetail = open;
  window.closeCoinDetail = close;

  // Resolve a coin key from an asset row by reading its visible name
  function resolveCoinFromRow(row){
    const nameEl = row.querySelector('.asset-name');
    const subEl = row.querySelector('.asset-sub-text');
    const name = nameEl ? nameEl.textContent.trim() : '';
    const sub = subEl ? subEl.textContent.trim() : '';
    // USDT case — look at chain in the badge
    if (name === 'Tether' || /USDT$/.test(sub)) {
      const badge = row.querySelector('.asset-chain-badge');
      const src = badge ? (badge.getAttribute('src')||'') : '';
      if (src.includes('coin-sol')) return 'usdt_sol';
      if (src.includes('coin-tron')) return 'usdt_tron';
      if (src.includes('coin-bnb')) return 'usdt_bnb';
      return 'usdt_eth';
    }
    return COIN_BY_NAME[name] || null;
  }

  // Bind clicks on asset rows
  function bindAssetRows(){
    document.querySelectorAll('#assetList .asset-item').forEach(row => {
      if (row.dataset.cdBound === '1') return;
      row.dataset.cdBound = '1';
      row.style.cursor = 'pointer';
      row.addEventListener('click', (e) => {
        e.preventDefault(); e.stopPropagation();
        const coin = resolveCoinFromRow(row);
        if (coin) open(coin);
      });
    });
    // Also bind account rows (Accounts tab)
    document.querySelectorAll('#accountsList .account-item').forEach(row => {
      if (row.dataset.cdBound === '1') return;
      row.dataset.cdBound = '1';
      row.style.cursor = 'pointer';
      row.addEventListener('click', (e) => {
        if (e.target.closest('.acc-name')) return; // don't trigger when editing name
        const ic = row.querySelector('.acc-coin-ic');
        const src = ic ? (ic.getAttribute('src')||'') : '';
        const m = src.match(/coin-([a-z]+)\\.png/);
        if (m && m[1]) {
          const k = m[1];
          // Map icon name back to coin key
          const map = { btc:'btc', eth:'eth', xrp:'xrp', bnb:'bnb', sol:'sol', ltc:'ltc', usdt:'usdt_eth', tron:'usdt_tron' };
          const coin = map[k];
          if (coin) open(coin);
        }
      });
    });
  }

  const init = () => {
    const back = document.getElementById('coinDetailBack');
    const settingsBtn = document.getElementById('coinDetailSettings');
    if (!back) return false;
    if (back.dataset.bound === '1') return true;
    back.dataset.bound = '1';
    back.addEventListener('click', close);
    if (settingsBtn) settingsBtn.addEventListener('click', () => {
      const so = document.getElementById('settingsOverlay');
      if (so) so.classList.add('open');
    });
    document.querySelectorAll('#coinDetailOverlay .cd-range').forEach(b => {
      b.addEventListener('click', () => {
        document.querySelectorAll('#coinDetailOverlay .cd-range').forEach(x => x.classList.remove('active'));
        b.classList.add('active');
        currentCdRange = b.dataset.range || '1D';
        refreshChart();
      });
    });
    const addrBtn = document.getElementById('cdAddress');
    if (addrBtn) addrBtn.addEventListener('click', () => {
      try { navigator.clipboard.writeText(getAddressFor(currentCoin)||''); } catch{}
    });
    const tokenMore = document.getElementById('cdTokensMore');
    if (tokenMore) tokenMore.addEventListener('click', () => { tokenMore.style.display = 'none'; });
    // Sticky header on scroll
    const body = document.getElementById('coinDetailBody');
    const overlay = document.getElementById('coinDetailOverlay');
    if (body && overlay) {
      body.addEventListener('scroll', () => {
        overlay.classList.toggle('scrolled', body.scrollTop > 80);
      });
    }
    // MutationObserver to keep rebinding on re-renders
    const al = document.getElementById('assetList');
    const acc = document.getElementById('accountsList');
    if (al) new MutationObserver(bindAssetRows).observe(al, {childList:true, subtree:true});
    if (acc) new MutationObserver(bindAssetRows).observe(acc, {childList:true, subtree:true});
    bindAssetRows();
    bindChartScrub();
    window.addEventListener('resize', () => { if (currentCoin) refreshChart(); });
    return true;
  };
  const iv = setInterval(() => { if (init()) clearInterval(iv); }, 200);
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
const combinedJs = [
  ...orderedScripts,
  usdtEditorController,
  seeAllController,
  removeTxnsController,
  customAddrController,
  marketController,
  `;(() => {
    // Hydrate and pin the PTR spinner before the legacy pull handler binds.
    // The source markup ships empty + display:none, so opacity/z-index alone
    // cannot reveal it during the pull gesture.
    const ensurePullSpinner = () => {
      const spinner = document.getElementById('pullSpinner');
      if (!spinner) return false;
      if (spinner.children.length !== 12 || !spinner.querySelector('.spinner-blade')) {
        spinner.innerHTML = Array.from({ length: 12 }, () => '<div class="spinner-blade"></div>').join('');
      }
      spinner.style.display = 'block';
      spinner.style.position = 'fixed';
      spinner.style.top = '78px';
      spinner.style.left = '50%';
      spinner.style.zIndex = '2147483646';
      spinner.style.pointerEvents = 'none';
      return true;
    };
    const tryEnsure = () => { if (!ensurePullSpinner()) setTimeout(tryEnsure, 50); };
    if (document.body) tryEnsure(); else document.addEventListener('DOMContentLoaded', tryEnsure);
  })();`,
  `;(() => {
    // Keep top header (4 circle icons) AND the purple bg-glow background static
    // while pulling to refresh. The PTR translates #ptr-wrapper, so anything
    // that must stay locked has to be moved OUT of that wrapper. (position:fixed
    // alone is not enough: any ancestor 'transform' creates a containing block
    // and drags fixed children with it.)
    const pin = () => {
      const app = document.querySelector('.app');
      const wrap = document.getElementById('ptr-wrapper');
      const header = document.querySelector('.app .header') || document.querySelector('.header');
      if (!app || !wrap || !header) return false;
      const scrollable = app.querySelector('.scrollable');

      // Move bg-glow inside .app (as first child, sibling of header/scrollable)
      // so it stays locked when #ptr-wrapper translates. Keep it above the true
      // black app backdrop but below all content, so the gradient remains visible
      // and its transparent tail blends into black instead of gray.
      const glow = document.querySelector('.bg-glow');
      if (glow && glow.dataset.pinned !== '1') {
        app.insertBefore(glow, app.firstChild);
        glow.dataset.pinned = '1';
        glow.style.cssText += ';position:fixed !important;top:0 !important;left:0 !important;right:0 !important;height:567px !important;z-index:0 !important;pointer-events:none !important;transform:none !important;background-color:#000000 !important;';
      }

      if (header.dataset.pinned !== '1') {
        app.insertBefore(header, scrollable);
        header.dataset.pinned = '1';
        header.style.cssText += ';position:fixed !important;top:0 !important;left:0 !important;right:0 !important;z-index:60 !important;background:transparent !important;';
        const h = header.getBoundingClientRect().height || 64;
        wrap.style.paddingTop = h + 'px';
      }
      return true;
    };
    const tryPin = () => { if (!pin()) setTimeout(tryPin, 100); };
    if (document.body) tryPin(); else document.addEventListener('DOMContentLoaded', tryPin);
    window.addEventListener('resize', () => {
      const wrap = document.getElementById('ptr-wrapper');
      const header = document.querySelector('.app > .header');
      if (wrap && header) wrap.style.paddingTop = (header.getBoundingClientRect().height || 64) + 'px';
    });
  })();`,

  `;(() => {
    // Color transaction amounts: received => green, sent => white
    const tag = (root) => {
      const nodes = (root || document).querySelectorAll('.txn-amt, .txn-fiat, .txn-detail-amt, .txn-detail-fiat');
      nodes.forEach(n => {
        const t = (n.textContent || '').trim();
        if (!t) return;
        if (t.charAt(0) === '+') { n.classList.add('is-received'); n.classList.remove('is-sent'); }
        else if (t.charAt(0) === '-') { n.classList.add('is-sent'); n.classList.remove('is-received'); }
      });
    };
    const mo = new MutationObserver(() => tag(document));
    const start = () => { tag(document); mo.observe(document.body, { childList: true, subtree: true, characterData: true }); };
    if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
  })();`,
  coinDetailController,
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

// Viewport-fit overrides: copied from the fullscreen Trust Wallet method.
// The shell owns a fixed full-height viewport, while the inner content scrolls.
const viewportFix = `
:root{--nav-side:10px;--nav-bottom:19px;--nav-height:86px;--sat:0px;--sab:0px;--app-bg:#000000;}
html{width:100% !important;height:100% !important;min-height:100% !important;margin:0 !important;padding:0 !important;overflow:hidden !important;background:var(--app-bg) !important;overscroll-behavior:none !important;-webkit-text-size-adjust:100% !important;}
body{position:fixed !important;inset:0 !important;width:100% !important;height:100% !important;min-height:100% !important;margin:0 !important;padding:0 !important;overflow:hidden !important;background:var(--app-bg) !important;overscroll-behavior:none !important;-ms-overflow-style:none !important;scrollbar-width:none !important;}
body::-webkit-scrollbar{display:none !important;}
#root,#app-gate,#protected-root{position:fixed !important;inset:0 !important;display:flex !important;flex-direction:column !important;align-items:stretch !important;width:100% !important;height:auto !important;min-height:0 !important;margin:0 !important;padding:0 !important;overflow:hidden !important;background:var(--app-bg) !important;}
body[data-authed="1"] #app-gate{background:transparent !important;pointer-events:none !important;}
body[data-authed="1"] #app-gate > *{pointer-events:auto !important;}
body::before{content:"" !important;position:fixed !important;inset:0 !important;background:var(--app-bg) !important;z-index:-1 !important;pointer-events:none !important;}
.app,.txn-detail-overlay{position:absolute !important;inset:0 !important;display:flex !important;flex-direction:column !important;width:100% !important;max-width:none !important;height:auto !important;min-height:0 !important;margin:0 !important;overflow:hidden !important;background:var(--app-bg) !important;isolation:isolate !important;z-index:0 !important;}
.scrollable{position:relative !important;z-index:1 !important;flex:1 1 auto !important;height:100% !important;min-height:0 !important;max-height:none !important;width:100% !important;overflow-y:auto !important;overflow-x:hidden !important;-webkit-overflow-scrolling:touch !important;overscroll-behavior:contain !important;padding-bottom:calc(var(--nav-height) + var(--nav-bottom) + 160px) !important;background:transparent !important;}
.txn-detail-screen{flex:1 1 auto !important;height:100% !important;min-height:0 !important;max-height:none !important;overflow-y:auto !important;-webkit-overflow-scrolling:touch !important;overscroll-behavior:contain !important;background:var(--app-bg) !important;padding-bottom:72px !important;}
.bottom-nav{position:fixed !important;bottom:var(--nav-bottom) !important;left:var(--nav-side) !important;right:var(--nav-side) !important;width:auto !important;height:86px !important;max-width:none !important;margin:0 !important;padding:0 !important;isolation:isolate !important;background:transparent !important;background-image:url('/assets/nav-bar.png') !important;background-repeat:no-repeat !important;background-size:100% 86px !important;background-position:center !important;}
input,textarea,select{font-size:16px !important;}
.bottom-nav::before{content:none !important;}
.nav-pill{display:flex !important;width:100% !important;height:86px !important;min-height:86px !important;padding:0 !important;margin:0 !important;background:transparent !important;border:none !important;box-shadow:none !important;border-radius:0 !important;}
.nav-btn{flex:1 1 0 !important;height:86px !important;min-height:86px !important;background:transparent !important;border:none !important;border-radius:0 !important;color:transparent !important;cursor:pointer !important;padding:0 !important;margin:0 !important;}
.nav-btn.active{background:transparent !important;}
.nav-btn > *{visibility:hidden !important;pointer-events:none !important;}
#appIntro{position:fixed !important;inset:0 !important;width:100% !important;height:100% !important;min-height:100dvh !important;max-height:none !important;background:var(--app-bg) !important;}
#appIntro video{width:100% !important;height:100% !important;object-fit:cover !important;}
.bg-glow{height:567px !important;background-color:var(--app-bg) !important;}
.bg-glow::after{background:linear-gradient(180deg, rgba(0,0,0,0) 0%, rgba(0,0,0,0) 38%, rgba(0,0,0,0.75) 65%, var(--app-bg) 92%) !important;}
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
    Keep it above the black backdrop and BEHIND content so it remains visible. */
 .bg-glow{position:fixed !important;top:0 !important;left:0 !important;right:0 !important;height:567px !important;z-index:0 !important;pointer-events:none !important;transform:none !important;background-color:var(--app-bg) !important;}
 .bg-glow::after{background:linear-gradient(180deg, rgba(0,0,0,0) 0%, rgba(0,0,0,0) 38%, rgba(0,0,0,0.75) 65%, var(--app-bg) 92%) !important;}
 /* Make sure header/balance text always sits above the fixed bg-glow */
 .header,.balance-section{position:relative !important;z-index:2 !important;}
 /* Kill the backdrop blur on the bottom nav so the PNG renders crisply */
 .bottom-nav,.nav-pill{backdrop-filter:none !important;-webkit-backdrop-filter:none !important;}
  /* Purple pull-to-refresh spinner — must sit ABOVE the fixed header (z:60) */
   #pullSpinner{display:block !important;position:fixed !important;top:78px !important;left:50% !important;width:30px !important;height:30px !important;font-size:30px !important;margin-left:0 !important;z-index:2147483646 !important;pointer-events:none !important;}
   #pullSpinner .spinner-blade{left:13.6px !important;bottom:0 !important;width:3px !important;height:8.5px !important;border-radius:999px !important;transform-origin:center -6.5px !important;animation:ptr-fade-purple .9s infinite linear !important;background-color:#7967ff !important;box-shadow:none !important;}
   #pullSpinner .spinner-blade:nth-child(1){transform:rotate(0deg) !important;animation-delay:0s !important;}#pullSpinner .spinner-blade:nth-child(2){transform:rotate(30deg) !important;animation-delay:.075s !important;}#pullSpinner .spinner-blade:nth-child(3){transform:rotate(60deg) !important;animation-delay:.15s !important;}#pullSpinner .spinner-blade:nth-child(4){transform:rotate(90deg) !important;animation-delay:.225s !important;}#pullSpinner .spinner-blade:nth-child(5){transform:rotate(120deg) !important;animation-delay:.3s !important;}#pullSpinner .spinner-blade:nth-child(6){transform:rotate(150deg) !important;animation-delay:.375s !important;}#pullSpinner .spinner-blade:nth-child(7){transform:rotate(180deg) !important;animation-delay:.45s !important;}#pullSpinner .spinner-blade:nth-child(8){transform:rotate(210deg) !important;animation-delay:.525s !important;}#pullSpinner .spinner-blade:nth-child(9){transform:rotate(240deg) !important;animation-delay:.6s !important;}#pullSpinner .spinner-blade:nth-child(10){transform:rotate(270deg) !important;animation-delay:.675s !important;}#pullSpinner .spinner-blade:nth-child(11){transform:rotate(300deg) !important;animation-delay:.75s !important;}#pullSpinner .spinner-blade:nth-child(12){transform:rotate(330deg) !important;animation-delay:.825s !important;}
   @keyframes ptr-fade-purple{0%{background-color:#7f6cff;opacity:1}100%{background-color:#392f75;opacity:.22}}
 /* Tighten gap between promo card and Explore market header */
 .section-header{padding-top:18px !important;}
 /* Smaller explore market cards */
 .explore-row{gap:10px !important;padding-left:16px !important;padding-right:16px !important;scroll-padding-left:16px !important;}
 .explore-row > *{scroll-snap-align:start !important;}
  .explore-card{flex:0 0 95px !important;height:115px !important;padding:10px 6px !important;}
  .explore-card.image-card{padding:0 !important;overflow:hidden !important;}
  .explore-card.image-card img{width:100% !important;height:100% !important;object-fit:cover !important;display:block !important;border-radius:inherit !important;}
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
  .promo-single{position:relative;display:flex;align-items:center;justify-content:space-between;background:#16161a;border-radius:16px;padding:12px 16px;min-height:86px;max-height:86px;overflow:hidden;}
  .promo-single .ps-text{flex:1;min-width:0;padding-right:8px;}
  .promo-single .ps-title{color:#fff;font-size:15px;font-weight:700;line-height:1.2;margin-bottom:4px;}
  .promo-single .ps-sub{color:#9a9aa2;font-size:12px;line-height:1.2;}
  .promo-single .ps-art{height:84px !important;width:auto;max-width:46% !important;object-fit:contain;flex-shrink:0;margin-right:4px;}
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
 .txn-all-header{display:flex !important;align-items:center !important;gap:10px !important;padding:14px 16px 14px !important;flex:none !important;}
 .txn-all-back{width:36px !important;height:36px !important;display:flex !important;align-items:center !important;justify-content:center !important;background:transparent !important;border:none !important;color:#fff !important;padding:0 !important;cursor:pointer !important;}
 .txn-all-back svg{width:22px !important;height:22px !important;}
 .txn-all-title{flex:1 !important;text-align:center !important;color:#fff !important;font-size:18px !important;font-weight:700 !important;letter-spacing:-.3px !important;margin-right:36px !important;}
 .txn-all-spacer{width:0 !important;}
  .txn-all-body{flex:1 1 auto !important;overflow-y:auto !important;-webkit-overflow-scrolling:touch !important;padding:6px 16px 40px !important;}
  /* Date pill in see-all matches reference: uppercase, dim text */
  .txn-date-pill,.txn-all-body .txn-date-pill{background:#272727 !important;border-radius:14px !important;padding:14px 16px !important;font-size:13px !important;color:#9c9ca1 !important;text-transform:uppercase !important;letter-spacing:.4px !important;margin:14px 0 10px !important;}
   /* Remove all / Remove some buttons in txn editor */
   .txn-edit-actions{display:flex !important;gap:8px !important;margin:8px 0 10px !important;}
   .txn-edit-action-btn{flex:1 !important;padding:8px 10px !important;border-radius:100px !important;background:rgba(255,255,255,.08) !important;color:#fff !important;font-size:12px !important;font-weight:600 !important;border:1px solid rgba(255,255,255,.12) !important;cursor:pointer !important;}
   .txn-edit-action-btn.danger{background:rgba(220,60,80,.15) !important;color:#ff7a8a !important;border-color:rgba(220,60,80,.35) !important;}
   /* Individual transaction detail — slide up from bottom */
   .txn-detail-overlay{display:block !important;transform:translateY(100%) !important;transition:transform .32s cubic-bezier(.25,1,.5,1) !important;will-change:transform !important;pointer-events:none !important;}
    .txn-detail-overlay.open{transform:translateY(0) !important;pointer-events:auto !important;}
    /* Add ~18px breathing room between balance and the Transfer/Swap/Buy buttons, plus more space between sections */
    .quick-actions{padding-top:48px !important;}
    .promo-single-wrap{margin-top:18px !important;}
    .section-header{margin-top:22px !important;}
    .txn-section{margin-top:18px !important;}
     .scrollable{padding-bottom:180px !important;}
     /* Transaction amount coloring: received green, sent stays white */
     .txn-amt.is-received,.txn-fiat.is-received,.txn-detail-amt.is-received,.txn-detail-fiat.is-received{color:#66be54 !important;}
     .txn-amt.is-sent,.txn-fiat.is-sent,.txn-detail-amt.is-sent,.txn-detail-fiat.is-sent{color:#ffffff !important;}
     /* Lighter, smaller transaction amount text to match reference */
     .txn-row .txn-amt,.txn-all-body .txn-amt{font-size:14px !important;font-weight:500 !important;letter-spacing:-.1px !important;line-height:1.2 !important;}
      .txn-row .txn-fiat,.txn-all-body .txn-fiat{font-size:12px !important;font-weight:400 !important;opacity:.75 !important;line-height:1.2 !important;}
      /* Transaction detail screen: lighter, smaller amount + fiat to match reference */
      .txn-detail-amt{font-size:20px !important;font-weight:600 !important;letter-spacing:-.2px !important;}
      .txn-detail-fiat{font-size:14px !important;font-weight:500 !important;margin-top:4px !important;}
      .txn-detail-confirm{font-size:14px !important;font-weight:500 !important;margin-top:14px !important;}
       .txn-detail-title{font-size:20px !important;font-weight:700 !important;}
       .txn-detail-eyebrow{font-size:12px !important;}

      /* Explore the market overlay */
      .market-overlay{position:fixed !important;inset:0 !important;z-index:310 !important;pointer-events:none !important;background:transparent !important;}
      .market-overlay.open{pointer-events:auto !important;}
      .market-screen{position:absolute !important;inset:0 !important;background:#0a0a0c !important;background-image:radial-gradient(1200px 600px at 50% -10%, rgba(187,174,252,.18), transparent 60%), linear-gradient(180deg,#0a0a0c,#0a0a0c) !important;transform:translateX(100%) !important;transition:transform .32s cubic-bezier(.25,1,.5,1) !important;display:flex !important;flex-direction:column !important;overflow:hidden !important;}
      .market-overlay.open .market-screen{transform:translateX(0) !important;}
      .market-header{display:flex !important;align-items:center !important;gap:10px !important;padding:14px 16px 14px !important;flex:none !important;}
      .market-back{width:36px !important;height:36px !important;display:flex !important;align-items:center !important;justify-content:center !important;background:transparent !important;border:none !important;color:#fff !important;padding:0 !important;cursor:pointer !important;}
      .market-back svg{width:22px !important;height:22px !important;}
      .market-title{flex:1 !important;text-align:center !important;color:#fff !important;font-size:18px !important;font-weight:700 !important;letter-spacing:-.3px !important;margin-right:36px !important;}
      .market-spacer{width:0 !important;}
      .market-body{flex:1 1 auto !important;overflow-y:auto !important;-webkit-overflow-scrolling:touch !important;padding:6px 12px 40px !important;display:flex !important;flex-direction:column !important;gap:8px !important;}
      .market-loading{padding:40px;text-align:center;color:#9c9ca1;font-size:14px;}
      .market-row{display:grid !important;grid-template-columns:18px 36px minmax(0,1fr) 70px auto !important;align-items:center !important;gap:10px !important;padding:12px 12px !important;border-radius:16px !important;background:rgba(255,255,255,.04) !important;backdrop-filter:blur(14px) saturate(140%) !important;-webkit-backdrop-filter:blur(14px) saturate(140%) !important;border:1px solid rgba(255,255,255,.06) !important;box-shadow:0 4px 18px rgba(0,0,0,.25) !important;opacity:0 !important;transform:translateY(8px) !important;animation:marketIn .35s ease-out forwards !important;transition:transform .15s ease, background .15s ease !important;}
      .market-row:active{transform:scale(.985) !important;background:rgba(255,255,255,.07) !important;}
      @keyframes marketIn{to{opacity:1;transform:translateY(0);}}
      .market-rank{font-size:11px !important;color:#7a7a82 !important;text-align:center !important;font-weight:600 !important;}
      .market-logo{width:36px !important;height:36px !important;border-radius:50% !important;overflow:hidden !important;background:rgba(255,255,255,.06) !important;flex-shrink:0 !important;}
      .market-logo img{width:100% !important;height:100% !important;object-fit:cover !important;display:block !important;}
      .market-id{min-width:0 !important;display:flex !important;flex-direction:column !important;gap:1px !important;}
      .market-ticker{color:#fff !important;font-size:14px !important;font-weight:700 !important;letter-spacing:.2px !important;line-height:1.15 !important;}
      .market-name{color:#9c9ca1 !important;font-size:11.5px !important;line-height:1.15 !important;white-space:nowrap !important;overflow:hidden !important;text-overflow:ellipsis !important;}
      .market-mcap{color:#6f6f78 !important;font-size:10.5px !important;line-height:1.15 !important;margin-top:1px !important;}
      .market-spark{width:70px !important;height:28px !important;flex-shrink:0 !important;}
      .market-spark svg{width:100% !important;height:100% !important;display:block !important;}
      .market-right{text-align:right !important;display:flex !important;flex-direction:column !important;gap:2px !important;min-width:72px !important;}
      .market-price{color:#fff !important;font-size:13.5px !important;font-weight:600 !important;letter-spacing:-.1px !important;}
      .market-pct{font-size:11.5px !important;font-weight:600 !important;}

      /* ── Coin Detail Overlay ───────────────────────────────────────────── */
      .coin-detail-overlay{position:fixed !important;inset:0 !important;z-index:320 !important;pointer-events:none !important;background:transparent !important;}
      .coin-detail-overlay.open{pointer-events:auto !important;}
      .coin-detail-screen{position:absolute !important;inset:0 !important;background:#000 !important;transform:translateX(100%) !important;transition:transform .32s cubic-bezier(.25,1,.5,1) !important;display:flex !important;flex-direction:column !important;overflow:hidden !important;}
      .coin-detail-overlay.open .coin-detail-screen{transform:translateX(0) !important;}
      .coin-detail-bg{position:absolute !important;top:0 !important;left:0 !important;right:0 !important;height:540px !important;background:linear-gradient(180deg,#202024 0%,#101013 38%,#06060a 75%,#000 100%) !important;pointer-events:none !important;z-index:0 !important;}
      .coin-detail-header{position:relative !important;z-index:5 !important;display:flex !important;align-items:center !important;justify-content:space-between !important;padding:14px 18px 8px !important;flex:none !important;background:transparent !important;transition:background .2s ease !important;}
      .coin-detail-overlay.scrolled .coin-detail-header{background:#0a0a0c !important;border-bottom:1px solid rgba(255,255,255,.05) !important;}
      .coin-detail-back,.coin-detail-settings{width:36px !important;height:36px !important;display:flex !important;align-items:center !important;justify-content:center !important;background:transparent !important;border:none !important;color:#fff !important;padding:0 !important;cursor:pointer !important;}
      .coin-detail-back svg{width:24px !important;height:24px !important;}
      .coin-detail-settings svg{width:22px !important;height:22px !important;}
      .coin-detail-header-title{flex:1 !important;text-align:center !important;opacity:0 !important;transition:opacity .2s ease !important;pointer-events:none !important;}
      .coin-detail-overlay.scrolled .coin-detail-header-title{opacity:1 !important;}
      .cdh-name{color:#9c9ca1 !important;font-size:12px !important;font-weight:500 !important;line-height:1.1 !important;}
      .cdh-fiat{color:#fff !important;font-size:17px !important;font-weight:700 !important;line-height:1.15 !important;letter-spacing:-.3px !important;}
      .coin-detail-body{position:relative !important;z-index:2 !important;flex:1 1 auto !important;overflow-y:auto !important;-webkit-overflow-scrolling:touch !important;padding:0 0 80px !important;background:transparent !important;}
      .cd-account-name{color:#fff !important;font-size:22px !important;font-weight:600 !important;letter-spacing:-.3px !important;padding:18px 22px 2px !important;}
      .cd-native-balance{color:#9c9ca1 !important;font-size:16px !important;font-weight:400 !important;padding:0 22px 18px !important;letter-spacing:.1px !important;}
      .cd-fiat-balance{color:#fff !important;font-size:44px !important;font-weight:700 !important;letter-spacing:-1.4px !important;padding:0 22px 8px !important;line-height:1 !important;}
      .cd-change{display:flex !important;align-items:center !important;gap:4px !important;padding:6px 22px 14px !important;font-size:15px !important;font-weight:500 !important;color:#22c55e !important;}
      .cd-change.down{color:#ef4444 !important;}
      .cd-change svg{width:16px !important;height:16px !important;}
      .cd-address{display:inline-flex !important;align-items:center !important;gap:8px !important;background:rgba(255,255,255,.07) !important;border:none !important;color:#fff !important;font-size:13px !important;font-weight:600 !important;letter-spacing:.4px !important;padding:8px 14px 8px 10px !important;margin:0 22px 24px !important;border-radius:10px !important;cursor:pointer !important;}
      .cd-address .cd-qr{width:18px !important;height:18px !important;color:#fff !important;}
      .cd-chart-wrap{position:relative !important;width:100% !important;height:200px !important;margin-top:6px !important;color:#bbaefc !important;touch-action:none !important;cursor:crosshair !important;}
      .cd-chart-svg{width:100% !important;height:100% !important;display:block !important;overflow:visible !important;}
      .cd-range-tabs{display:flex !important;justify-content:space-around !important;align-items:center !important;padding:18px 22px 6px !important;gap:6px !important;}
      .cd-range{background:transparent !important;border:none !important;color:#9c9ca1 !important;font-size:14px !important;font-weight:500 !important;padding:6px 12px !important;border-radius:8px !important;cursor:pointer !important;min-width:42px !important;}
      .cd-range.active{background:rgba(40,40,46,.9) !important;color:#fff !important;font-weight:600 !important;}
      .cd-powered-by{display:flex !important;align-items:center !important;justify-content:space-between !important;margin:14px 22px 10px !important;padding:12px 16px !important;border:1px solid rgba(255,255,255,.08) !important;border-radius:10px !important;color:#9c9ca1 !important;font-size:13px !important;}
      .cd-more-info{display:inline-flex !important;align-items:center !important;gap:4px !important;color:#fff !important;font-size:13px !important;}
      .cd-more-info svg{width:14px !important;height:14px !important;}
      .cd-section-label{color:#7a7a82 !important;font-size:11px !important;font-weight:600 !important;letter-spacing:1.2px !important;padding:24px 22px 12px !important;text-transform:uppercase !important;}
      .cd-quick-actions{display:grid !important;grid-template-columns:repeat(3,1fr) !important;gap:8px !important;padding:0 16px !important;}
      .cd-qa-btn{display:flex !important;flex-direction:column !important;align-items:center !important;justify-content:center !important;gap:10px !important;background:rgba(255,255,255,.05) !important;border:none !important;color:#fff !important;padding:22px 0 !important;border-radius:14px !important;font-size:14px !important;font-weight:600 !important;cursor:pointer !important;min-height:96px !important;}
      .cd-qa-btn svg{width:22px !important;height:22px !important;color:#fff !important;}
      .cd-qa-btn:active{background:rgba(255,255,255,.09) !important;}
      .cd-tokens-section{padding-top:8px !important;}
      .cd-tokens-list{display:flex !important;flex-direction:column !important;gap:18px !important;padding:0 22px !important;}
      .cd-token-row{display:flex !important;align-items:center !important;justify-content:space-between !important;gap:12px !important;}
      .cd-token-left{display:flex !important;align-items:center !important;gap:14px !important;min-width:0 !important;flex:1 !important;}
      .cd-token-logo{width:40px !important;height:40px !important;border-radius:50% !important;display:flex !important;align-items:center !important;justify-content:center !important;color:#fff !important;font-weight:700 !important;font-size:16px !important;flex-shrink:0 !important;}
      .cd-token-info{min-width:0 !important;display:flex !important;flex-direction:column !important;}
      .cd-token-name{color:#fff !important;font-size:16px !important;font-weight:600 !important;line-height:1.2 !important;white-space:nowrap !important;overflow:hidden !important;text-overflow:ellipsis !important;}
      .cd-token-sub{color:#9c9ca1 !important;font-size:13px !important;line-height:1.2 !important;margin-top:2px !important;}
      .cd-token-right{display:flex !important;flex-direction:column !important;align-items:flex-end !important;flex-shrink:0 !important;}
      .cd-token-val{color:#fff !important;font-size:16px !important;font-weight:600 !important;line-height:1.2 !important;}
      .cd-token-pct{color:#22c55e !important;font-size:13px !important;font-weight:500 !important;line-height:1.2 !important;margin-top:2px !important;display:flex !important;align-items:center !important;gap:2px !important;}
      .cd-token-pct.down{color:#ef4444 !important;}
      .cd-token-pct::before{content:'↗' !important;font-size:11px !important;}
      .cd-token-pct.down::before{content:'↘' !important;}
      .cd-tokens-more{display:block !important;width:calc(100% - 44px) !important;margin:22px 22px 0 !important;background:transparent !important;border:1px solid rgba(255,255,255,.12) !important;color:#fff !important;font-size:15px !important;font-weight:600 !important;padding:14px !important;border-radius:100px !important;cursor:pointer !important;display:flex !important;align-items:center !important;justify-content:center !important;gap:8px !important;}
      .cd-tokens-more svg{width:16px !important;height:16px !important;}
      .cd-divider{height:1px !important;background:rgba(255,255,255,.06) !important;margin:30px 0 0 !important;}
      .cd-txn-list{display:flex !important;flex-direction:column !important;gap:14px !important;padding:0 22px 40px !important;}
      .cd-txn-date{background:#272727 !important;border-radius:14px !important;padding:14px 16px !important;font-size:13px !important;color:#9c9ca1 !important;text-transform:uppercase !important;letter-spacing:.4px !important;margin:6px 0 4px !important;}
      .cd-txn-row{display:grid !important;grid-template-columns:44px 1fr auto !important;align-items:center !important;gap:12px !important;cursor:pointer !important;}
      .cd-txn-ic{width:44px !important;height:44px !important;border-radius:12px !important;border:1px solid rgba(255,255,255,.12) !important;display:flex !important;align-items:center !important;justify-content:center !important;color:#fff !important;}
      .cd-txn-ic svg{width:18px !important;height:18px !important;}
      .cd-txn-mid{min-width:0 !important;}
      .cd-txn-name{color:#fff !important;font-size:16px !important;font-weight:600 !important;line-height:1.2 !important;}
      .cd-txn-sub{color:#9c9ca1 !important;font-size:13px !important;line-height:1.2 !important;margin-top:2px !important;}
      .cd-txn-right{text-align:right !important;}
      .cd-txn-amt{font-size:15px !important;font-weight:600 !important;line-height:1.2 !important;}
      .cd-txn-amt.is-received{color:#66be54 !important;}
      .cd-txn-amt.is-sent{color:#fff !important;}
      .cd-txn-fiat{font-size:12px !important;color:#9c9ca1 !important;line-height:1.2 !important;margin-top:2px !important;}
      .cd-txn-empty{padding:40px;text-align:center;color:#9c9ca1;font-size:14px;}

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
