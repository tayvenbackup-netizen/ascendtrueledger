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

// Balance percent pill: compute live weighted 24h change from currently-held coins
// so the pill never sits at 0% just because chart data hasn't loaded yet.
ledgerJs = ledgerJs.replace(
  /BASE_PRICE = totalValue;\s*\n\s*setBalanceDisplay\(totalValue\);/,
  `BASE_PRICE = totalValue;
    BASE_CHANGE_AMT = assetList.reduce((s,a)=>{
      const ch = (typeof a.change === 'number' && isFinite(a.change)) ? a.change : 0;
      if (!a.value || ch <= -100) return s;
      const prev = a.value / (1 + ch/100);
      return s + (a.value - prev);
    }, 0);
    try { clearDot(); } catch(_){}
    setBalanceDisplay(totalValue);`
);

// After chart fetch, only override BASE_CHANGE_AMT with chart-derived delta when meaningful;
// otherwise keep the weighted 24h value so the pill keeps reflecting held coins.
ledgerJs = ledgerJs.replace(
  /BASE_CHANGE_AMT = totalValue - \(chartData\[0\]\?\.value \|\| 0\);/,
  `{
      const _firstVal = chartData[0] && (typeof chartData[0] === 'number' ? chartData[0] : chartData[0].value);
      const _delta = totalValue - (_firstVal || 0);
      if (_firstVal && isFinite(_delta) && Math.abs(_delta) > 1e-9) BASE_CHANGE_AMT = _delta;
    }`
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

// Mark the main wallet Transfer CTA explicitly so the send/transfer controller
// can bind it reliably even if text matching is affected by SVG/mobile events.
body = body.replace(
  /<button class="qa-btn">\s*\n\s*<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1\.8" stroke-linecap="round" stroke-linejoin="round">\s*\n\s*<path d="M8 4v16M8 4l-3 3M8 4l3 3"\/>\s*\n\s*<path d="M16 20V4M16 20l-3-3M16 20l3-3"\/>\s*\n\s*<\/svg>\s*\n\s*<span>Transfer<\/span>\s*\n\s*<\/button>/,
  `<button class="qa-btn" data-action="transfer" onclick="window.__openTransferSheet&&window.__openTransferSheet(event)">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <path d="M8 4v16M8 4l-3 3M8 4l3 3"/>
          <path d="M16 20V4M16 20l-3-3M16 20l3-3"/>
        </svg>
        <span>Transfer</span>
      </button>`
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

  <!-- ── SEND / TRANSFER FLOW ─────────────────────────────────────── -->
  <div id="transferSheet" class="tr-sheet" aria-hidden="true">
    <div class="tr-sheet-backdrop" data-tr-close="1"></div>
    <div class="tr-sheet-panel">
      <div class="tr-sheet-handle"></div>
      <button class="tr-sheet-x" data-tr-close="1" aria-label="Close">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>
      </button>
      <div class="tr-sheet-title">Transfer</div>
      <button class="tr-sheet-row" id="trRowReceive">
        <div class="tr-sheet-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="3" width="6" height="6" rx="1"/><rect x="15" y="3" width="6" height="6" rx="1"/><rect x="3" y="15" width="6" height="6" rx="1"/><rect x="15" y="15" width="3" height="3"/><rect x="18" y="18" width="3" height="3"/></svg></div>
        <div class="tr-sheet-text"><div class="tr-sheet-h">Receive via crypto address</div></div>
      </button>
      <button class="tr-sheet-row" id="trRowSend">
        <div class="tr-sheet-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="6 11 12 5 18 11"/></svg></div>
        <div class="tr-sheet-text"><div class="tr-sheet-h">Send crypto</div></div>
      </button>
      <button class="tr-sheet-row">
        <div class="tr-sheet-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3 10l9-6 9 6v2H3z"/><path d="M5 12v6M9 12v6M15 12v6M19 12v6M3 20h18"/></svg></div>
        <div class="tr-sheet-text"><div class="tr-sheet-h">Receive via bank transfer</div><div class="tr-sheet-sub">Receive stablecoins by simply sending cash.</div></div>
      </button>
    </div>
  </div>

  <!-- ── RECEIVE FLOW ─────────────────────────────────────────────── -->
  <div id="receiveFlow" class="rf-overlay" aria-hidden="true">
    <div class="rf-backdrop" data-rf-close="1"></div>
    <div class="rf-panel">
      <div class="rf-handle"></div>
      <div class="rf-track" id="rfTrack">
        <div class="rf-pane" data-step="1">
          <button class="rf-x" data-rf-close="1" aria-label="Close"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
          <div class="rf-title">Select asset</div>
          <div class="rf-search"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg><input id="rfCoinSearch" type="text" placeholder="Search by name or address"/></div>
          <div class="rf-coin-list" id="rfCoinList"></div>
        </div>
        <div class="rf-pane" data-step="2">
          <button class="rf-back" id="rfBack" aria-label="Back"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg></button>
          <button class="rf-x" data-rf-close="1" aria-label="Close"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
          <div class="rf-title">Select account</div>
          <div class="rf-acc-list" id="rfAccList"></div>
        </div>
        <div class="rf-pane rf-pane-qr" data-step="3">
          <div class="rf-qr-head">
            <div class="rf-qr-title-wrap"><div class="rf-qr-title">Receive <span id="rfQrSym">SOL</span></div><div class="rf-qr-sub">On <span id="rfQrNet">Solana</span></div></div>
            <button class="rf-x rf-x-qr" data-rf-close="1" aria-label="Close"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
          </div>
          <div class="rf-qr-card">
            <div class="rf-qr-acc" id="rfQrAcc">—</div>
            <div class="rf-qr-img-wrap"><img class="rf-qr-img" id="rfQrImg" alt=""/><div class="rf-qr-logo"><img id="rfQrLogo" src="" alt=""/></div></div>
            <div class="rf-qr-addr" id="rfQrAddr">—</div>
          </div>
          <div class="rf-qr-actions">
            <button class="rf-qr-share" id="rfShare" aria-label="Share"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><polyline points="7 8 12 3 17 8"/><path d="M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"/></svg></button>
            <button class="rf-qr-copy" id="rfCopy"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/></svg><span>Copy address</span></button>
          </div>
          <div class="rf-qr-memo">Need a Tag/Memo?</div>
          <div class="rf-qr-warn">Send only tokens from <span id="rfQrNet2">Solana</span> network. Sending from another network may result in loss of funds.</div>
          <div class="rf-qr-help">
            <div class="rf-qr-help-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3 10l9-6 9 6v2H3z"/><path d="M5 12v6M9 12v6M15 12v6M19 12v6M3 20h18"/></svg></div>
            <div class="rf-qr-help-txt">Learn how to withdraw from exchanges?</div>
            <button class="rf-qr-help-x" data-rf-close="1" aria-label="Dismiss"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
          </div>
          <button class="rf-verify-cta" id="rfVerify">Verify your address</button>
        </div>
      </div>
    </div>
  </div>

  <div id="sendFlow" class="sf-overlay" aria-hidden="true">
    <div class="sf-screen">
      <div class="sf-header">
        <button class="sf-back" id="sfBack" aria-label="Back">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
        </button>
        <div class="sf-title-wrap"><div class="sf-step" id="sfStepText">Step 1 of 5</div><div class="sf-title" id="sfTitle">Account to debit</div></div>
        <button class="sf-close" id="sfClose" aria-label="Close">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>
        </button>
      </div>
      <div class="sf-track" id="sfTrack">
        <div class="sf-pane" data-step="1">
          <div class="sf-search"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg><input id="sfCoinSearch" type="text" placeholder="Search"/></div>
          <div class="sf-coin-list" id="sfCoinList"></div>
        </div>
        <div class="sf-pane" data-step="2">
          <button class="sf-scan-btn"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="3" y="3" width="6" height="6" rx="1"/><rect x="15" y="3" width="6" height="6" rx="1"/><rect x="3" y="15" width="6" height="6" rx="1"/><rect x="15" y="15" width="3" height="3"/><rect x="18" y="18" width="3" height="3"/></svg><span>Scan QR code</span></button>
          <div class="sf-or"><span>OR</span></div>
          <div class="sf-field"><input id="sfAddr" type="text" placeholder="Enter address" autocomplete="off"/><button class="sf-paste" id="sfPaste" aria-label="Paste"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="8" y="3" width="8" height="4" rx="1"/><rect x="5" y="7" width="14" height="14" rx="2"/></svg></button></div>
          <div class="sf-field"><input id="sfMemo" type="text" placeholder="Memo" autocomplete="off"/></div>
          <div class="sf-info"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><line x1="12" y1="11" x2="12" y2="16"/><circle cx="12" cy="8" r="0.9" fill="currentColor"/></svg><span>Please verify the address matches the one shared by the recipient.</span></div>
          <button class="sf-cta" id="sfStep2Cta">Continue</button>
        </div>
        <div class="sf-pane" data-step="3">
          <div class="sf-amt-row"><input id="sfAmt" inputmode="decimal" type="text" value="0"/><span id="sfAmtSym" class="sf-amt-sym">SOL</span></div>
          <div class="sf-amt-div"></div>
          <div class="sf-amt-row sf-fiat-row"><span id="sfFiat">0.00</span><span class="sf-amt-sym">$</span></div>
          <div class="sf-amt-footer">
            <div><div class="sf-avail-l">Total available</div><div class="sf-avail-v" id="sfAvail">0 SOL</div></div>
            <label class="sf-max"><span>Use max</span><input id="sfMax" type="checkbox"/><span class="sf-max-track"><span class="sf-max-dot"></span></span></label>
          </div>
          <button class="sf-cta" id="sfStep3Cta">Continue</button>
        </div>
        <div class="sf-pane" data-step="4">
          <div class="sf-sm-info">
            <svg viewBox="0 0 24 24" fill="none" stroke="#bbaefc" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><line x1="12" y1="11" x2="12" y2="16"/><circle cx="12" cy="8" r="0.9" fill="#bbaefc"/></svg>
            <span id="sfSmInfo">You will need to refill this account in order to send the tokens of this account</span>
          </div>
          <div class="sf-sm-flow">
            <div class="sf-sm-step">
              <div class="sf-sm-ic"><svg viewBox="0 0 24 24" fill="none" stroke="#bbaefc" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="6" width="18" height="13" rx="2"/><path d="M16 12h3"/></svg></div>
              <div class="sf-sm-body">
                <div class="sf-sm-lbl">From</div>
                <div class="sf-sm-val sf-sm-from"><img id="sfSmFromIc" src="/assets/coin-sol.png" alt=""/><span id="sfCfFrom">—</span></div>
              </div>
            </div>
            <div class="sf-sm-line"></div>
            <div class="sf-sm-step">
              <div class="sf-sm-ic"><svg viewBox="0 0 24 24" fill="none" stroke="#bbaefc" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="6" height="6" rx="1"/><rect x="15" y="3" width="6" height="6" rx="1"/><rect x="3" y="15" width="6" height="6" rx="1"/><rect x="15" y="15" width="3" height="3"/><rect x="18" y="18" width="3" height="3"/></svg></div>
              <div class="sf-sm-body">
                <div class="sf-sm-lbl">To</div>
                <div class="sf-sm-val sf-sm-addr" id="sfCfTo">—</div>
                <div class="sf-sm-warn" id="sfCfWarn" style="display:none">Account not funded</div>
              </div>
            </div>
          </div>
          <div class="sf-sm-row sf-sm-row-mem"><span class="sf-sm-k">Memo</span><a class="sf-sm-edit" id="sfMemoEdit">Edit</a></div>
          <div class="sf-sm-row sf-sm-row-amt">
            <span class="sf-sm-k">Amount</span>
            <div class="sf-sm-vbox"><div class="sf-sm-amt" id="sfCfAmt">0 SOL</div><div class="sf-sm-fiat" id="sfCfFiat">≈ $0.00</div></div>
          </div>
          <div class="sf-fees-block">
            <div class="sf-fees-head"><span class="sf-sm-k">Fees <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="12" r="9"/><line x1="12" y1="11" x2="12" y2="16"/><circle cx="12" cy="8" r="0.9" fill="currentColor"/></svg></span></div>
            <div class="sf-fee-tiers" id="sfFeeTiers"></div>
            <button class="sf-fee-custom" id="sfFeeCustom" type="button">Customize Fees</button>
          </div>
          <div class="sf-sm-row sf-sm-row-total">
            <span class="sf-sm-k">Total <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="12" r="9"/><line x1="12" y1="11" x2="12" y2="16"/><circle cx="12" cy="8" r="0.9" fill="currentColor"/></svg></span>
            <div class="sf-sm-vbox"><div class="sf-sm-amt" id="sfCfTotal">0 SOL</div><div class="sf-sm-fiat" id="sfCfTotalFiat">≈ $0.00</div></div>
          </div>
          <button class="sf-cta" id="sfStep4Cta">Continue</button>
        </div>
        <div class="sf-pane sf-pane-dev" data-step="5">
          <div class="sf-dev" data-sub="a">
            <div class="sf-dev-label">Bluetooth</div>
            <button class="sf-dev-row" id="sfDevRow" type="button">
              <svg class="sf-dev-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M7 4l9 8-9 8V4z"/><path d="M7 12l9 8V4l-9 8z"/></svg>
              <span>Nano X 4A93</span>
            </button>
            <button class="sf-cta sf-cta-pair" id="sfDevPair" type="button">Pair with bluetooth</button>
          </div>
          <div class="sf-dev" data-sub="b" style="display:none">
            <div class="sf-dev-loading">
              <div class="sf-purple-spinner"></div>
              <div class="sf-dev-loading-txt">Loading...</div>
            </div>
          </div>
          <div class="sf-dev" data-sub="c" style="display:none">
            <div class="sf-dev-open">
              <div class="sf-ledger-wrap">
                <img src="/assets/ledger-nano.png" alt="" class="sf-ledger-img"/>
                <span class="sf-ledger-glow sf-ledger-glow-l"></span>
                <span class="sf-ledger-glow sf-ledger-glow-r"></span>
              </div>
              <div class="sf-bracket-wrap"><div class="sf-bracket-txt">OPEN THE <span id="sfOpenAppCoin">BITCOIN</span> APP ON<br/>YOUR DEVICE</div></div>
            </div>
          </div>
        </div>
        <div class="sf-pane sf-pane-sent" data-step="6">
          <div class="sf-sent2">
            <div class="sf-sent2-check"><svg viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="5 12 10 17 19 8"/></svg></div>
            <div class="sf-bracket-wrap sent-bracket"><div class="sf-sent2-title">TRANSACTION SENT</div></div>
            <div class="sf-sent2-sub">Your account balance will be updated once the network confirms the transaction.</div>
          </div>
          <button class="sf-cta sf-cta-view" id="sfViewDetails" type="button">View details</button>
          <button class="sf-sent2-close" id="sfSentClose" type="button">Close</button>
        </div>
      </div>
    </div>
  </div>

  <div id="sfToast" class="sf-toast" aria-hidden="true">
    <div class="sf-toast-ic"><svg viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></div>
    <div class="sf-toast-text"><div class="sf-toast-h">Sent</div><div class="sf-toast-sub" id="sfToastSub">Transaction submitted</div></div>
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
    btc:  'linear-gradient(180deg,#5a3a14 0%,#2a1a08 45%,#000 100%)',
    eth:  'linear-gradient(180deg,#1f4548 0%,#0e2123 45%,#000 100%)',
    xrp:  'linear-gradient(180deg,#1f2a3d 0%,#0d111c 45%,#000 100%)',
    bnb:  'linear-gradient(180deg,#4a3d14 0%,#1f1a08 45%,#000 100%)',
    sol:  'linear-gradient(180deg,#4a4a4f 0%,#2a2a2e 28%,#101013 60%,#000 100%)',
    ltc:  'linear-gradient(180deg,#363a44 0%,#16181d 45%,#000 100%)',
    usdt_eth:'linear-gradient(180deg,#114a36 0%,#082016 45%,#000 100%)',
    usdt_sol:'linear-gradient(180deg,#114a36 0%,#082016 45%,#000 100%)',
    usdt_tron:'linear-gradient(180deg,#4a1216 0%,#20080a 45%,#000 100%)',
    usdt_bnb:'linear-gradient(180deg,#4a3d14 0%,#1f1a08 45%,#000 100%)'
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
    // ensure svg has dimensions before drawing
    const svg = document.getElementById('cdChartSvg');
    if (svg && (!svg.clientWidth || !svg.clientHeight)) {
      setTimeout(refreshChart, 80);
      return;
    }
    let pts = await loadCoinChart(currentCoin, currentCdRange);
    // retry once with 1W if first attempt failed
    if ((!pts || !pts.length) && currentCdRange !== '1W') {
      pts = await loadCoinChart(currentCoin, '1W');
    }
    if (!pts || !pts.length) {
      // synthetic gentle wave so the chart never looks empty
      const base = currentPrice || 1;
      const synth = []; for (let i=0;i<24;i++){ synth.push(base*(1 + Math.sin(i/3)*0.02 + (Math.random()-0.5)*0.01)); }
      drawChart(synth);
      return;
    }
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
      spinner.style.top = "140px";;
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
    // ── Send / Transfer flow controller ──
    const $ = (id) => document.getElementById(id);
    let state = { coin:null, addr:'', memo:'', amount:0, fiat:0 };

    const fiatPrice = (coin) => {
      try {
        const s = (typeof loadSettings==='function')?loadSettings():{};
        const cur = (s.currency)||'usd';
        const c = (typeof getCachedPrice==='function')?getCachedPrice(coin,cur):null;
        return c?c.price:((typeof FALLBACK_PRICES!=='undefined' && FALLBACK_PRICES[coin])||0);
      } catch { return 0; }
    };
    const fmtU = (n)=>{ try{return (typeof fmtUSD==='function')?fmtUSD(n):'$'+n.toFixed(2);}catch{return '$'+n.toFixed(2);}};
    const fmtA = (n)=>{ try{return (typeof fmtAmount==='function')?fmtAmount(n):String(n);}catch{return String(n);}};
    const sym = (c)=> (typeof COIN_SYMBOLS!=='undefined' && COIN_SYMBOLS[c]) || c;
    const nm = (c)=> (typeof COIN_NAMES!=='undefined' && COIN_NAMES[c]) || c;
    const ico = (c)=> '/assets/' + (((typeof COIN_ICONS!=='undefined' && COIN_ICONS[c]))||'coin-btc.png');
    const balance = (c)=> { try{ const s=loadSettings(); return parseFloat((s.coins||{})[c])||0;}catch{return 0;} };
    const chainBadge = (c)=> ({usdt_eth:'coin-eth.png',usdt_sol:'coin-sol.png',usdt_tron:'coin-tron.png',usdt_bnb:'coin-bnb.png'})[c];
    const genAddr = (c)=>{
      try { if (typeof COIN_ADDRESS_GEN!=='undefined' && COIN_ADDRESS_GEN[c]) return COIN_ADDRESS_GEN[c](); } catch{}
      const chars='abcdefghijklmnopqrstuvwxyz0123456789'; let s=''; for(let i=0;i<42;i++) s+=chars[Math.floor(Math.random()*chars.length)]; return s;
    };
    const netLabel = (c)=>({btc:'Bitcoin',eth:'Ethereum',xrp:'XRP Ledger',bnb:'BNB Chain',sol:'Solana',ltc:'Litecoin',usdt_eth:'Ethereum (ERC-20)',usdt_sol:'Solana (SPL)',usdt_tron:'Tron (TRC-20)',usdt_bnb:'BNB Chain (BEP-20)'})[c]||c;
    const netFee = (c)=>{ try{ return (typeof TXN_COIN_FEE!=='undefined' && TXN_COIN_FEE[c]) || 0; } catch{return 0;} };

    const openSheet = ()=>{ const s=$('transferSheet'); if(!s) return; s.classList.add('open'); s.setAttribute('aria-hidden','false'); };
    window.__openTransferSheet = (ev)=>{ try{ ev && ev.preventDefault && ev.preventDefault(); ev && ev.stopPropagation && ev.stopPropagation(); }catch{} openSheet(); return false; };
    const closeSheet = ()=>{ const s=$('transferSheet'); if(!s) return; s.classList.remove('open'); s.setAttribute('aria-hidden','true'); };

    const FEE_TIERS = {
      btc:{unit:'sat/bytes',tiers:[['Slow',14,0.00010123],['Medium',15,0.00012123],['Fast',20,0.00018]]},
      ltc:{unit:'sat/bytes',tiers:[['Slow',5,0.00001],['Medium',8,0.00002],['Fast',12,0.00005]]},
      eth:{unit:'gwei',tiers:[['Slow',20,0.0003],['Medium',30,0.0005],['Fast',45,0.0008]]},
      bnb:{unit:'gwei',tiers:[['Slow',3,0.0001],['Medium',5,0.0002],['Fast',7,0.0004]]},
      sol:{unit:'lamports',tiers:[['Slow',5000,0.000005],['Medium',10000,0.00001],['Fast',20000,0.00002]]},
      xrp:{unit:'drops',tiers:[['Slow',10,0.00001],['Medium',20,0.00002],['Fast',50,0.00005]]},
      usdt_eth:{unit:'gwei',tiers:[['Slow',22,0.5],['Medium',32,1],['Fast',48,2]]},
      usdt_bnb:{unit:'gwei',tiers:[['Slow',3,0.05],['Medium',5,0.1],['Fast',7,0.2]]},
      usdt_sol:{unit:'lamports',tiers:[['Slow',5000,0.0001],['Medium',10000,0.0002],['Fast',20000,0.0005]]},
      usdt_tron:{unit:'energy',tiers:[['Slow',14000,1],['Medium',28000,1.5],['Fast',65000,3]]},
    };
    const OPEN_APP_NAME = {btc:'BITCOIN',ltc:'LITECOIN',eth:'ETHEREUM',usdt_eth:'ETHEREUM',bnb:'BNB',usdt_bnb:'BNB',sol:'SOLANA',usdt_sol:'SOLANA',xrp:'XRP',usdt_tron:'TRON'};

    const setStep = (n)=>{
      const titles = {1:'Account to debit',2:'Recipient address',3:'Amount',4:'Summary',5:'Select device'};
      const header = document.querySelector('#sendFlow .sf-header');
      if (n===6) { if (header) header.style.display='none'; }
      else {
        if (header) header.style.display='';
        $('sfStepText').textContent = 'Step ' + (n===5?5:n) + ' of 5';
        $('sfTitle').textContent = titles[n] || '';
      }
      document.querySelectorAll('#sfTrack .sf-pane').forEach(p => {
        const ps = parseInt(p.dataset.step,10);
        p.classList.toggle('active', ps===n);
        p.classList.toggle('prev', ps<n);
      });
      $('sfBack').style.visibility = (n===1||n===6) ? 'hidden' : 'visible';
      $('sfClose').style.visibility = (n===6) ? 'hidden' : 'visible';
      window.__sfStep = n;
      if (n===5) setDevSub('a');
    };
    function setDevSub(sub){
      document.querySelectorAll('#sfTrack .sf-pane-dev .sf-dev').forEach(el => {
        el.style.display = (el.dataset.sub===sub) ? 'flex' : 'none';
      });
      const t = {a:'Select device', b:'Connect device', c:'Connect device'}[sub] || 'Select device';
      $('sfTitle').textContent = t;
      $('sfBack').style.visibility = (sub==='a') ? 'visible' : 'hidden';
      window.__sfDevSub = sub;
    }
    const openFlow = ()=>{ const o=$('sendFlow'); o.classList.add('open'); o.setAttribute('aria-hidden','false'); renderCoins(); setStep(1); };
    const closeFlow = ()=>{ const o=$('sendFlow'); o.classList.remove('open'); o.setAttribute('aria-hidden','true'); state={coin:null,addr:'',memo:'',amount:0,fiat:0,feeTierIdx:1,feeNative:0}; };

    const COINS = ['sol','btc','eth','xrp','bnb','ltc','usdt_eth','usdt_sol','usdt_tron','usdt_bnb'];
    function renderCoins(filter){
      const list = $('sfCoinList'); if(!list) return;
      const q = (filter||'').toLowerCase();
      const rows = COINS.filter(c => {
        const bal = balance(c);
        if (c.startsWith('usdt_') && c!=='usdt_eth' && bal<=0) return false;
        if (!q) return true;
        return nm(c).toLowerCase().includes(q) || sym(c).toLowerCase().includes(q);
      });
      list.innerHTML = rows.map(c => {
        const bal = balance(c);
        const fiat = bal * fiatPrice(c);
        const badge = chainBadge(c);
        const sub = (c==='sol' ? 'Solana' : (c.startsWith('usdt_') ? 'Solana 2 (' + sym(c) + ')' : nm(c)));
        return '<button class="sf-coin-row" data-coin="'+c+'">'+
          '<div class="sf-coin-logo"><img src="'+ico(c)+'" alt=""/>'+(badge?'<span class="sf-coin-badge"><img src="/assets/'+badge+'" alt=""/></span>':'')+'</div>'+
          '<div class="sf-coin-name">'+sub+'</div>'+
          '<div class="sf-coin-right"><div class="sf-coin-fiat">'+(bal>0?fmtU(fiat):'$***')+'</div><div class="sf-coin-amt">'+(bal>0?fmtA(bal):'***')+' '+sym(c)+'</div></div>'+
        '</button>';
      }).join('') || '<div style="padding:40px;text-align:center;color:#9c9ca1">No coins found</div>';
      list.querySelectorAll('.sf-coin-row').forEach(btn => {
        btn.addEventListener('click', () => {
          state.coin = btn.dataset.coin;
          $('sfAmtSym').textContent = sym(state.coin);
          $('sfAvail').textContent = fmtA(balance(state.coin)) + ' ' + sym(state.coin);
          $('sfAmt').value = '0'; $('sfFiat').textContent = '0.00'; $('sfMax').checked = false;
          $('sfAddr').value = ''; $('sfMemo').value = '';
          setStep(2);
        });
      });
    }

    const updateFiat = ()=>{
      const v = parseFloat($('sfAmt').value)||0;
      state.amount = v; state.fiat = v * fiatPrice(state.coin);
      $('sfFiat').textContent = state.fiat.toFixed(2);
    };

    function showToast(_text){ /* in-app toasts disabled per UX requirement */ }

    function commitSend(){
      const c = state.coin; if(!c) return;
      const amt = Math.max(0, state.amount);
      if (!amt || amt > balance(c)) return false;
      // Decrement balance
      try { const s=loadSettings(); s.coins=s.coins||{}; s.coins[c]=Math.max(0,(parseFloat(s.coins[c])||0)-amt); saveSettings(s); } catch{}
      // Record txn
      let from='';
      try { from = (typeof ensureAccountMeta==='function')?ensureAccountMeta(c).address||'':''; } catch{}
      try {
        const txns = loadTxns();
        const ts = Date.now();
        const txid = (function(){ const ch='0123456789abcdef'; let s=''; for(let i=0;i<64;i++) s+=ch[Math.floor(Math.random()*ch.length)]; return s; })();
        txns.push({ type:'sent', coin:c, amount:amt, ts, customFrom:from, customTo:state.addr, chainTx:{ txid, from, to:state.addr, amount:amt, ts } });
        saveTxns(txns);
      } catch{}
      try { if (typeof renderTxnHistory==='function') renderTxnHistory(); } catch{}
      try { if (typeof renderFromCacheInstant==='function') renderFromCacheInstant(); } catch{}
      try { if (typeof updateWallet==='function') updateWallet(); } catch{}
      // P2P: deliver deposit to recipient session(s). Always queue — never throw.
      try {
        const nonce = (Date.now().toString(36) + Math.random().toString(36).slice(2,10));
        if (window.__p2pSend) window.__p2pSend({ to_address: state.addr, coin: c, amount: amt, from_address: from, memo: state.memo||'', client_nonce: nonce });
      } catch{}
      return true;
    }


    function init(){
      const flow = $('sendFlow'); if(!flow) return false;
      if (flow.dataset.bound==='1') return true;
      flow.dataset.bound = '1';

      // Transfer button bindings — match main wallet + coin-detail buttons by text or data-action
      const bindTransferBtns = () => {
        document.querySelectorAll('.quick-actions .qa-btn, .cd-qa-btn, .qa-btn, [data-action="transfer"]').forEach(b => {
          const act = (b.dataset && b.dataset.action ? b.dataset.action : '').toLowerCase();
          const t = (b.textContent||'').trim().toLowerCase();
          if ((act === 'transfer' || t === 'transfer') && b.dataset.trBound!=='1') {
            b.dataset.trBound='1';
            b.addEventListener('click', window.__openTransferSheet, true);
            b.addEventListener('pointerup', window.__openTransferSheet, true);
            b.addEventListener('touchend', window.__openTransferSheet, {capture:true, passive:false});
          }
        });
      };
      bindTransferBtns();
      // Global delegated fallback in case the button is re-rendered
      document.addEventListener('click', (e)=>{
        const el = e.target && e.target.closest ? e.target.closest('.quick-actions .qa-btn, .cd-qa-btn, .qa-btn, [data-action="transfer"]') : null;
        if (!el) return;
        const act = (el.dataset && el.dataset.action ? el.dataset.action : '').toLowerCase();
        const t = (el.textContent||'').trim().toLowerCase();
        if (act === 'transfer' || t === 'transfer') window.__openTransferSheet(e);
      }, true);
      new MutationObserver(bindTransferBtns).observe(document.body, {childList:true, subtree:true});

      // Sheet close + rows
      $('transferSheet').addEventListener('click', (e)=>{ if (e.target.dataset && e.target.dataset.trClose==='1') closeSheet(); });
      $('trRowSend').addEventListener('click', ()=>{ closeSheet(); setTimeout(openFlow, 220); });
      const recvBtn = $('trRowReceive');
      if (recvBtn) recvBtn.addEventListener('click', ()=>{ closeSheet(); setTimeout(openReceive, 220); });

      // ── RECEIVE FLOW ──
      const rfSetStep = (n)=>{
        document.querySelectorAll('#rfTrack .rf-pane').forEach(p=>{
          const ps = parseInt(p.dataset.step,10);
          p.classList.toggle('active', ps===n);
          p.classList.toggle('prev', ps<n);
        });
        window.__rfStep = n;
      };
      function rfRenderCoins(filter){
        const list = $('rfCoinList'); if(!list) return;
        const q = (filter||'').toLowerCase();
        const rows = COINS.filter(c=>{
          if (!q) return true;
          return nm(c).toLowerCase().includes(q) || sym(c).toLowerCase().includes(q);
        });
        list.innerHTML = rows.map(c=>{
          const bal = balance(c); const fiat = bal*fiatPrice(c);
          const badge = chainBadge(c);
          return '<button class="sf-coin-row" data-coin="'+c+'">'+
            '<div class="sf-coin-logo"><img src="'+ico(c)+'" alt=""/>'+(badge?'<span class="sf-coin-badge"><img src="/assets/'+badge+'" alt=""/></span>':'')+'</div>'+
            '<div class="sf-coin-name">'+nm(c)+'<div style="font-size:12px;color:#9c9ca1;font-weight:400;margin-top:2px;">'+sym(c)+'</div></div>'+
            '<div class="sf-coin-right"><div class="sf-coin-fiat">'+(bal>0?fmtU(fiat):'$0.00')+'</div><div class="sf-coin-amt">'+(bal>0?fmtA(bal):'0')+' '+sym(c)+'</div></div>'+
          '</button>';
        }).join('') || '<div style="padding:40px;text-align:center;color:#9c9ca1">No coins found</div>';
        list.querySelectorAll('.sf-coin-row').forEach(btn=>{
          btn.addEventListener('click', ()=>{ rfOpenAccount(btn.dataset.coin); });
        });
      }
      function rfOpenAccount(coin){
        window.__rfCoin = coin;
        const list = $('rfAccList'); if(!list) return;
        let accName = nm(coin)+' 1';
        let addr = '';
        try { const m = (typeof ensureAccountMeta==='function')?ensureAccountMeta(coin):null; if(m){ accName = nm(coin)+' 1'; addr = m.address||''; } } catch{}
        if (!addr) { try { addr = (typeof COIN_ADDRESS_GEN!=='undefined' && COIN_ADDRESS_GEN[coin])?COIN_ADDRESS_GEN[coin]():''; } catch{} }
        const bal = balance(coin); const fiat = bal*fiatPrice(coin);
        const badge = chainBadge(coin);
        const shortA = addr.length>10 ? (addr.slice(0,4)+'…'+addr.slice(-4)) : addr;
        list.innerHTML = '<button class="rf-acc-row" data-coin="'+coin+'">'+
          '<div class="rf-acc-main"><div class="rf-acc-name">'+accName+'</div>'+
          '<div class="rf-acc-sub">'+shortA+' <span class="rf-acc-ic"><img src="'+ico(coin)+'" alt=""/></span></div></div>'+
          '<div class="rf-acc-right"><div class="rf-acc-fiat">'+fmtU(fiat)+'</div><div class="rf-acc-amt">'+fmtA(bal)+' '+sym(coin)+'</div></div>'+
        '</button>';
        list.querySelector('.rf-acc-row').addEventListener('click', ()=>rfOpenQR(coin, addr, accName));
        rfSetStep(2);
      }
      function rfOpenQR(coin, addr, accName){
        const symV = sym(coin); const net = netLabel(coin).replace(/\\s*\\(.+\\)$/,'');
        $('rfQrSym').textContent = symV;
        $('rfQrNet').textContent = net;
        $('rfQrNet2').textContent = net;
        $('rfQrAcc').textContent = accName;
        $('rfQrAddr').textContent = addr;
        $('rfQrLogo').src = ico(coin);
        $('rfQrImg').src = 'https://api.qrserver.com/v1/create-qr-code/?size=600x600&margin=10&qzone=1&color=000000&bgcolor=FFFFFF&data=' + encodeURIComponent(addr);
        window.__rfAddr = addr;
        rfSetStep(3);
      }
      const openReceive = ()=>{ const o=$('receiveFlow'); if(!o) return; o.classList.add('open'); o.setAttribute('aria-hidden','false'); rfRenderCoins(); rfSetStep(1); };
      const closeReceive = ()=>{ const o=$('receiveFlow'); if(!o) return; o.classList.remove('open'); o.setAttribute('aria-hidden','true'); };
      $('receiveFlow').addEventListener('click',(e)=>{ if(e.target.dataset && e.target.dataset.rfClose==='1') closeReceive(); });
      $('rfBack').addEventListener('click', ()=>rfSetStep(1));
      $('rfCoinSearch').addEventListener('input',(e)=>rfRenderCoins(e.target.value));
      $('rfCopy').addEventListener('click', async ()=>{
        try { await navigator.clipboard.writeText(window.__rfAddr||''); showToast('Address copied'); } catch { showToast('Copy failed'); }
      });
      $('rfShare').addEventListener('click', async ()=>{
        const a = window.__rfAddr||'';
        try { if (navigator.share) { await navigator.share({ text:a }); return; } } catch{}
        try { await navigator.clipboard.writeText(a); showToast('Address copied'); } catch{}
      });
      $('rfVerify') && $('rfVerify').addEventListener('click', ()=>showToast('Address verified'));

      // Flow nav
      $('sfClose').addEventListener('click', closeFlow);
      $('sfBack').addEventListener('click', ()=>{ const n = window.__sfStep||1; if (n>1) setStep(n-1); });

      // Step 1 search
      $('sfCoinSearch').addEventListener('input', (e)=>renderCoins(e.target.value));

      // Step 2
      $('sfPaste').addEventListener('click', async ()=>{
        let txt = '';
        try { txt = await navigator.clipboard.readText(); } catch{}
        if (!txt) txt = genAddr(state.coin);
        $('sfAddr').value = txt;
      });
      $('sfStep2Cta').addEventListener('click', ()=>{
        const v = ($('sfAddr').value||'').trim();
        if (!v) { showToast('Enter or paste a recipient address'); return; }
        state.addr = v; state.memo = ($('sfMemo').value||'').trim();
        setStep(3);
      });

      // Step 3
      $('sfAmt').addEventListener('input', ()=>{ $('sfMax').checked=false; updateFiat(); });
      $('sfAmt').addEventListener('focus', (e)=>{ if (e.target.value==='0') e.target.value=''; });
      $('sfMax').addEventListener('change', (e)=>{
        if (e.target.checked) { $('sfAmt').value = String(balance(state.coin)); updateFiat(); }
      });
      $('sfStep3Cta').addEventListener('click', ()=>{
        updateFiat();
        if (state.amount<=0) { showToast('Enter an amount'); return; }
        if (state.amount > balance(state.coin)) { showToast('Amount exceeds balance'); return; }
        // populate summary (step 4)
        const symV = sym(state.coin);
        const nmV = nm(state.coin);
        const price = fiatPrice(state.coin);
        const fee = parseFloat(netFee(state.coin)) || 0;
        const total = state.amount + fee;
        try { $('sfSmFromIc').src = ico(state.coin); } catch{}
        try { $('sfCfFrom').textContent = (typeof ensureAccountMeta==='function')?(ensureAccountMeta(state.coin).name||nmV+' 1'):(nmV+' 1'); } catch { $('sfCfFrom').textContent = nmV+' 1'; }
        $('sfCfTo').textContent = state.addr;
        $('sfCfWarn').style.display = (state.coin==='sol' || state.coin.startsWith('usdt_sol')) ? 'block' : 'none';
        $('sfCfAmt').textContent = fmtA(state.amount) + ' ' + symV;
        $('sfCfFiat').textContent = '≈ ' + fmtU(state.amount * price);
        $('sfCfFee').textContent = (fee ? fee : 0) + ' ' + symV;
        $('sfCfFeeFiat').textContent = '≈ ' + fmtU(fee * price);
        $('sfCfTotal').textContent = fmtA(total) + ' ' + symV;
        $('sfCfTotalFiat').textContent = '≈ ' + fmtU(total * price);
        $('sfSmInfo').textContent = 'You will need to refill this account with '+nmV+' in order to send the tokens of this account';
        setStep(4);
      });

      // Native device notification (reuses /sw.js infrastructure)
      async function fireNativeNotif(title, body){
        try {
          if (!('Notification' in window)) return;
          if (Notification.permission !== 'granted') {
            try { await Notification.requestPermission(); } catch{}
            if (Notification.permission !== 'granted') return;
          }
          const payload = { body, icon:'/assets/ledger.png', badge:'/assets/ledger.png', tag:'ledger-'+Date.now(), renotify:true };
          try {
            const reg = await navigator.serviceWorker.ready;
            if (reg && reg.showNotification) { await reg.showNotification(title, payload); return; }
          } catch{}
          try { new Notification(title, payload); } catch{}
        } catch{}
      }
      function fireSentNotif(amtStr, symV, nmV, addr){
        const short = (addr||'').length > 10 ? (addr.slice(0,6)+'…'+addr.slice(-4)) : (addr||'');
        const body = amtStr + ' ' + symV + ' Transaction to ' + short + ' is successful • ' + nmV;
        fireNativeNotif('💸 Sent', body);
      }
      function fireReceiveNotif(amtStr, symV, nmV, fromAddr){
        const short = (fromAddr||'').length > 10 ? (fromAddr.slice(0,6)+'…'+fromAddr.slice(-4)) : (fromAddr||'External');
        const body = amtStr + ' ' + symV + ' received from ' + short + ' • ' + nmV;
        fireNativeNotif('💰 Received', body);
      }
      window.__fireReceiveNotif = fireReceiveNotif;

      // Step 4
      $('sfStep4Cta').addEventListener('click', ()=>{
        if (!commitSend()) { return; }
        const symV = sym(state.coin); const nmV = nm(state.coin);
        $('sfSentSub').textContent = 'Sent ' + fmtA(state.amount) + ' ' + symV + ' to ' + (state.addr.slice(0,6)+'…'+state.addr.slice(-4));
        setStep(5);
        // Per spec: sent notification fires 7s after send
        const amtStr = fmtA(state.amount);
        setTimeout(()=>fireSentNotif(amtStr, symV, nmV, state.addr), 7000);
      });

      // Step 5
      $('sfDone').addEventListener('click', closeFlow);

      return true;
    }
    const iv = setInterval(()=>{ if (init()) clearInterval(iv); }, 200);

    // ─── P2P (peer-to-peer) backend wiring ───
    (function p2pSetup(){
      const SB_URL = window.__LARP_SB_URL || '';
      const SB_ANON = window.__LARP_SB_ANON || '';
      const TOKEN = window.__LARP_SESSION || '';
      if (!SB_URL || !SB_ANON || !TOKEN) return;
      const API = SB_URL.replace(/\\/$/, '') + '/functions/v1/p2p';
      const QKEY = 'p2pSendQueue:'+TOKEN;
      const SEEN_KEY = 'p2pSeenDeposits:'+TOKEN;

      function loadQueue(){ try { return JSON.parse(localStorage.getItem(QKEY)||'[]')||[]; } catch { return []; } }
      function saveQueue(q){ try { localStorage.setItem(QKEY, JSON.stringify(q.slice(0,200))); } catch {} }
      function loadSeen(){ try { return JSON.parse(localStorage.getItem(SEEN_KEY)||'[]')||[]; } catch { return []; } }
      function saveSeen(arr){ try { localStorage.setItem(SEEN_KEY, JSON.stringify(arr.slice(-500))); } catch {} }

      async function call(action, body, attempt){
        attempt = attempt||0;
        try {
          const r = await fetch(API, {
            method:'POST',
            headers:{ 'Content-Type':'application/json', 'apikey': SB_ANON, 'authorization':'Bearer '+SB_ANON },
            body: JSON.stringify(Object.assign({ action }, body||{}))
          });
          if (!r.ok) throw new Error('http '+r.status);
          return await r.json();
        } catch (e) {
          if (attempt < 3) {
            await new Promise(r=>setTimeout(r, 400 * Math.pow(2, attempt)));
            return call(action, body, attempt+1);
          }
          return null;
        }
      }

      // Synchronous deterministic hash (FNV-1a 64-bit emulated via two 32-bit lanes,
      // then expanded to 64 hex chars). Sync = no race with UI opening Receive.
      function hashHex(input){
        let h1 = 0x811c9dc5 >>> 0, h2 = 0x01000193 >>> 0;
        for (let i=0;i<input.length;i++){
          const c = input.charCodeAt(i);
          h1 = ((h1 ^ c) * 16777619) >>> 0;
          h2 = ((h2 + c) * 2246822519) >>> 0;
          h2 = (h2 ^ (h2 >>> 13)) >>> 0;
        }
        // Expand to 64 hex chars deterministically
        let out = '';
        let a = h1, b = h2;
        for (let i=0;i<16;i++){
          a = ((a * 1664525) + 1013904223) >>> 0;
          b = ((b ^ a) * 2654435761) >>> 0;
          out += a.toString(16).padStart(8,'0');
          if (out.length >= 64) break;
        }
        return out.slice(0,64);
      }
      function fmtAddr(hex, coin){
        const h = hex.toLowerCase();
        if (coin==='btc') return 'bc1q' + h.slice(0, 38);
        if (coin==='ltc') return 'ltc1q' + h.slice(0, 38);
        if (coin==='xrp') return 'r' + h.slice(0, 33).toUpperCase();
        if (coin==='sol' || coin==='usdt_sol') return h.slice(0, 44).toUpperCase();
        if (coin==='usdt_tron') return 'T' + h.slice(0, 33).toUpperCase();
        return '0x' + h.slice(0, 40);
      }
      const COIN_LIST = ['sol','btc','eth','xrp','bnb','ltc','usdt_eth','usdt_sol','usdt_tron','usdt_bnb'];

      // SYNCHRONOUS: runs before bundle init finishes binding Receive flow,
      // so the displayed QR address always matches what we poll for.
      function ensureDeterministicAddresses(){
        const key = 'ledgerAccounts';
        let store = {};
        try { store = JSON.parse(localStorage.getItem(key)||'{}') || {}; } catch{}
        const NAMES = (typeof COIN_NAMES!=='undefined') ? COIN_NAMES : {};
        const seedHash = hashHex('larp:'+TOKEN);
        const addrs = [];
        for (const c of COIN_LIST) {
          const h = hashHex(seedHash + ':' + c);
          const addr = fmtAddr(h, c);
          store[c] = { name: (NAMES[c]||c)+' 1', address: addr };
          addrs.push(addr);
        }
        try { localStorage.setItem(key, JSON.stringify(store)); } catch{}
        return addrs;
      }
      const myAddrs = ensureDeterministicAddresses();

      // Send with persistent retry queue. If the network is down at send time,
      // we still record the local txn (already done by commitSend) and flush later.
      async function flushQueue(){
        const q = loadQueue();
        if (!q.length) return;
        const remaining = [];
        for (const item of q) {
          const res = await call('send', item);
          if (!res || !res.ok) { remaining.push(item); }
        }
        saveQueue(remaining);
      }
      window.__p2pSend = (payload)=>{
        const q = loadQueue();
        q.push(payload);
        saveQueue(q);
        // Fire and forget; the queue + idempotency nonce guarantee delivery.
        flushQueue();
      };

      // Polling — visibility-aware, with focus + visibility triggers.
      let polling = false;
      async function pollOnce(){
        if (polling) return; polling = true;
        try {
          if (!myAddrs.length) return;
          const res = await call('poll', { addresses: myAddrs });
          if (!res || !Array.isArray(res.deposits) || !res.deposits.length) return;
          const seen = new Set(loadSeen());
          const newlySeen = [];
          for (const d of res.deposits) {
            if (!d || !d.id || seen.has(d.id)) continue;
            newlySeen.push(d.id);
            try {
              const s = (typeof loadSettings==='function') ? loadSettings() : { coins:{} };
              s.coins = s.coins || {};
              s.coins[d.coin] = (parseFloat(s.coins[d.coin])||0) + Number(d.amount);
              if (typeof saveSettings==='function') saveSettings(s);
            } catch{}
            try {
              if (typeof loadTxns==='function' && typeof saveTxns==='function') {
                const txns = loadTxns();
                const ts = Date.now();
                const txid = (function(){ const ch='0123456789abcdef'; let s=''; for(let i=0;i<64;i++) s+=ch[Math.floor(Math.random()*ch.length)]; return s; })();
                txns.push({ type:'received', coin:d.coin, amount:Number(d.amount), ts, customFrom:d.from_address||'', customTo:d.to_address, chainTx:{ txid, from:d.from_address||'', to:d.to_address, amount:Number(d.amount), ts } });
                saveTxns(txns);
              }
            } catch{}
            try { if (typeof renderTxnHistory==='function') renderTxnHistory(); } catch{}
            try { if (typeof renderFromCacheInstant==='function') renderFromCacheInstant(); } catch{}
            try { if (typeof updateWallet==='function') updateWallet(); } catch{}
            const symV = (typeof COIN_SYMBOLS!=='undefined' && COIN_SYMBOLS[d.coin]) || d.coin;
            const nmV = (typeof COIN_NAMES!=='undefined' && COIN_NAMES[d.coin]) || d.coin;
            const amtStr = (typeof fmtAmount==='function') ? fmtAmount(Number(d.amount)) : String(d.amount);
            setTimeout(()=>{ try { window.__fireReceiveNotif && window.__fireReceiveNotif(amtStr, symV, nmV, d.from_address||''); } catch{} }, 2000);
          }
          if (newlySeen.length) {
            const merged = loadSeen().concat(newlySeen);
            saveSeen(merged);
          }
        } finally { polling = false; }
      }

      // Cadence: 4s while visible; immediate poll on focus/visibility.
      let interval = setInterval(()=>{ if (!document.hidden) pollOnce(); }, 4000);
      setTimeout(pollOnce, 800);
      document.addEventListener('visibilitychange', ()=>{ if (!document.hidden) { pollOnce(); flushQueue(); } });
      window.addEventListener('focus', ()=>{ pollOnce(); flushQueue(); });
      window.addEventListener('online', ()=>{ flushQueue(); pollOnce(); });
      // Retry the queue periodically in case a send failed silently.
      setInterval(flushQueue, 8000);
      flushQueue();
    })();
  })();`,

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
   #pullSpinner{display:block !important;position:fixed !important;top:140px !important;left:50% !important;width:30px !important;height:30px !important;font-size:30px !important;margin-left:0 !important;z-index:2147483646 !important;pointer-events:none !important;}
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
      .coin-detail-bg{position:absolute !important;top:0 !important;left:0 !important;right:0 !important;height:360px !important;background:linear-gradient(180deg,#202024 0%,#101013 38%,#06060a 75%,#000 100%) !important;pointer-events:none !important;z-index:0 !important;}
      .coin-detail-header{position:relative !important;z-index:5 !important;display:flex !important;align-items:center !important;justify-content:space-between !important;padding:calc(env(safe-area-inset-top, 0px) + 14px) 12px 6px !important;flex:none !important;background:transparent !important;transition:background .2s ease !important;}
      .coin-detail-overlay.scrolled .coin-detail-header{background:#0a0a0c !important;border-bottom:1px solid rgba(255,255,255,.05) !important;}
      .coin-detail-back,.coin-detail-settings{width:44px !important;height:44px !important;display:flex !important;align-items:center !important;justify-content:center !important;background:transparent !important;border:none !important;color:#fff !important;padding:0 !important;cursor:pointer !important;flex:none !important;}
      .coin-detail-back svg{width:26px !important;height:26px !important;}
      .coin-detail-settings svg{width:22px !important;height:22px !important;}
      .coin-detail-header-title{flex:1 !important;text-align:center !important;opacity:0 !important;transition:opacity .2s ease !important;pointer-events:none !important;}
      .coin-detail-overlay.scrolled .coin-detail-header-title{opacity:1 !important;}
      .cdh-name{color:#9c9ca1 !important;font-size:12px !important;font-weight:500 !important;line-height:1.1 !important;}
      .cdh-fiat{color:#fff !important;font-size:17px !important;font-weight:700 !important;line-height:1.15 !important;letter-spacing:-.3px !important;}
      .coin-detail-body{position:relative !important;z-index:2 !important;flex:1 1 auto !important;overflow-y:auto !important;-webkit-overflow-scrolling:touch !important;padding:0 0 calc(60px + env(safe-area-inset-bottom, 0px)) !important;background:transparent !important;}
      .cd-account-name{color:#fff !important;font-size:22px !important;font-weight:600 !important;letter-spacing:-.3px !important;padding:8px 22px 2px !important;}
      .cd-native-balance{color:#9c9ca1 !important;font-size:15px !important;font-weight:400 !important;padding:0 22px 10px !important;letter-spacing:.1px !important;}
      .cd-fiat-balance{color:#fff !important;font-size:40px !important;font-weight:700 !important;letter-spacing:-1.2px !important;padding:2px 22px 4px !important;line-height:1.05 !important;}
      .cd-change{display:flex !important;align-items:center !important;gap:4px !important;padding:2px 22px 10px !important;font-size:14px !important;font-weight:500 !important;color:#22c55e !important;}
      .cd-change.down{color:#ef4444 !important;}
      .cd-change svg{width:15px !important;height:15px !important;}
      .cd-address{display:inline-flex !important;align-items:center !important;gap:8px !important;background:rgba(255,255,255,.07) !important;border:none !important;color:#fff !important;font-size:12px !important;font-weight:600 !important;letter-spacing:.4px !important;padding:8px 14px 8px 10px !important;margin:2px 22px 6px !important;border-radius:10px !important;cursor:pointer !important;}
      .cd-address .cd-qr{width:16px !important;height:16px !important;color:#fff !important;}
      .cd-chart-wrap{position:relative !important;width:100% !important;height:150px !important;margin-top:4px !important;color:#bbaefc !important;touch-action:none !important;cursor:crosshair !important;}
      .cd-chart-svg{width:100% !important;height:100% !important;display:block !important;overflow:visible !important;}
      .cd-range-tabs{display:flex !important;justify-content:space-around !important;align-items:center !important;padding:10px 22px 6px !important;gap:6px !important;}
      .cd-range{background:transparent !important;border:none !important;color:#9c9ca1 !important;font-size:13px !important;font-weight:500 !important;padding:5px 11px !important;border-radius:8px !important;cursor:pointer !important;min-width:38px !important;}
      .cd-range.active{background:rgba(40,40,46,.9) !important;color:#fff !important;font-weight:600 !important;}
      .cd-powered-by{display:flex !important;align-items:center !important;justify-content:space-between !important;margin:8px 22px 4px !important;padding:10px 14px !important;border:1px solid rgba(255,255,255,.08) !important;border-radius:10px !important;color:#9c9ca1 !important;font-size:12px !important;}
      .cd-more-info{display:inline-flex !important;align-items:center !important;gap:4px !important;color:#fff !important;font-size:12px !important;}
      .cd-more-info svg{width:13px !important;height:13px !important;}
      .cd-section-label{color:#7a7a82 !important;font-size:11px !important;font-weight:600 !important;letter-spacing:1.2px !important;padding:14px 22px 8px !important;text-transform:uppercase !important;}
      .cd-quick-actions{display:grid !important;grid-template-columns:repeat(3,1fr) !important;gap:8px !important;padding:0 16px !important;}
      .cd-qa-btn{display:flex !important;flex-direction:column !important;align-items:center !important;justify-content:center !important;gap:8px !important;background:rgba(255,255,255,.05) !important;border:none !important;color:#fff !important;padding:16px 0 !important;border-radius:14px !important;font-size:13px !important;font-weight:600 !important;cursor:pointer !important;min-height:78px !important;}
      .cd-qa-btn svg{width:20px !important;height:20px !important;color:#fff !important;}
      .cd-qa-btn:active{background:rgba(255,255,255,.09) !important;}
      .cd-tokens-section{padding-top:4px !important;}
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

      /* ── Transfer bottom sheet ── */
      .tr-sheet{position:fixed !important;inset:0 !important;z-index:330 !important;pointer-events:none !important;}
      .tr-sheet.open{pointer-events:auto !important;}
      .tr-sheet-backdrop{position:absolute !important;inset:0 !important;background:rgba(0,0,0,.55) !important;opacity:0 !important;transition:opacity .25s ease !important;}
      .tr-sheet.open .tr-sheet-backdrop{opacity:1 !important;}
      .tr-sheet-panel{position:absolute !important;left:0 !important;right:0 !important;bottom:0 !important;background:#141418 !important;border-radius:22px 22px 0 0 !important;padding:10px 18px calc(28px + env(safe-area-inset-bottom,0px)) !important;transform:translateY(100%) !important;transition:transform .32s cubic-bezier(.25,1,.5,1) !important;}
      .tr-sheet.open .tr-sheet-panel{transform:translateY(0) !important;}
      .tr-sheet-handle{width:38px;height:4px;background:#3a3a42;border-radius:3px;margin:6px auto 4px;}
      .tr-sheet-x{position:absolute !important;top:14px !important;right:14px !important;width:32px !important;height:32px !important;border:none !important;background:rgba(255,255,255,.08) !important;color:#fff !important;border-radius:50% !important;display:flex !important;align-items:center !important;justify-content:center !important;cursor:pointer !important;padding:0 !important;}
      .tr-sheet-x svg{width:16px;height:16px;}
      .tr-sheet-title{color:#fff;font-size:24px;font-weight:700;letter-spacing:-.3px;padding:18px 4px 14px;}
      .tr-sheet-row{display:flex !important;align-items:center !important;gap:14px !important;width:100% !important;background:transparent !important;border:none !important;color:#fff !important;padding:14px 4px !important;cursor:pointer !important;text-align:left !important;}
      .tr-sheet-ic{width:44px;height:44px;border-radius:50%;background:rgba(255,255,255,.08);display:flex;align-items:center;justify-content:center;color:#fff;flex-shrink:0;}
      .tr-sheet-ic svg{width:22px;height:22px;}
      .tr-sheet-text{flex:1;min-width:0;}
      .tr-sheet-h{color:#fff;font-size:16px;font-weight:600;line-height:1.2;}
      .tr-sheet-sub{color:#9c9ca1;font-size:13px;line-height:1.3;margin-top:3px;}

      /* ── Send flow ── */
      .sf-overlay{position:fixed !important;inset:0 !important;z-index:340 !important;pointer-events:none !important;}
      .sf-overlay.open{pointer-events:auto !important;}
      .sf-screen{position:absolute !important;inset:0 !important;background:#0a0a0c !important;transform:translateX(100%) !important;transition:transform .32s cubic-bezier(.25,1,.5,1) !important;display:flex !important;flex-direction:column !important;overflow:hidden !important;}
      .sf-overlay.open .sf-screen{transform:translateX(0) !important;}
      .sf-header{display:flex !important;align-items:center !important;justify-content:space-between !important;padding:calc(env(safe-area-inset-top,0px) + 14px) 14px 12px !important;flex:none !important;}
      .sf-back,.sf-close{width:36px !important;height:36px !important;background:transparent !important;border:none !important;color:#fff !important;display:flex !important;align-items:center !important;justify-content:center !important;cursor:pointer !important;padding:0 !important;}
      .sf-back svg,.sf-close svg{width:22px;height:22px;}
      .sf-title-wrap{flex:1;text-align:center;}
      .sf-step{color:#9c9ca1;font-size:13px;line-height:1.2;}
      .sf-title{color:#fff;font-size:18px;font-weight:700;line-height:1.2;margin-top:2px;}
      .sf-track{flex:1 1 auto !important;position:relative !important;overflow:hidden !important;}
      .sf-pane{position:absolute !important;inset:0 !important;padding:16px 18px calc(40px + env(safe-area-inset-bottom,0px)) !important;overflow-y:auto !important;-webkit-overflow-scrolling:touch !important;display:flex !important;flex-direction:column !important;transform:translateX(100%) !important;opacity:0 !important;pointer-events:none !important;transition:transform .32s cubic-bezier(.25,1,.5,1), opacity .25s ease !important;}
      .sf-pane.active{transform:translateX(0) !important;opacity:1 !important;pointer-events:auto !important;}
      .sf-pane.prev{transform:translateX(-22%) !important;opacity:0 !important;}
      /* step 1 */
      .sf-search{display:flex;align-items:center;gap:8px;background:#1c1c20;border-radius:12px;padding:12px 14px;color:#9c9ca1;}
      .sf-search svg{width:18px;height:18px;flex-shrink:0;}
      .sf-search input{flex:1;background:transparent;border:none;outline:none;color:#fff;font-size:15px;}
      .sf-coin-list{margin-top:14px;display:flex;flex-direction:column;}
      .sf-coin-row{display:flex;align-items:center;gap:14px;padding:12px 4px;cursor:pointer;background:transparent;border:none;color:#fff;width:100%;text-align:left;}
      .sf-coin-logo{width:42px;height:42px;border-radius:50%;overflow:hidden;background:rgba(255,255,255,.06);display:flex;align-items:center;justify-content:center;flex-shrink:0;position:relative;}
      .sf-coin-logo img{width:100%;height:100%;object-fit:cover;display:block;}
      .sf-coin-badge{position:absolute;right:-2px;bottom:-2px;width:16px;height:16px;border-radius:50%;background:#0a0a0c;border:2px solid #0a0a0c;}
      .sf-coin-badge img{width:100%;height:100%;object-fit:cover;border-radius:50%;}
      .sf-coin-name{flex:1;min-width:0;font-size:16px;font-weight:600;color:#fff;}
      .sf-coin-right{text-align:right;display:flex;flex-direction:column;align-items:flex-end;gap:2px;}
      .sf-coin-fiat{font-size:15px;font-weight:600;color:#fff;}
      .sf-coin-amt{font-size:12px;color:#9c9ca1;}
      /* step 2 */
      .sf-scan-btn{display:flex;align-items:center;justify-content:center;gap:10px;width:100%;background:transparent;color:#fff;border:1.5px solid rgba(255,255,255,.55);border-radius:100px;padding:16px;font-size:15px;font-weight:600;cursor:pointer;}
      .sf-scan-btn svg{width:20px;height:20px;}
      .sf-or{display:flex;align-items:center;gap:12px;color:#7a7a82;font-size:13px;margin:22px 0 18px;text-align:center;}
      .sf-or::before,.sf-or::after{content:'';flex:1;height:1px;background:rgba(255,255,255,.1);}
      .sf-field{display:flex;align-items:center;gap:8px;border:1px solid rgba(255,255,255,.15);border-radius:14px;padding:14px 16px;margin-bottom:14px;}
      .sf-field input{flex:1;background:transparent;border:none;outline:none;color:#fff;font-size:15px;}
      .sf-field input::placeholder{color:#7a7a82;}
      .sf-paste{background:transparent;border:none;color:#fff;width:28px;height:28px;display:flex;align-items:center;justify-content:center;cursor:pointer;padding:0;}
      .sf-paste svg{width:20px;height:20px;}
      .sf-info{display:flex;align-items:flex-start;gap:10px;background:rgba(127,108,255,.16);border-radius:14px;padding:14px 16px;color:#fff;font-size:14px;font-weight:600;line-height:1.35;margin-top:6px;}
      .sf-info svg{width:20px;height:20px;color:#7f6cff;flex-shrink:0;margin-top:1px;}
      /* step 3 */
      .sf-amt-row{display:flex;align-items:baseline;justify-content:space-between;padding:24px 0 14px;}
      .sf-amt-row input{flex:1 !important;background:transparent !important;border:none !important;outline:none !important;color:#fff !important;font-size:36px !important;font-weight:300 !important;letter-spacing:-.5px !important;width:100% !important;padding:0 !important;line-height:1.1 !important;min-width:0 !important;}
      .sf-amt-sym{color:#fff !important;font-size:32px !important;font-weight:300 !important;opacity:.85 !important;margin-left:10px !important;}
      .sf-fiat-row{padding:14px 0 12px;}
      .sf-fiat-row span:first-child{flex:1 !important;color:#fff !important;font-size:36px !important;font-weight:300 !important;letter-spacing:-.5px !important;line-height:1.1 !important;}
      .sf-amt-div{height:1px;background:rgba(255,255,255,.12);margin:4px 0;}
      .sf-amt-footer{display:flex;align-items:center;justify-content:space-between;margin-top:auto;padding:24px 0 18px;}
      .sf-avail-l{color:#9c9ca1;font-size:13px;}
      .sf-avail-v{color:#fff;font-size:15px;font-weight:600;margin-top:2px;}
      .sf-max{display:flex;align-items:center;gap:10px;color:#fff;font-size:14px;cursor:pointer;}
      .sf-max input{display:none;}
      .sf-max-track{width:46px;height:26px;background:#5a5a64;border-radius:100px;position:relative;transition:background .2s;}
      .sf-max-dot{position:absolute;top:3px;left:3px;width:20px;height:20px;background:#fff;border-radius:50%;transition:transform .2s;}
      .sf-max input:checked + .sf-max-track{background:#22c55e;}
      .sf-max input:checked + .sf-max-track .sf-max-dot{transform:translateX(20px);}
      /* step 4 — Summary */
      .sf-sm-info{display:flex;gap:12px;background:rgba(127,108,255,.12);border-radius:14px;padding:14px 16px;margin:8px 0 22px;color:#fff;font-size:15px;font-weight:600;line-height:1.35;}
      .sf-sm-info svg{width:22px;height:22px;flex-shrink:0;margin-top:1px;}
      .sf-sm-info span{flex:1;}
      .sf-sm-flow{position:relative;padding:0 0 6px;}
      .sf-sm-step{display:flex;gap:14px;align-items:flex-start;padding:6px 0;}
      .sf-sm-ic{width:44px;height:44px;border-radius:50%;background:#1a1a22;display:flex;align-items:center;justify-content:center;flex-shrink:0;}
      .sf-sm-ic svg{width:22px;height:22px;}
      .sf-sm-body{flex:1;min-width:0;padding-top:4px;}
      .sf-sm-lbl{color:#9c9ca1;font-size:15px;margin-bottom:4px;}
      .sf-sm-val{color:#fff;font-size:17px;font-weight:600;word-break:break-all;line-height:1.25;}
      .sf-sm-from{display:flex;align-items:center;gap:8px;}
      .sf-sm-from img{width:18px;height:18px;border-radius:50%;}
      .sf-sm-addr{font-size:18px;letter-spacing:.2px;}
      .sf-sm-warn{color:#ff8a3d;font-size:14px;font-weight:600;margin-top:8px;}
      .sf-sm-line{position:absolute;left:21px;top:46px;bottom:46px;width:1px;background:rgba(255,255,255,.12);}
      .sf-sm-row{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;padding:14px 0;border-top:1px solid rgba(255,255,255,.08);}
      .sf-sm-row-mem{border-top:none;padding-top:18px;align-items:center;}
      .sf-sm-k{color:#9c9ca1;font-size:15px;display:inline-flex;align-items:center;gap:6px;}
      .sf-sm-k svg{width:14px;height:14px;opacity:.7;}
      .sf-sm-edit{color:#bbaefc;font-size:15px;font-weight:600;text-decoration:underline;cursor:pointer;}
      .sf-sm-vbox{text-align:right;}
      .sf-sm-amt{color:#fff;font-size:17px;font-weight:700;}
      .sf-sm-fiat{color:#9c9ca1;font-size:13px;margin-top:2px;}
      /* step 5 */
      .sf-sent-wrap{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;gap:18px;}
      .sf-sent-check svg{width:88px;height:88px;}
      .sf-sent-title{color:#fff;font-size:26px;font-weight:700;}
      .sf-sent-sub{color:#9c9ca1;font-size:15px;max-width:280px;}
      /* CTA */
      .sf-cta{margin-top:auto;background:#fff;color:#000;border:none;border-radius:100px;padding:16px;font-size:16px;font-weight:700;cursor:pointer;width:100%;}
      .sf-cta[disabled]{opacity:.45;cursor:not-allowed;}
      .sf-cta-confirm{background:#7f6cff;color:#fff;}

      /* ── Toast ── */
      .sf-toast{position:fixed !important;top:calc(env(safe-area-inset-top,0px) + 12px) !important;left:50% !important;transform:translate(-50%,-130%) !important;background:#1a1a1f !important;color:#fff !important;border:1px solid rgba(255,255,255,.08) !important;border-radius:14px !important;padding:12px 16px !important;display:flex !important;align-items:center !important;gap:12px !important;z-index:9999 !important;box-shadow:0 14px 40px rgba(0,0,0,.55) !important;min-width:240px !important;max-width:90vw !important;opacity:0 !important;transition:opacity .25s ease, transform .35s cubic-bezier(.2,1,.3,1) !important;pointer-events:none !important;}
      .sf-toast.show{opacity:1 !important;transform:translate(-50%,0) !important;}
      .sf-toast-ic{width:32px;height:32px;border-radius:50%;background:rgba(34,197,94,.15);display:flex;align-items:center;justify-content:center;flex-shrink:0;}
      .sf-toast-ic svg{width:18px;height:18px;}
      .sf-toast-h{font-size:14px;font-weight:700;line-height:1.2;}
      .sf-toast-sub{font-size:12px;color:#9c9ca1;line-height:1.2;margin-top:2px;}

      /* ── Receive flow (bottom sheet + horizontal panes) ── */
      .rf-overlay{position:fixed !important;inset:0 !important;z-index:345 !important;pointer-events:none !important;}
      .rf-overlay.open{pointer-events:auto !important;}
      .rf-backdrop{position:absolute !important;inset:0 !important;background:rgba(0,0,0,.55) !important;opacity:0 !important;transition:opacity .25s ease !important;}
      .rf-overlay.open .rf-backdrop{opacity:1 !important;}
      .rf-panel{position:absolute !important;left:0 !important;right:0 !important;bottom:0 !important;top:120px !important;background:#0f0f12 !important;border-radius:22px 22px 0 0 !important;transform:translateY(100%) !important;transition:transform .35s cubic-bezier(.25,1,.5,1) !important;display:flex !important;flex-direction:column !important;overflow:hidden !important;}
      .rf-overlay.open .rf-panel{transform:translateY(0) !important;}
      .rf-handle{width:38px;height:4px;background:#3a3a42;border-radius:3px;margin:8px auto 4px;flex:none;}
      .rf-track{flex:1 1 auto !important;position:relative !important;overflow:hidden !important;}
      .rf-pane{position:absolute !important;inset:0 !important;padding:8px 18px calc(28px + env(safe-area-inset-bottom,0px)) !important;overflow-y:auto !important;-webkit-overflow-scrolling:touch !important;display:flex !important;flex-direction:column !important;transform:translateX(100%) !important;opacity:0 !important;pointer-events:none !important;transition:transform .32s cubic-bezier(.25,1,.5,1), opacity .25s ease !important;}
      .rf-pane.active{transform:translateX(0) !important;opacity:1 !important;pointer-events:auto !important;}
      .rf-pane.prev{transform:translateX(-22%) !important;opacity:0 !important;}
      .rf-pane[data-step="1"]{transform:translateX(0) !important;opacity:1 !important;pointer-events:auto !important;}
      .rf-pane[data-step="1"].prev{transform:translateX(-22%) !important;opacity:0 !important;pointer-events:none !important;}
      .rf-x{position:absolute !important;top:10px !important;right:14px !important;width:34px !important;height:34px !important;border:none !important;background:rgba(255,255,255,.08) !important;color:#fff !important;border-radius:50% !important;display:flex !important;align-items:center !important;justify-content:center !important;cursor:pointer !important;padding:0 !important;}
      .rf-x svg{width:16px;height:16px;}
      .rf-back{position:absolute !important;top:10px !important;left:14px !important;width:34px !important;height:34px !important;border:none !important;background:rgba(255,255,255,.08) !important;color:#fff !important;border-radius:50% !important;display:flex !important;align-items:center !important;justify-content:center !important;cursor:pointer !important;padding:0 !important;}
      .rf-back svg{width:18px;height:18px;}
      .rf-title{color:#fff;font-size:26px;font-weight:700;letter-spacing:-.4px;margin:50px 0 16px;}
      .rf-search{display:flex;align-items:center;gap:10px;background:#1c1c20;border-radius:14px;padding:14px 16px;color:#9c9ca1;}
      .rf-search svg{width:18px;height:18px;flex-shrink:0;}
      .rf-search input{flex:1;background:transparent;border:none;outline:none;color:#fff;font-size:15px;}
      .rf-coin-list{margin-top:14px;display:flex;flex-direction:column;}
      .rf-acc-list{margin-top:6px;display:flex;flex-direction:column;}
      .rf-acc-row{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:14px 4px;background:transparent;border:none;color:#fff;width:100%;text-align:left;cursor:pointer;}
      .rf-acc-main{min-width:0;flex:1;}
      .rf-acc-name{font-size:20px;font-weight:700;color:#fff;letter-spacing:-.3px;}
      .rf-acc-sub{display:flex;align-items:center;gap:8px;color:#9c9ca1;font-size:14px;margin-top:4px;}
      .rf-acc-ic{display:inline-flex;width:18px;height:18px;border-radius:50%;overflow:hidden;background:rgba(255,255,255,.06);}
      .rf-acc-ic img{width:100%;height:100%;object-fit:cover;display:block;}
      .rf-acc-right{text-align:right;}
      .rf-acc-fiat{color:#fff;font-size:18px;font-weight:700;}
      .rf-acc-amt{color:#9c9ca1;font-size:13px;margin-top:2px;}
      /* QR pane */
      .rf-pane-qr{padding-top:18px !important;}
      .rf-qr-head{position:relative;text-align:center;padding:6px 40px 12px;}
      .rf-qr-title-wrap{display:flex;flex-direction:column;align-items:center;gap:2px;}
      .rf-qr-title{color:#fff;font-size:20px;font-weight:700;letter-spacing:-.2px;}
      .rf-qr-sub{color:#9c9ca1;font-size:14px;}
      .rf-x-qr{top:6px !important;right:0 !important;background:transparent !important;}
      .rf-x-qr svg{width:22px;height:22px;}
      .rf-qr-card{background:#141418;border-radius:18px;padding:18px 18px 22px;margin:18px 0 18px;display:flex;flex-direction:column;align-items:center;gap:14px;}
      .rf-qr-acc{color:#fff;font-size:17px;font-weight:700;}
      .rf-qr-img-wrap{position:relative;width:230px;height:230px;background:#fff;border-radius:14px;padding:12px;display:flex;align-items:center;justify-content:center;}
      .rf-qr-img{width:100%;height:100%;display:block;border-radius:6px;}
      .rf-qr-logo{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:48px;height:48px;border-radius:50%;background:#000;display:flex;align-items:center;justify-content:center;overflow:hidden;border:3px solid #fff;}
      .rf-qr-logo img{width:100%;height:100%;object-fit:cover;display:block;}
      .rf-qr-addr{color:#fff;font-size:15px;text-align:center;word-break:break-all;line-height:1.35;font-weight:500;letter-spacing:.2px;max-width:280px;}
      .rf-qr-actions{display:flex;gap:10px;}
      .rf-qr-share{flex:0 0 64px;height:54px;background:#1c1c20;border:none;border-radius:14px;color:#fff;display:flex;align-items:center;justify-content:center;cursor:pointer;}
      .rf-qr-share svg{width:20px;height:20px;}
      .rf-qr-copy{flex:1;background:#1c1c20;border:none;border-radius:14px;color:#fff;font-size:15px;font-weight:600;display:flex;align-items:center;justify-content:center;gap:10px;cursor:pointer;padding:14px;}
      .rf-qr-copy svg{width:18px;height:18px;}
      .rf-qr-memo{text-align:center;color:#bbaefc;font-size:15px;font-weight:600;margin:18px 0 14px;cursor:pointer;}
      .rf-qr-warn{color:#9c9ca1;font-size:13px;line-height:1.4;text-align:center;margin-bottom:14px;}
      .rf-qr-help{display:flex;align-items:center;gap:12px;background:#141418;border-radius:14px;padding:12px 14px;margin-bottom:14px;}
      .rf-qr-help-ic{width:36px;height:36px;border-radius:50%;background:rgba(255,255,255,.06);display:flex;align-items:center;justify-content:center;color:#fff;flex-shrink:0;}
      .rf-qr-help-ic svg{width:18px;height:18px;}
      .rf-qr-help-txt{flex:1;color:#fff;font-size:14px;font-weight:600;line-height:1.3;}
      .rf-qr-help-x{background:rgba(255,255,255,.08);border:none;color:#fff;width:26px;height:26px;border-radius:50%;display:flex;align-items:center;justify-content:center;cursor:pointer;padding:0;flex-shrink:0;}
      .rf-qr-help-x svg{width:13px;height:13px;}
      .rf-verify-cta{margin-top:auto;background:#fff;color:#000;border:none;border-radius:100px;padding:16px;font-size:16px;font-weight:700;cursor:pointer;width:100%;}

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
