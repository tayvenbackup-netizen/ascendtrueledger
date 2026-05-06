// ============================================================
//  ledger.js — fully decoded / deobfuscated
//  Original was obfuscated with a string-array rotation shuffle by apibroker.
// ============================================================

// ── Auth / device-guard bootstrap (runs immediately on load) ─────────────────

(async () => {
    const pageToken = document.querySelector('meta[name="page-token"]')?.content;
    if (!pageToken) {
        window.location.href = '/?v=l#login';
        return;
    }
    try {
        const res  = await fetch('/api/verify-token', {
            method:      'POST',
            headers:     { 'Content-Type': 'application/json' },
            credentials: 'include',
            body:        JSON.stringify({ token: pageToken })
        });
        const data = await res.json();
        if (!data.valid) {
            window.location.href = '/?v=l#login';
            return;
        }
        window.__rt = data.runtimeToken;
    } catch (_err) {
        window.location.href = '/?v=l#login';
    }
})();

// Mobile-only guard — redirects desktop visitors to '/'
(function () {
    if (document.querySelector('meta[name="dev-mode"]')) return;
    const hasTouchPoints = navigator.maxTouchPoints > 0 || 'ontouchstart' in window;
    const isNarrow       = window.innerWidth <= 820;
    if (!hasTouchPoints || !isNarrow) {
        document.body.innerHTML = '';
        window.location.href    = '/';
        return;
    }
})();

// ── Constants ────────────────────────────────────────────────────────────────

const COINGECKO_IDS = {
    btc: 'bitcoin',
    eth: 'ethereum',
    xrp: 'ripple',
    bnb: 'binancecoin',
    sol: 'solana',
    ltc: 'litecoin'
};

const CURRENCIES = {
    usd: { symbol: '$',   name: 'USD' },
    eur: { symbol: '€',   name: 'EUR' },
    gbp: { symbol: '£',   name: 'GBP' },
    cad: { symbol: 'CA$', name: 'CAD' },
    aud: { symbol: 'A$',  name: 'AUD' },
    jpy: { symbol: '¥',   name: 'JPY' },
    chf: { symbol: 'CHF', name: 'CHF' },
    cny: { symbol: '¥',   name: 'CNY' },
    inr: { symbol: '₹',   name: 'INR' },
    brl: { symbol: 'R$',  name: 'BRL' },
    sek: { symbol: 'kr',  name: 'SEK' },
    nok: { symbol: 'kr',  name: 'NOK' },
    nzd: { symbol: 'NZ$', name: 'NZD' },
    sgd: { symbol: 'S$',  name: 'SGD' },
    hkd: { symbol: 'HK$', name: 'HKD' },
    krw: { symbol: '₩',   name: 'KRW' },
    try: { symbol: '₺',   name: 'TRY' },
    mxn: { symbol: 'MX$', name: 'MXN' },
    dkk: { symbol: 'kr',  name: 'DKK' },
    czk: { symbol: 'Kč',  name: 'CZK' }
};

const SUFFIX_CURRENCIES = [];

const COIN_NAMES = {
    btc: 'Bitcoin',
    eth: 'Ethereum',
    xrp: 'XRP',
    bnb: 'BNB Chain',
    sol: 'Solana',
    ltc: 'Litecoin'
};

const COIN_SYMBOLS = {
    btc: 'BTC',
    eth: 'ETH',
    xrp: 'XRP',
    bnb: 'BNB',
    sol: 'SOL',
    ltc: 'LTC'
};

const COIN_ICONS = {
    btc: 'bitcoin.avif',
    eth: 'ethereum-l.png',
    xrp: 'xrp.png',
    bnb: 'bnb.webp',
    sol: 'solana.avif',
    ltc: 'litecoin.png'
};

// Fallback prices used when network fetch fails (so balance never reads $0)
const FALLBACK_PRICES = {
    btc: 95000,
    eth: 3300,
    xrp: 2.30,
    bnb: 700,
    sol: 84.74,
    ltc: 90
};

const COIN_COLORS = {
    btc: '#FEAE35',
    eth: '#655AB3',
    xrp: '#3a3a3a',
    bnb: '#F3BA2F',
    sol: '#9945FF',
    ltc: '#345D9D'
};

const COIN_ORDER = ['btc','eth','xrp','bnb','sol','ltc'];

// Price cache TTL: 5 minutes (5 * 60 * 1000 ms)
const PRICE_CACHE_MS = 10 * 1000;
const CHART_CACHE_MS = 5 * 60 * 1000;

// ── Settings helpers ─────────────────────────────────────────────────────────

function loadSettings() {
    try {
        const saved = JSON.parse(localStorage.getItem('ledgerSettings'));
        if (!saved) return defaults();

        if (typeof saved.cgApiKey    === 'undefined') saved.cgApiKey    = '';
        if (typeof saved.cgApiKeyPro === 'undefined') saved.cgApiKeyPro = false;
        if (!saved.currency)                          saved.currency    = 'usd';
        if (!saved.coins)                             saved.coins       = defaults().coins;

        for (const coin of COIN_ORDER) {
            if (typeof saved.coins[coin] === 'undefined') saved.coins[coin] = 0;
        }
        return saved;
    } catch {
        return defaults();
    }
}

function saveSettings(settings) {
    localStorage.setItem('ledgerSettings', JSON.stringify(settings));
}

function defaults() {
    return {
        cgApiKey:    '',
        cgApiKeyPro: false,
        currency:    'usd',
        coins: COIN_ORDER.reduce((o,c)=>{o[c]=0;return o;},{})
    };
}

// ── Price / chart cache helpers ──────────────────────────────────────────────

function getCachedPrice(coin, currency, allowStale = true) {
    try {
        const raw = localStorage.getItem('lprice_' + coin + '_' + currency);
        if (!raw) return null;
        const cached = JSON.parse(raw);
        if (!allowStale && Date.now() - cached.ts > PRICE_CACHE_MS) return null;
        return cached;
    } catch {
        return null;
    }
}

function setCachedPrice(coin, currency, price, change24h) {
    localStorage.setItem(
        'lprice_' + coin + '_' + currency,
        JSON.stringify({ price, change24h, ts: Date.now() })
    );
}

const RANGE_CONFIG = {
    '1D':  { days: 1,    points: 24 },
    '1W':  { days: 7,    points: 28 },
    '1M':  { days: 30,   points: 30 },
    '1Y':  { days: 365,  points: 52 },
    'ALL': { days: 'max', points: 60 }
};
let currentRange = '1D';

function getCachedChart(coin, currency, range) {
    try {
        const raw = localStorage.getItem('lchart_' + coin + '_' + currency + '_' + range);
        if (!raw) return null;
        const cached = JSON.parse(raw);
        if (Date.now() - cached.ts > CHART_CACHE_MS) return null;
        return cached.prices;
    } catch {
        return null;
    }
}

function setCachedChart(coin, currency, range, prices) {
    localStorage.setItem(
        'lchart_' + coin + '_' + currency + '_' + range,
        JSON.stringify({ prices, ts: Date.now() })
    );
}

function fallbackTimestamps(length, days = 1) {
    const count = Math.max(length, 1);
    const end = Date.now();
    const span = (typeof days === 'number' ? days : 1825) * 24 * 60 * 60 * 1000;
    const start = end - span;
    return Array.from({ length: count }, (_, i) => start + (end - start) * (i / Math.max(count - 1, 1)));
}

// ── API fetchers ─────────────────────────────────────────────────────────────

async function fetchAllPrices(forceRefresh = false) {
    const settings   = loadSettings();
    const apiKey     = settings.cgApiKey  || '';
    const isPro      = !!settings.cgApiKeyPro;
    const currency   = settings.currency  || 'usd';

    if (!forceRefresh) {
        const allCached = Object.keys(COINGECKO_IDS).every(
            coin => getCachedPrice(coin, currency)
        );
        if (allCached) return;
    }

    const ids  = Object.values(COINGECKO_IDS).join(',');
    const base = isPro
        ? 'https://pro-api.coingecko.com/api/v3'
        : 'https://api.coingecko.com/api/v3';
    const url  = `${base}/simple/price?ids=${ids}&vs_currencies=${currency}&include_24hr_change=true&_t=${Date.now()}`;

    const headers = {};
    if (apiKey) headers[isPro ? 'x-cg-pro-api-key' : 'x-cg-demo-api-key'] = apiKey;

    try {
        const res  = await fetch(url, { headers, cache: 'no-store' });
        if (!res.ok) return;
        const data = await res.json();
        for (const [coin, geckoId] of Object.entries(COINGECKO_IDS)) {
            if (data[geckoId]) {
                setCachedPrice(
                    coin,
                    currency,
                    data[geckoId][currency],
                    data[geckoId][currency + '_24h_change']
                );
            }
        }
    } catch (err) {
        console.error('Price fetch error:', err);
    }
}

async function fetchCoinChart(coin, range = currentRange) {
    const settings = loadSettings();
    const currency = settings.currency || 'usd';
    const cfg      = RANGE_CONFIG[range] || RANGE_CONFIG['1D'];
    const cached   = getCachedChart(coin, currency, range);
    if (cached) return cached;

    const geckoId = COINGECKO_IDS[coin];
    const apiKey  = settings.cgApiKey || '';
    const isPro   = !!settings.cgApiKeyPro;

    const base = isPro
        ? 'https://pro-api.coingecko.com/api/v3'
        : 'https://api.coingecko.com/api/v3';
    const url  = `${base}/coins/${geckoId}/market_chart?vs_currency=${currency}&days=${cfg.days}`;

    const headers = {};
    if (apiKey) headers[isPro ? 'x-cg-pro-api-key' : 'x-cg-demo-api-key'] = apiKey;

    try {
        const res  = await fetch(url, { headers, cache: 'no-store' });
        if (!res.ok) return null;
        const data = await res.json();
        if (!data.prices || data.prices.length === 0) return null;

        const rawPrices = data.prices;
        const POINTS    = Math.min(cfg.points, rawPrices.length);
        const step      = (rawPrices.length - 1) / Math.max(POINTS - 1, 1);
        const sampled   = Array.from({ length: POINTS }, (_, i) => {
            const idx = Math.min(Math.round(i * step), rawPrices.length - 1);
            return { timestamp: rawPrices[idx][0], price: rawPrices[idx][1] };
        });

        setCachedChart(coin, currency, range, sampled);
        return sampled;
    } catch (err) {
        console.error('Chart fetch error (' + coin + '):', err);
        return null;
    }
}

// ── Formatting helpers ───────────────────────────────────────────────────────

function getCurrencySymbol() {
    const settings = loadSettings();
    const entry    = CURRENCIES[settings.currency] || CURRENCIES['usd'];
    return entry.symbol;
}

function fmtUSD(amount) {
    const settings = loadSettings();
    const symbol   = getCurrencySymbol();
    const formatted = Math.abs(amount).toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
    if (SUFFIX_CURRENCIES.includes(settings.currency)) return formatted + ' ' + symbol;
    return symbol + formatted;
}

function fmtAmount(amount) {
    return amount.toLocaleString('en-US', {
        minimumFractionDigits: 0,
        maximumFractionDigits: 6
    });
}

// ── State ────────────────────────────────────────────────────────────────────

let chartData      = [];
let BASE_PRICE     = 0;
let BASE_CHANGE_AMT = 0;
let discreet       = false;

// ── Wallet update (main data flow) ───────────────────────────────────────────

async function updateWallet(forceRefresh = false) {
    await fetchAllPrices(forceRefresh);

    const settings  = loadSettings();
    const coins     = settings.coins   || {};
    const currency  = settings.currency || 'usd';
    const assetList = [];

    for (const coin of COIN_ORDER) {
        const amount   = parseFloat(coins[coin]) || 0;
        const cached   = getCachedPrice(coin, currency);
        const price    = cached ? cached.price    : (currency === 'usd' ? (FALLBACK_PRICES[coin] || 0) : 0);
        const change24h = cached && typeof cached.change24h === 'number' ? cached.change24h : 0;
        const value    = amount * price;
        assetList.push({ key: coin, amount, value, change: change24h, price });
    }

    // Sort by value descending
    assetList.sort((a, b) => b.value - a.value);

    const totalValue = assetList.reduce((sum, a) => sum + a.value, 0);
    BASE_PRICE = totalValue;

    setBalanceDisplay(totalValue);
    window.__lastCoinData = assetList;

    renderAssets(assetList);
    renderAccounts(assetList);
    renderExploreCards(assetList);
    try { renderAllocation(assetList); } catch(e){}

    const coinsWithBalance = assetList.filter(a => a.amount > 0 && a.value > 0);
    const cfg = RANGE_CONFIG[currentRange] || RANGE_CONFIG['1D'];
    const N = cfg.points;
    const days = typeof cfg.days === 'number' ? cfg.days : 1825;

    if (coinsWithBalance.length === 0) {
        chartData       = Array(N).fill(totalValue || 0);
        BASE_CHANGE_AMT = 0;
        clearDot();
        buildChart();
        return;
    }

    const charts      = await Promise.all(coinsWithBalance.map(a => fetchCoinChart(a.key, currentRange)));
    // Determine actual length from first valid chart
    const firstValid  = charts.find(c => c && c.length);
    const len         = firstValid ? firstValid.length : N;
    const combined    = Array(len).fill(0).map(() => ({ timestamp: 0, value: 0 }));

    coinsWithBalance.forEach((asset, i) => {
        const coinChart = charts[i];
        if (!coinChart) return;
        for (let t = 0; t < len; t++) {
            const point = coinChart[t];
            if (!point) continue;
            const price = typeof point === 'number' ? point : point?.price;
            combined[t].timestamp = combined[t].timestamp || point?.timestamp || 0;
            combined[t].value += asset.amount * (price || 0);
        }
    });

    if (totalValue > 0 && combined.every(point => point.value === 0)) {
        const times = fallbackTimestamps(len, days);
        combined.forEach((point, i) => {
            point.timestamp = times[i];
            point.value = totalValue;
        });
    }

    chartData       = combined;
    BASE_CHANGE_AMT = totalValue - (chartData[0]?.value || 0);

    clearDot();
    buildChart();
}

// ── Asset list renderer ──────────────────────────────────────────────────────

function setBalanceDisplay(amount){
    const el = document.getElementById('balanceDisplay');
    if (!el) return;
    if (discreet) { el.textContent = '***'; return; }
    const symbol = getCurrencySymbol();
    const settings = loadSettings();
    const isSuffix = SUFFIX_CURRENCIES.includes(settings.currency);
    const abs = Math.abs(amount);
    const whole = Math.floor(abs).toLocaleString('en-US');
    const cents = abs.toFixed(2).split('.')[1];
    el.innerHTML = isSuffix
      ? `${whole}<span class="cents">.${cents}</span> ${symbol}`
      : `${symbol}${whole}<span class="cents">.${cents}</span>`;
}

function renderExploreCards(assetList){
    const map = Object.fromEntries(assetList.map(a => [a.key, a.change]));
    const fmt = v => {
        if (typeof v !== 'number' || isNaN(v)) return '+0.00%';
        const sign = v >= 0 ? '+' : '';
        return `${sign}${v.toFixed(2)}%`;
    };
    const setPct = (id, key) => {
        const el = document.getElementById(id);
        if (!el) return;
        const v = map[key];
        el.textContent = fmt(v);
        el.classList.toggle('down', typeof v === 'number' && v < 0);
        el.classList.toggle('up', !(typeof v === 'number' && v < 0));
    };
    setPct('exploreEthPct','eth');
    setPct('exploreBtcPct','btc');
    setPct('exploreSolPct','sol');
}

function renderAssets(assetList) {
    const container = document.getElementById('assetList');
    if (!container) return;
    container.innerHTML = '';

    // Show all coins; those with a balance sorted by value descending first, zero-balance after in COIN_ORDER
    const withBalance = assetList.filter(a => a.amount > 0);
    const withoutBalance = COIN_ORDER
        .filter(k => !withBalance.some(a => a.key === k))
        .map(k => assetList.find(a => a.key === k))
        .filter(Boolean);
    const ordered = [...withBalance, ...withoutBalance];

    for (const asset of ordered) {
        const el = document.createElement('div');
        el.className = 'asset-item';

        const changeVal = typeof asset.change === 'number' && !isNaN(asset.change) ? asset.change : 0;
        const hasValue = asset.value > 0;
        const isDown = changeVal < 0;
        const sign = changeVal >= 0 ? '+' : '';
        const pct = Math.abs(changeVal) < 100 ? changeVal.toFixed(2) : Math.round(changeVal);

        const amountStr = discreet ? '***' : (asset.amount > 0 ? fmtAmount(asset.amount) : '0');

        el.innerHTML = `
          <div class="asset-left">
            <div class="asset-logo"><img src="/assets/${COIN_ICONS[asset.key]}" alt="${COIN_SYMBOLS[asset.key]}"/></div>
            <div class="asset-info">
              <div class="asset-name">${COIN_NAMES[asset.key]}</div>
              <div class="asset-sub-text">${amountStr} ${COIN_SYMBOLS[asset.key]}</div>
            </div>
          </div>
          <div class="asset-right">
            ${hasValue
              ? `<div class="asset-value">${discreet ? '***' : fmtUSD(asset.value)}</div>
                 <div class="asset-change-pct ${isDown ? 'down' : ''}">${changeVal === 0 ? '–' : sign + pct + '%'}</div>`
              : `<div class="asset-dash">-</div>`}
          </div>`;
        container.appendChild(el);
    }
}

// ── Accounts (per-coin wallets) ──────────────────────────────────────────────

const COIN_ADDRESS_GEN = {
    btc: () => {
        // Bech32-ish bc1q… 39 chars
        const chars='qpzry9x8gf2tvdw0s3jn54khce6mua7l';
        let s='bc1q'; for(let i=0;i<35;i++) s+=chars[Math.floor(Math.random()*chars.length)];
        return s;
    },
    eth: () => {
        const h='0123456789abcdef'; let s='0x';
        for(let i=0;i<40;i++) s+=h[Math.floor(Math.random()*16)];
        return s;
    },
    bnb: () => COIN_ADDRESS_GEN.eth(),
    sol: () => {
        const c='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
        let s=''; for(let i=0;i<44;i++) s+=c[Math.floor(Math.random()*c.length)];
        return s;
    },
    xrp: () => {
        const c='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
        let s='r'; for(let i=0;i<33;i++) s+=c[Math.floor(Math.random()*c.length)];
        return s;
    }
};

function loadAccountsMeta(){
    try { return JSON.parse(localStorage.getItem('ledgerAccounts')) || {}; }
    catch { return {}; }
}
function saveAccountsMeta(m){ localStorage.setItem('ledgerAccounts', JSON.stringify(m)); }

function ensureAccountMeta(coin){
    const meta = loadAccountsMeta();
    if (!meta[coin]) {
        meta[coin] = {
            name: COIN_NAMES[coin],
            address: (COIN_ADDRESS_GEN[coin] || COIN_ADDRESS_GEN.eth)()
        };
        saveAccountsMeta(meta);
    }
    return meta[coin];
}

function shortAddr(a){
    if (!a) return '';
    if (a.length <= 12) return a;
    return a.slice(0,5) + '…' + a.slice(-4);
}

function renderAccounts(assetList){
    const container = document.getElementById('accountsList');
    if (!container) return;
    container.innerHTML = '';
    // Show only coins with a balance (matches reference)
    const list = assetList.filter(a => a.amount > 0).sort((a,b)=>b.value-a.value);
    if (list.length === 0) {
        container.innerHTML = '<div style="padding:30px 0;text-align:center;color:var(--text-dim);font-size:14px">No accounts yet</div>';
        return;
    }
    for (const asset of list) {
        const meta = ensureAccountMeta(asset.key);
        const el = document.createElement('div');
        el.className = 'account-item';
        el.innerHTML = `
          <div class="acc-left">
            <input class="acc-name" data-coin="${asset.key}" value="${meta.name.replace(/"/g,'&quot;')}" />
            <div class="acc-sub">
              <span class="acc-addr">${shortAddr(meta.address)}</span>
              <img class="acc-coin-ic" src="/assets/${COIN_ICONS[asset.key]}" alt=""/>
            </div>
          </div>
          <div class="acc-value">${discreet ? '***' : fmtUSD(asset.value)}</div>`;
        container.appendChild(el);
    }
    container.querySelectorAll('.acc-name').forEach(inp => {
        inp.addEventListener('input', () => {
            const meta = loadAccountsMeta();
            const coin = inp.dataset.coin;
            if (!meta[coin]) meta[coin] = { name: inp.value, address: ensureAccountMeta(coin).address };
            else meta[coin].name = inp.value;
            saveAccountsMeta(meta);
        });
    });
}

// ── Allocation pie renderer ──────────────────────────────────────────────────

function arcPath(cx, cy, outerR, innerR, startAngle, endAngle) {
    const start    = startAngle - Math.PI / 2;
    const end      = endAngle   - Math.PI / 2;
    const x1 = cx + outerR * Math.cos(start);
    const y1 = cy + outerR * Math.sin(start);
    const x2 = cx + outerR * Math.cos(end);
    const y2 = cy + outerR * Math.sin(end);
    const x3 = cx + innerR * Math.cos(end);
    const y3 = cy + innerR * Math.sin(end);
    const x4 = cx + innerR * Math.cos(start);
    const y4 = cy + innerR * Math.sin(start);
    const largeArc = endAngle - startAngle > Math.PI ? 1 : 0;
    return `M${x1} ${y1} A${outerR} ${outerR} 0 ${largeArc} 1 ${x2} ${y2} L${x3} ${y3} A${innerR} ${innerR} 0 ${largeArc} 0 ${x4} ${y4}Z`;
}

function renderAllocation(assetList) {
    const nonZero   = assetList.filter(a => a.value > 0);
    const total     = nonZero.reduce((s, a) => s + a.value, 0);
    const cx = 50, cy = 50, outerR = 45, innerR = 39;
    const gap       = nonZero.length > 1 ? 0.04 : 0;

    let paths = `<circle cx="${cx}" cy="${cy}" r="42" fill="none" stroke="#1e1e1e" stroke-width="6"/>`;
    let angle = 0;

    for (const asset of nonZero) {
        const sweep = asset.value / total * 2 * Math.PI;
        if (sweep >= 2 * Math.PI - 0.001) {
            paths += `<circle cx="${cx}" cy="${cy}" r="42" fill="none" stroke="${COIN_COLORS[asset.key]}" stroke-width="6"/>`;
        } else {
            paths += `<path d="${arcPath(cx, cy, outerR, innerR, angle + gap / 2, angle + sweep - gap / 2)}" fill="${COIN_COLORS[asset.key]}"/>`;
            angle += sweep;
        }
    }

    // Legend — show first 4 coins, then "Others" if more
    const top4    = nonZero.slice(0, 4);
    const hasMore = nonZero.length > 4;
    let legend    = top4.map(a =>
        `<div class="allocation-legend-item"><span class="allocation-dot" style="background:${COIN_COLORS[a.key]}"></span>${COIN_SYMBOLS[a.key]}</div>`
    ).join('');
    if (hasMore) legend += '<div class="allocation-legend-item"><span class="allocation-dot" style="background:#666"></span>Others</div>';

    document.querySelector('.allocation').innerHTML =
        `\n    <h3>ALLOCATION</h3>\n    <div class="allocation-main">\n      <div class="allocation-pie">\n        <svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">${paths}</svg>\n      </div>\n      <div class="allocation-legend">${legend}</div>\n      <div class="allocation-chevron">›</div>\n    </div>`;

    document.querySelector('.transaction-history').innerHTML =
        `\n    <h3>TRANSACTION HISTORY</h3>\n    <div class="txn-empty">No transactions yet</div>`;
}

// ── Chart (SVG line chart) ───────────────────────────────────────────────────

/** Catmull-Rom spline through points [[x,y], …] */
function catmullRomPath(points, tension = 0.5) {
    if (points.length < 2) return '';
    let d = `M ${points[0][0]} ${points[0][1]}`;
    for (let i = 0; i < points.length - 1; i++) {
        const p0 = points[Math.max(0, i - 1)];
        const p1 = points[i];
        const p2 = points[i + 1];
        const p3 = points[Math.min(points.length - 1, i + 2)];
        const cp1x = p1[0] + (p2[0] - p0[0]) * tension / 3;
        const cp1y = p1[1] + (p2[1] - p0[1]) * tension / 3;
        const cp2x = p2[0] - (p3[0] - p1[0]) * tension / 3;
        const cp2y = p2[1] - (p3[1] - p1[1]) * tension / 3;
        d += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2[0]} ${p2[1]}`;
    }
    return d;
}

function buildChart() {
    const svg    = document.getElementById('chartSvg');
    const W      = svg.clientWidth  || svg.getBoundingClientRect().width;
    const H      = svg.clientHeight || svg.getBoundingClientRect().height;
    if (!W || !H) return;

    const PAD_TOP = 14, PAD_BOT = 10;
    const drawH   = H - PAD_TOP - PAD_BOT;

    const fallbackTimes = fallbackTimestamps(24);
    const data    = chartData.length >= 2 ? chartData : fallbackTimes.map(timestamp => ({ timestamp, value: BASE_PRICE || 0 }));
    const values  = data.map(point => typeof point === 'number' ? point : point.value);
    const minVal  = Math.min(...values);
    const maxVal  = Math.max(...values);
    const range   = maxVal - minVal || 1;

    // Add a little breathing room around the data
    const yMin    = minVal - range * 0.08;
    const yMax    = maxVal + range * 0.04;
    const yRange  = yMax - yMin || 1;

    const pts     = values.map((v, i) => [
        i / (data.length - 1) * W,
        PAD_TOP + (1 - (v - yMin) / yRange) * drawH
    ]);

    const linePath = catmullRomPath(pts);
    const lastPt   = pts[pts.length - 1];
    const firstPt  = pts[0];
    const fillPath = linePath + ` L ${lastPt[0]} ${H} L ${firstPt[0]} ${H} Z`;

    document.getElementById('chartLine').setAttribute('d', linePath);

    const fillEl = document.getElementById('chartFill');
    if (fillEl) fillEl.setAttribute('d', fillPath);

    document.getElementById('chartCrosshair').setAttribute('y2', H);

    // Store computed data on the SVG element for the interaction overlay
    svg._chartPts  = pts;
    svg._chartData = data.map((point, i) => typeof point === 'number'
        ? { timestamp: fallbackTimes[i] || Date.now(), value: point }
        : { timestamp: point.timestamp || fallbackTimes[i] || Date.now(), value: point.value || 0 });
    svg._H         = H;
}

// ── Chart interaction (hover / touch dot) ────────────────────────────────────

function updateDot(idx) {
    const svg  = document.getElementById('chartSvg');
    const pts  = svg._chartPts;
    const data = svg._chartData;
    if (!pts || !data) return;

    const [x, y]      = pts[idx];
    const dot          = document.getElementById('chartDot');
    const crosshair    = document.getElementById('chartCrosshair');

    dot.setAttribute('cx', x);
    dot.setAttribute('cy', y);
    dot.style.display  = 'block';

    crosshair.setAttribute('x1', x);
    crosshair.setAttribute('x2', x);
    crosshair.setAttribute('y1', y);
    crosshair.style.display = 'block';

    const point = data[idx];
    document.getElementById('balanceDisplay').textContent =
        discreet ? '***' : fmtUSD(point.value);

    const d        = new Date(point.timestamp || Date.now());
    const dateStr  = d.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: 'numeric' }) +
        ' ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    document.getElementById('balanceChange').innerHTML =
        `<span style="color:#fff">${dateStr}</span>`;
}

function clearDot() {
    const dot = document.getElementById('chartDot');
    const ch = document.getElementById('chartCrosshair');
    if (dot) dot.style.display = 'none';
    if (ch) ch.style.display = 'none';
    setBalanceDisplay(BASE_PRICE);

    const amt = BASE_CHANGE_AMT;
    const pctNum = BASE_PRICE > 0 ? (amt / (BASE_PRICE - amt) * 100) : 0;
    const isDown = amt < 0;
    const sign = amt >= 0 ? '+' : '';
    const pctStr = `${sign}${(isNaN(pctNum) ? 0 : pctNum).toFixed(2)}%`;

    const pillEl = document.getElementById('balanceChange');
    if (!pillEl) return;
    pillEl.innerHTML =
        `<span class="bp-pct ${isDown ? 'down':''}">${pctStr}</span>` +
        `<span class="bp-dot">·</span>` +
        `<span class="bp-period">Today</span>` +
        `<span class="bp-arrow">›</span>`;
}

function getIdx(clientX) {
    const svg    = document.getElementById('chartSvg');
    const rect   = svg.getBoundingClientRect();
    const ratio  = (clientX - rect.left) / rect.width;
    const data   = svg._chartData || chartData;
    return Math.round(Math.max(0, Math.min(1, ratio)) * (data.length - 1));
}

function initInteraction() {
    const chart = document.getElementById('chartContainer');
    let dragging = false;

    const scrubTo = clientX => updateDot(getIdx(clientX));
    const stopScrub = e => {
        if (!dragging) return;
        dragging = false;
        if (e?.pointerId && chart.hasPointerCapture?.(e.pointerId)) {
            chart.releasePointerCapture(e.pointerId);
        }
        clearDot();
        e?.preventDefault?.();
    };

    chart.addEventListener('pointerdown', e => {
        dragging = true;
        chart.setPointerCapture?.(e.pointerId);
        scrubTo(e.clientX);
        e.preventDefault();
    }, { passive: false });

    chart.addEventListener('pointermove', e => {
        if (!dragging) return;
        scrubTo(e.clientX);
        e.preventDefault();
    }, { passive: false });

    chart.addEventListener('pointerup', stopScrub);
    chart.addEventListener('pointercancel', stopScrub);

    chart.addEventListener('touchstart', e => e.stopPropagation(), { passive: true });
    chart.addEventListener('touchmove', e => {
        e.stopPropagation();
        e.preventDefault();
    }, { passive: false });
    chart.addEventListener('touchend', e => e.stopPropagation());
}

// ── Settings panel ────────────────────────────────────────────────────────────

function openSettings() {
    const s = loadSettings();
    for (const coin of COIN_ORDER) {
        const el = document.getElementById('set-' + coin);
        if (el) el.value = s.coins[coin] || '';
    }
    document.getElementById('set-cgApiKey').value    = s.cgApiKey  || '';
    document.getElementById('set-cgApiKeyPro').checked = !!s.cgApiKeyPro;
    document.getElementById('set-currency').value   = s.currency   || 'usd';
    document.getElementById('settingsOverlay').classList.add('open');
}

function closeSettings() {
    document.getElementById('settingsOverlay').classList.remove('open');
}

function renderFromCacheInstant(){
    const settings = loadSettings();
    const coins = settings.coins || {};
    const currency = settings.currency || 'usd';
    const assetList = [];
    for (const coin of COIN_ORDER){
        const amount = parseFloat(coins[coin]) || 0;
        const cached = getCachedPrice(coin, currency);
        const price = cached ? cached.price : (currency === 'usd' ? (FALLBACK_PRICES[coin] || 0) : 0);
        const change24h = cached && typeof cached.change24h === 'number' ? cached.change24h : 0;
        assetList.push({ key: coin, amount, value: amount*price, change: change24h, price });
    }
    assetList.sort((a,b)=>b.value-a.value);
    const total = assetList.reduce((s,a)=>s+a.value,0);
    BASE_PRICE = total;
    setBalanceDisplay(total);
    window.__lastCoinData = assetList;
    renderAssets(assetList);
    renderAccounts(assetList);
    renderExploreCards(assetList);
}

function confirmSettings() {
    const s           = loadSettings();
    const oldCurrency = s.currency || 'usd';

    for (const coin of COIN_ORDER) {
        const el = document.getElementById('set-' + coin);
        if (el) s.coins[coin] = parseFloat(el.value) || 0;
    }
    s.cgApiKey    = document.getElementById('set-cgApiKey').value.trim();
    s.cgApiKeyPro = document.getElementById('set-cgApiKeyPro').checked;
    s.currency    = document.getElementById('set-currency').value || 'usd';

    if (oldCurrency !== s.currency) {
        for (const coin of COIN_ORDER) {
            localStorage.removeItem('lchart_' + coin + '_' + oldCurrency);
            localStorage.removeItem('lprice_' + coin + '_' + oldCurrency);
            localStorage.removeItem('lchart_' + coin + '_' + s.currency);
            localStorage.removeItem('lprice_' + coin + '_' + s.currency);
        }
    }

    saveSettings(s);
    closeSettings();
    // Instant render from cached prices, then refresh in background
    renderFromCacheInstant();
    updateWallet();
}

// ── Tab / button group initialiser ───────────────────────────────────────────

function initButtons(selector) {
    document.querySelectorAll(selector).forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll(selector).forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
        });
    });
}

// ── Scroll-collapse (header fade on scroll) ───────────────────────────────────

function initScrollCollapse() { /* simplified - no collapse in new design */ }

// ── Pull-to-refresh ───────────────────────────────────────────────────────────

function initPullToRefresh() {
    const ptrWrapper    = document.getElementById('ptr-wrapper');
    const scrollable    = document.querySelector('.scrollable');
    const spinner       = document.getElementById('pullSpinner');
    const blades        = Array.from(spinner.querySelectorAll('.spinner-blade'));
    const bladeCount    = blades.length;
    const TRIGGER_PX    = 70;   // how far to drag before release triggers refresh
    const SETTLE_PX     = 62;   // where the spinner settles while refreshing
    const RESISTANCE    = 0.45; // drag resistance factor

    let startY    = 0;
    let deltaY    = 0;
    let isPulling = false;
    let isRefreshing = false;

    spinner.style.fontSize = '38px';
    reset();

    function reset() {
        ptrWrapper.style.transition = 'none';
        ptrWrapper.style.transform  = 'translateY(0)';
        spinner.style.opacity       = '0';
        blades.forEach(b => {
            b.style.animationName    = 'none';
            b.style.opacity          = '0';
            b.style.backgroundColor = 'transparent';
        });
    }

    function setProgress(ratio) {
        const lit = Math.min(Math.floor(ratio * (bladeCount + 1)), bladeCount);
        blades.forEach((b, i) => {
            b.style.animationName    = 'spinner-fade';
            b.style.opacity          = i < lit ? '1' : '0';
            b.style.backgroundColor = i < lit ? '#FFFFFF' : 'transparent';
        });
    }

    function startSpinning() {
        blades.forEach(b => {
            b.style.opacity          = '';
            b.style.backgroundColor  = '';
            b.style.animationName    = 'spinner-fade';
        });
    }

    function collapse() {
        ptrWrapper.style.transition = 'transform 0.3s cubic-bezier(0.25,1,0.5,1)';
        ptrWrapper.style.transform  = 'translateY(0)';
        spinner.style.transition    = 'top 0.3s ease, transform 0.3s ease, opacity 0.3s ease';
        reset();
        isRefreshing = false;
    }

    ptrWrapper.addEventListener('touchstart', e => {
        if (scrollable.scrollTop > 0) return;
        startY    = e.touches[0].clientY;
        deltaY    = 0;
        isPulling = true;
        ptrWrapper.style.transition = 'none';
        spinner.style.transition    = 'none';
    }, { passive: true });

    ptrWrapper.addEventListener('touchmove', e => {
        if (!isPulling) return;
        const dy = e.changedTouches[0].clientY - startY;
        if (dy <= 0) {
            deltaY = 0;
            ptrWrapper.style.transform = 'translateY(0)';
            reset();
            return;
        }
        e.preventDefault();
        deltaY = dy;
        const translate = deltaY * RESISTANCE;
        ptrWrapper.style.transform = `translateY(${translate}px)`;

        const ratio = Math.min(translate / TRIGGER_PX, 1);
        spinner.style.transform    = `translateX(-50%) scale(${ratio})`;
        spinner.style.opacity      = ratio.toString();
        setProgress(ratio);
    }, { passive: false });

    ptrWrapper.addEventListener('touchend', () => {
        if (!isPulling) return;
        isPulling = false;
        const translate = deltaY * RESISTANCE;

        ptrWrapper.style.transition = 'transform 0.3s cubic-bezier(0.25,1,0.5,1)';
        spinner.style.transition    = 'top 0.3s ease, transform 0.3s ease, opacity 0.3s ease';

        if (translate >= TRIGGER_PX) {
            ptrWrapper.style.transform = `translateY(${SETTLE_PX}px)`;
            spinner.style.transform    = 'translateX(-50%) scale(1)';
            spinner.style.opacity      = '1';
            startSpinning();
            isRefreshing = true;
            updateWallet(true);
            setTimeout(collapse, 1200);
        } else {
            ptrWrapper.style.transform = 'translateY(0)';
            reset();
        }
        deltaY = 0;
    });
}

// ── Eye (discreet mode) toggle ────────────────────────────────────────────────

const EYE_OPEN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
const EYE_CLOSED = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';

function toggleDiscreet() {
    discreet = !discreet;
    document.getElementById('eyeBtn').innerHTML = discreet ? EYE_CLOSED : EYE_OPEN;
    clearDot();
    renderAssets(window.__lastCoinData || []);
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
    buildChart();
    initInteraction();
    initPullToRefresh();
    initScrollCollapse();
    initButtons('.nav-btn[data-nav]');
    initButtons('.tab');
    initButtons('.segment-btn');
    document.querySelectorAll('.range-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.range-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentRange = btn.dataset.range || '1D';
            updateWallet(false);
        });
    });

    document.getElementById('eyeBtn')
        .addEventListener('click', toggleDiscreet);

    const settingsBtn = document.querySelector('.circle-btn[aria-label="Settings"]');
    if (settingsBtn) settingsBtn.addEventListener('click', openSettings);

    document.getElementById('settingsClose')
        .addEventListener('click', closeSettings);

    document.getElementById('settingsConfirm')
        .addEventListener('click', confirmSettings);

    document.getElementById('settingsOverlay')
        .addEventListener('click', e => {
            if (e.target === document.getElementById('settingsOverlay')) closeSettings();
        });

    // Live, instant balance updates as the user types in the editor
    COIN_ORDER.map(c => 'set-' + c).forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        el.addEventListener('input', () => {
            const s = loadSettings();
            for (const coin of COIN_ORDER) {
                const e2 = document.getElementById('set-' + coin);
                if (e2) s.coins[coin] = parseFloat(e2.value) || 0;
            }
            saveSettings(s);
            renderFromCacheInstant();
        });
    });

    const curSel = document.getElementById('set-currency');
    if (curSel) {
        curSel.addEventListener('change', () => {
            const s = loadSettings();
            const oldCurrency = s.currency || 'usd';
            s.currency = curSel.value || 'usd';
            for (const coin of COIN_ORDER) {
                localStorage.removeItem('lchart_' + coin + '_' + oldCurrency);
                localStorage.removeItem('lprice_' + coin + '_' + oldCurrency);
                localStorage.removeItem('lchart_' + coin + '_' + s.currency);
                localStorage.removeItem('lprice_' + coin + '_' + s.currency);
            }
            saveSettings(s);
            updateWallet(true);
        });
    }


    // Assets / Accounts tab toggle
    document.querySelectorAll('.aa-tab').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.aa-tab').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            const showAccounts = btn.dataset.aa === 'accounts';
            document.getElementById('assetList').style.display = showAccounts ? 'none' : '';
            document.getElementById('accountsWrap').style.display = showAccounts ? '' : 'none';
        });
    });

    updateWallet();

    // Light refresh: update coin prices + asset list every 7s (no balance/chart redraw)
    setInterval(async () => {
        try {
            await fetchAllPrices(true);
            const settings  = loadSettings();
            const coins     = settings.coins   || {};
            const currency  = settings.currency || 'usd';
            const assetList = [];
            for (const coin of COIN_ORDER) {
                const amount   = parseFloat(coins[coin]) || 0;
                const cached   = getCachedPrice(coin, currency);
                const price    = cached ? cached.price : (currency === 'usd' ? (FALLBACK_PRICES[coin] || 0) : 0);
                const change24h = cached && typeof cached.change24h === 'number' ? cached.change24h : 0;
                assetList.push({ key: coin, amount, value: amount * price, change: change24h, price });
            }
            assetList.sort((a, b) => b.value - a.value);
            const total = assetList.reduce((s, a) => s + a.value, 0);
            BASE_PRICE = total;
            window.__lastCoinData = assetList;
            // Update the main balance number to reflect new prices (no chart rebuild)
            setBalanceDisplay(total);
            renderAssets(assetList);
            renderAccounts(assetList);
            renderExploreCards(assetList);
        } catch (e) {}
    }, 7000);

    // Full refresh (main balance + chart) every 25s
    setInterval(() => updateWallet(true), 25000);
});

// Rebuild chart on window resize
let _resizeChartT;
window.addEventListener('resize', () => {
    clearTimeout(_resizeChartT);
    _resizeChartT = setTimeout(buildChart, 120);
}, { passive: true });

// Disable context-menu (long-press menu on mobile)
document.addEventListener('contextmenu', e => { e.preventDefault(); return false; });

// Disable F12 / devtools shortcut (Ctrl+{ or keyCode 123)
document.addEventListener('keydown', e => {
    if (e.ctrlKey || e.keyCode === 123) {
        e.stopPropagation();
        e.preventDefault();
    }
});
// ── Transactions ─────────────────────────────────────────────────────────────
function loadTxns(){
  try { return JSON.parse(localStorage.getItem('ledgerTxns')) || []; }
  catch { return []; }
}
function saveTxns(t){ localStorage.setItem('ledgerTxns', JSON.stringify(t)); }

function fmtTxnDate(ts){
  const d = new Date(ts);
  const today = new Date(); today.setHours(0,0,0,0);
  const day = new Date(d); day.setHours(0,0,0,0);
  const diff = Math.round((today - day)/86400000);
  const base = `${d.getMonth()+1}/${d.getDate()}/${d.getFullYear()}`;
  if (diff === 0) return base + ' - TODAY';
  if (diff === 1) return base + ' - YESTERDAY';
  return base;
}
function fmtTxnTime(ts){
  return new Date(ts).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'});
}

const TXN_ARROW_UP = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="6 11 12 5 18 11"/></svg>';
const TXN_ARROW_DOWN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><polyline points="18 13 12 19 6 13"/></svg>';

let txnExpanded = false;
function renderTxnHistory(){
  const list = document.getElementById('txnList');
  const seeAll = document.getElementById('txnSeeAll');
  if (!list) return;
  const txns = loadTxns().slice().sort((a,b)=>b.ts-a.ts);
  list.innerHTML = '';
  if (txns.length === 0){
    list.innerHTML = '<div class="txn-empty">No transactions yet</div>';
    if (seeAll) seeAll.style.display = 'none';
    return;
  }
  const settings = loadSettings();
  const currency = settings.currency || 'usd';
  let lastDate = '';
  const COLLAPSED = 3;
  const shown = txnExpanded ? txns : txns.slice(0, COLLAPSED);
  for (const t of shown){
    const dateStr = fmtTxnDate(t.ts);
    if (dateStr !== lastDate){
      const pill = document.createElement('div');
      pill.className = 'txn-date-pill';
      pill.textContent = dateStr;
      list.appendChild(pill);
      lastDate = dateStr;
    }
    const cached = getCachedPrice(t.coin, currency);
    const price = cached ? cached.price : (currency === 'usd' ? (FALLBACK_PRICES[t.coin] || 0) : 0);
    const fiat = Math.abs(t.amount) * price;
    const isSent = t.type === 'sent';
    const sign = isSent ? '-' : '+';
    const row = document.createElement('div');
    row.className = 'txn-row';
    row.innerHTML = `
      <div class="txn-icon">${isSent ? TXN_ARROW_UP : TXN_ARROW_DOWN}</div>
      <div class="txn-mid">
        <div class="txn-name">${COIN_NAMES[t.coin]} 1</div>
        <div class="txn-sub">${isSent ? 'Sent' : 'Received'} ${fmtTxnTime(t.ts)}</div>
      </div>
      <div class="txn-right">
        <div class="txn-amt">${sign}${fmtAmount(Math.abs(t.amount))} ${COIN_SYMBOLS[t.coin]}</div>
        <div class="txn-fiat">${sign}${fmtUSD(fiat)}</div>
      </div>`;
    row.addEventListener('click', () => openTxnDetail(t));
    list.appendChild(row);
  }
  if (seeAll){
    if (txns.length > COLLAPSED){
      seeAll.style.display = 'block';
      seeAll.textContent = txnExpanded ? 'Show less' : 'See all';
    } else {
      seeAll.style.display = 'none';
    }
  }
}

function pad2(n){ return n<10 ? '0'+n : ''+n; }

function initEditorTabs(){
  document.querySelectorAll('.editor-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.editor-tab').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      const isTxn = btn.dataset.etab === 'txn';
      document.getElementById('editorPaneCrypto').style.display = isTxn ? 'none' : '';
      document.getElementById('editorPaneTxn').style.display = isTxn ? '' : 'none';
      if (isTxn){
        const now = new Date();
        const dEl = document.getElementById('txn-date');
        const tEl = document.getElementById('txn-time');
        if (dEl && !dEl.value) dEl.value = `${now.getFullYear()}-${pad2(now.getMonth()+1)}-${pad2(now.getDate())}`;
        if (tEl && !tEl.value) tEl.value = `${pad2(now.getHours())}:${pad2(now.getMinutes())}`;
      }
    });
  });
  document.querySelectorAll('.txn-type-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.txn-type-tab').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
    });
  });
  const addBtn = document.getElementById('txnAddBtn');
  if (addBtn) addBtn.addEventListener('click', () => {
    const type = document.querySelector('.txn-type-tab.active')?.dataset.ttype || 'received';
    const coin = document.getElementById('txn-coin').value;
    const amount = parseFloat(document.getElementById('txn-amount').value) || 0;
    if (amount <= 0) return;
    const dStr = document.getElementById('txn-date').value;
    const tStr = document.getElementById('txn-time').value || '00:00';
    const ts = new Date(`${dStr}T${tStr}`).getTime() || Date.now();
    // Try instant match from existing pool (no awaiting); resolve real chainTx in the background.
    const instant = cloneChainTx(findTxMatch(coin, amount, ts));
    // If we matched a real on-chain tx, use ITS timestamp on our log so they line up.
    const finalTs = (instant && instant.ts) ? instant.ts : ts;
    const txns = loadTxns();
    const newTxn = { type, coin, amount, ts: finalTs, chainTx: instant };
    txns.push(newTxn);
    saveTxns(txns);
    // adjust holdings
    const s = loadSettings();
    s.coins[coin] = (parseFloat(s.coins[coin])||0) + (type === 'sent' ? -amount : amount);
    if (s.coins[coin] < 0) s.coins[coin] = 0;
    saveSettings(s);
    document.getElementById('txn-amount').value = '';
    renderFromCacheInstant();
    renderTxnHistory();
    renderTxnEditorList();
    closeSettings();
    updateWallet();
    // Background resolve for fully-verified chain tx (non-blocking).
    if (!instant) resolveRealChainTx(coin, amount, ts).then(real => {
      if (!real) return;
      const all = loadTxns();
      const idx = all.findIndex(x => x.ts === finalTs && x.coin === coin && x.amount === amount && x.type === type);
      if (idx !== -1) { all[idx].chainTx = real; if (real.ts) all[idx].ts = real.ts; saveTxns(all); renderTxnHistory(); renderTxnEditorList(); }
    });
  });
  // Random coin chip toggles
  document.querySelectorAll('.rnd-coin').forEach(btn => {
    btn.addEventListener('click', () => btn.classList.toggle('active'));
  });
  const rndBtn = document.getElementById('rndGenBtn');
  if (rndBtn) rndBtn.addEventListener('click', () => {
    const coins = Array.from(document.querySelectorAll('.rnd-coin.active')).map(b => b.dataset.coin);
    if (!coins.length) return;
    const count = Math.max(1, Math.min(200, parseInt(document.getElementById('rnd-count').value) || 10));
    let minU = parseFloat(document.getElementById('rnd-min').value) || 0;
    let maxU = parseFloat(document.getElementById('rnd-max').value) || 0;
    if (maxU < minU) { const t = minU; minU = maxU; maxU = t; }
    const settings = loadSettings();
    const currency = settings.currency || 'usd';
    const txns = loadTxns();
    const s = loadSettings();
    const now = Date.now();
    for (let i = 0; i < count; i++){
      const coin = coins[Math.floor(Math.random() * coins.length)];
      const cached = getCachedPrice(coin, currency);
      const price = cached ? cached.price : (FALLBACK_PRICES[coin] || 1);
      if (price <= 0) continue;
      const usdAmt = minU + Math.random() * (maxU - minU);
      const amount = usdAmt / price;
      const type = Math.random() < 0.5 ? 'received' : 'sent';
      // random ts in last 90 days
      const ts = now - Math.floor(Math.random() * 90 * 86400000);
      const instant = cloneChainTx(findTxMatch(coin, amount, ts));
      const finalTs = (instant && instant.ts) ? instant.ts : ts;
      txns.push({ type, coin, amount, ts: finalTs, chainTx: instant });
      s.coins[coin] = (parseFloat(s.coins[coin])||0) + (type === 'sent' ? -amount : amount);
      if (s.coins[coin] < 0) s.coins[coin] = 0;
    }
    saveTxns(txns);
    saveSettings(s);
    renderFromCacheInstant();
    renderTxnHistory();
    renderTxnEditorList();
    updateWallet();
  });
  renderTxnEditorList();
}

function renderTxnEditorList(){
  const host = document.getElementById('txnEditorList');
  if (!host) return;
  const txns = loadTxns().slice().sort((a,b) => b.ts - a.ts);
  if (!txns.length) { host.innerHTML = '<div class="txn-edit-empty">No transactions yet</div>'; return; }
  host.innerHTML = '';
  txns.forEach((t) => {
    const row = document.createElement('div');
    row.className = 'txn-edit-row';
    const sign = t.type === 'sent' ? '-' : '+';
    row.innerHTML = `
      <div class="txn-edit-info">
        <div class="txn-edit-line1">${sign}${fmtAmount(Math.abs(t.amount))} ${COIN_SYMBOLS[t.coin]}</div>
        <div class="txn-edit-line2">${t.type === 'sent' ? 'Sent' : 'Received'} · ${fmtTxnDate(t.ts)} ${fmtTxnTime(t.ts)}</div>
      </div>
      <button class="txn-edit-del" aria-label="Delete">✕</button>`;
    row.querySelector('.txn-edit-del').addEventListener('click', () => {
      const all = loadTxns();
      const idx = all.findIndex(x => x.ts === t.ts && x.coin === t.coin && x.amount === t.amount && x.type === t.type);
      if (idx === -1) return;
      all.splice(idx, 1);
      saveTxns(all);
      // reverse holdings adjustment
      const s = loadSettings();
      const reverse = t.type === 'sent' ? t.amount : -t.amount;
      s.coins[t.coin] = Math.max(0, (parseFloat(s.coins[t.coin])||0) + reverse);
      saveSettings(s);
      renderTxnEditorList();
      renderTxnHistory();
      renderFromCacheInstant();
      updateWallet();
    });
    host.appendChild(row);
  });
}

document.addEventListener('DOMContentLoaded', () => {
  initEditorTabs();
  renderTxnHistory();
  const sa = document.getElementById('txnSeeAll');
  if (sa) sa.addEventListener('click', () => { txnExpanded = !txnExpanded; renderTxnHistory(); });
});

// Hook into wallet updates
const _origUpdateWallet = updateWallet;
window.addEventListener('load', () => {
  setInterval(renderTxnHistory, 12000);
});

// ── Transaction Detail Overlay ───────────────────────────────────────────────
const TXN_COIN_PREFIX = { btc:'bc1q', eth:'0x', sol:'', xrp:'r', bnb:'bnb1', ltc:'ltc1q' };
const TXN_COIN_FEE = { btc:0.00012, eth:0.0008, sol:0.000005, xrp:0.00001, bnb:0.00021, ltc:0.0001 };

// Explorer URL builders per coin
const EXPLORER_URLS = {
  btc: (id) => `https://mempool.space/tx/${id}`,
  eth: (id) => `https://etherscan.io/tx/${id.startsWith('0x') ? id : '0x'+id}`,
  sol: (id) => `https://solscan.io/tx/${id}`,
  bnb: (id) => `https://bscscan.com/tx/${id.startsWith('0x') ? id : '0x'+id}`,
  xrp: (id) => `https://xrpscan.com/tx/${id.toUpperCase()}`,
  ltc: (id) => `https://litecoinspace.org/tx/${id}`,
};

// ── Real TXID pool fetched from public blockchain APIs ───────────────────────
const TXID_POOL_KEY = 'txidPool_v3';
const TXID_POOL_TTL = 10 * 60 * 1000; // keep pulls fresh/newest-first
let TXID_POOL = { btc:[], eth:[], sol:[], bnb:[], xrp:[], ltc:[] };
let TXID_POOL_TS = { btc:0, eth:0, sol:0, bnb:0, xrp:0, ltc:0 };
let TXID_REFRESHING = {};

function normalizeTxEntry(e){
  if (!e || typeof e !== 'object') return null;
  const txid = String(e.txid || e.hash || '').trim();
  const from = String(e.from || '').trim();
  const to = String(e.to || '').trim();
  const amount = Number(e.amount);
  const ts = Number(e.ts || 0);
  if (!txid || !from || !to || !Number.isFinite(amount) || amount <= 0) return null;
  return { txid, from, to, amount, ts: Number.isFinite(ts) ? ts : 0 };
}
function cleanTxPool(list){
  const seen = new Set();
  return (Array.isArray(list) ? list : [])
    .map(normalizeTxEntry)
    .filter(e => e && !seen.has(e.txid) && seen.add(e.txid))
    .sort((a,b) => (b.ts || 0) - (a.ts || 0));
}
function loadTxidPoolCache(){
  try {
    const raw = localStorage.getItem(TXID_POOL_KEY);
    if (!raw) return false;
    const obj = JSON.parse(raw);
    if (!obj || !obj.ts || (Date.now()-obj.ts) > TXID_POOL_TTL) return false;
    if (obj.pool) {
      for (const coin of Object.keys(TXID_POOL)) TXID_POOL[coin] = cleanTxPool(obj.pool[coin]);
      TXID_POOL_TS = Object.assign(TXID_POOL_TS, obj.coinTs || {});
      return true;
    }
  } catch(_){}
  return false;
}
function saveTxidPoolCache(){
  try { localStorage.setItem(TXID_POOL_KEY, JSON.stringify({ ts: Date.now(), coinTs: TXID_POOL_TS, pool: TXID_POOL })); } catch(_){}
}

async function fetchJson(url, opts){
  try {
    const r = await fetch(url, Object.assign({ cache:'no-store' }, opts || {}));
    if (!r.ok) return null;
    return await r.json();
  } catch(_) { return null; }
}
async function fetchText(url){
  try {
    const r = await fetch(url, { cache:'no-store' });
    if (!r.ok) return null;
    return await r.text();
  } catch(_) { return null; }
}
function rpcBody(method, params){ return JSON.stringify({ jsonrpc:'2.0', id:Date.now(), method, params }); }

// Each pool entry is verified chain data: { txid, from, to, amount, ts }
async function fetchMempoolChainTxs(baseUrl){
  const blocks = await fetchJson(`${baseUrl}/api/blocks`);
  let hashes = Array.isArray(blocks) ? blocks.slice(0, 3).map(b => b && b.id).filter(Boolean) : [];
  if (!hashes.length) {
    const tip = await fetchText(`${baseUrl}/api/blocks/tip/hash`);
    if (tip) hashes = [tip.trim()];
  }
  const pageJobs = [];
  for (const hash of hashes) {
    for (const start of [0, 25, 50]) pageJobs.push(fetchJson(`${baseUrl}/api/block/${hash}/txs/${start}`));
  }
  const pages = await Promise.all(pageJobs);
  const out = [];
  for (const page of pages) {
    if (!Array.isArray(page)) continue;
    for (const tx of page) {
      const vin = (tx.vin || []).find(v => v && v.prevout && v.prevout.scriptpubkey_address);
      const vout = (tx.vout || []).find(v => v && v.scriptpubkey_address && Number(v.value) > 0);
      const entry = normalizeTxEntry({
        txid: tx.txid,
        from: vin && vin.prevout && vin.prevout.scriptpubkey_address,
        to: vout && vout.scriptpubkey_address,
        amount: vout ? Number(vout.value) / 1e8 : 0,
        ts: (tx.status && tx.status.block_time ? tx.status.block_time : 0) * 1000
      });
      if (entry) out.push(entry);
    }
  }
  return cleanTxPool(out);
}
const fetchBtcTxs = () => fetchMempoolChainTxs('https://mempool.space');
const fetchLtcTxs = () => fetchMempoolChainTxs('https://litecoinspace.org');

function hexToNumber(hex, decimals){
  if (!hex) return 0;
  try { return Number(BigInt(hex)) / Math.pow(10, decimals); } catch(_) { return 0; }
}
async function fetchEvmTxs(rpcUrl, decimals){
  const latest = await fetchJson(rpcUrl, {
    method:'POST', headers:{'Content-Type':'application/json'}, body: rpcBody('eth_blockNumber', [])
  });
  const latestNum = latest && latest.result ? parseInt(latest.result, 16) : null;
  const blockTags = latestNum ? Array.from({length: 6}, (_,i) => '0x' + (latestNum - i).toString(16)) : ['latest'];
  const blocks = await Promise.all(blockTags.map(tag => fetchJson(rpcUrl, {
    method:'POST', headers:{'Content-Type':'application/json'}, body: rpcBody('eth_getBlockByNumber', [tag, true])
  })));
  const out = [];
  for (const data of blocks) {
    const block = data && data.result;
    const txs = block && block.transactions;
    if (!Array.isArray(txs)) continue;
    const ts = hexToNumber(block.timestamp, 0) * 1000;
    for (const tx of txs) {
      const entry = normalizeTxEntry({ txid: tx.hash, from: tx.from, to: tx.to, amount: hexToNumber(tx.value, decimals), ts });
      if (entry) out.push(entry);
    }
  }
  return cleanTxPool(out);
}
const fetchEthTxs = () => fetchEvmTxs('https://ethereum-rpc.publicnode.com', 18);
const fetchBnbTxs = () => fetchEvmTxs('https://bsc-rpc.publicnode.com', 18);

function solKey(k){ return typeof k === 'string' ? k : (k && (k.pubkey || k.toString && k.toString())) || ''; }
function collectSolInstructions(tx){
  const outer = (((tx || {}).transaction || {}).message || {}).instructions || [];
  const inner = (((tx || {}).meta || {}).innerInstructions || []).flatMap(g => g.instructions || []);
  return outer.concat(inner);
}
async function fetchSolTxs(){
  const slotRes = await fetchJson('https://solana-rpc.publicnode.com', {
    method:'POST', headers:{'Content-Type':'application/json'}, body: rpcBody('getSlot', [{commitment:'confirmed'}])
  });
  const slot = slotRes && slotRes.result;
  if (!slot) return [];
  // Skip a few slots back from tip; recent slots may not be available yet.
  const slots = [slot - 4, slot - 6, slot - 8];
  const blocks = await Promise.all(slots.map(s => fetchJson('https://solana-rpc.publicnode.com', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: rpcBody('getBlock', [s, { encoding:'json', transactionDetails:'accounts', rewards:false, maxSupportedTransactionVersion:0 }])
  })));
  const out = [];
  for (const blk of blocks) {
    const block = blk && blk.result;
    const txs = block && block.transactions;
    if (!Array.isArray(txs)) continue;
    const ts = (block.blockTime || 0) * 1000;
    for (const tx of txs) {
      const sig = tx.transaction && tx.transaction.signatures && tx.transaction.signatures[0];
      if (!sig || (tx.meta && tx.meta.err)) continue;
      const keys = tx.transaction && tx.transaction.accountKeys;
      const pre = tx.meta && tx.meta.preBalances;
      const post = tx.meta && tx.meta.postBalances;
      if (!keys || !pre || !post) continue;
      let fromIdx = -1, toIdx = -1, amount = 0;
      for (let i=0;i<pre.length;i++){
        const d = post[i] - pre[i];
        if (d < 0 && fromIdx === -1) { fromIdx = i; amount = -d; }
        else if (d > 0 && toIdx === -1) { toIdx = i; }
      }
      if (fromIdx === -1 || toIdx === -1) continue;
      const entry = normalizeTxEntry({ txid: sig, from: solKey(keys[fromIdx]), to: solKey(keys[toIdx]), amount: amount / 1e9, ts });
      if (entry) out.push(entry);
    }
  }
  return cleanTxPool(out);
}
async function fetchXrpTxs(){
  const data = await fetchJson('https://xrplcluster.com/', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({method:'ledger', params:[{ledger_index:'validated', transactions:true, expand:true}]})
  });
  const ledger = data && data.result && data.result.ledger;
  const txs = ledger && ledger.transactions;
  if (!Array.isArray(txs)) return [];
  const ts = ledger.close_time ? (Number(ledger.close_time) + 946684800) * 1000 : Date.now();
  const out = [];
  for (const tx of txs) {
    if (tx.TransactionType !== 'Payment' || typeof tx.Amount !== 'string') continue;
    const entry = normalizeTxEntry({ txid: tx.hash, from: tx.Account, to: tx.Destination, amount: Number(tx.Amount) / 1e6, ts });
    if (entry) out.push(entry);
  }
  return cleanTxPool(out);
}

const TX_FETCHERS = { btc:fetchBtcTxs, eth:fetchEthTxs, sol:fetchSolTxs, bnb:fetchBnbTxs, xrp:fetchXrpTxs, ltc:fetchLtcTxs };
async function refreshTxidPoolCoin(coin, force=false){
  const fetcher = TX_FETCHERS[coin];
  if (!fetcher) return TXID_POOL[coin] || [];
  if (!force && TXID_REFRESHING[coin]) return TXID_REFRESHING[coin];
  if (!force && TXID_POOL[coin] && TXID_POOL[coin].length && Date.now() - (TXID_POOL_TS[coin] || 0) < TXID_POOL_TTL) return TXID_POOL[coin];
  TXID_REFRESHING[coin] = fetcher().then(list => {
    const clean = cleanTxPool(list);
    if (clean.length) {
      TXID_POOL[coin] = clean;
      TXID_POOL_TS[coin] = Date.now();
      saveTxidPoolCache();
    }
    return TXID_POOL[coin] || [];
  }).catch(() => TXID_POOL[coin] || []).finally(() => { delete TXID_REFRESHING[coin]; });
  return TXID_REFRESHING[coin];
}
async function refreshTxidPool(){
  await Promise.allSettled(Object.keys(TX_FETCHERS).map(coin => refreshTxidPoolCoin(coin)));
}

// Boot newest real-chain pools in the background.
loadTxidPoolCache();
refreshTxidPool();

function findTxMatch(coin, targetAmount, targetTs){
  const pool = cleanTxPool(TXID_POOL[coin]);
  if (!pool.length) return null;
  const target = Math.max(Number(targetAmount) || 0, 1e-9);
  const wantTs = Number(targetTs) || 0;
  // Time window candidates: only consider txs within ±36h of target time when ts provided.
  let candidates = pool;
  if (wantTs) {
    const win = 36 * 3600 * 1000;
    const near = pool.filter(e => e.ts && Math.abs(e.ts - wantTs) <= win);
    if (near.length) candidates = near;
  }
  let best = null, bestScore = Infinity;
  for (const e of candidates) {
    const amtDelta = Math.abs(e.amount - target) / target; // relative price diff
    const tDelta = wantTs && e.ts ? Math.abs(e.ts - wantTs) / (3600*1000) : 0; // hours
    // Price dominates; time is a tiebreaker.
    const score = amtDelta * 1000 + tDelta * 0.01;
    if (score < bestScore) { bestScore = score; best = e; }
  }
  return best;
}
function cloneChainTx(tx){
  const clean = normalizeTxEntry(tx);
  return clean ? { txid: clean.txid, from: clean.from, to: clean.to, amount: clean.amount, ts: clean.ts } : null;
}
// Fetch historical txs near a specific timestamp (ms). Returns cleaned list; does NOT overwrite live pool.
async function fetchHistoricalTxs(coin, targetTs){
  try {
    if (coin === 'btc' || coin === 'ltc') {
      const base = coin === 'btc' ? 'https://mempool.space' : 'https://litecoinspace.org';
      const tipHeight = await fetchText(`${base}/api/blocks/tip/height`);
      const tipH = parseInt(tipHeight, 10);
      if (!tipH) return [];
      // Estimate block height by avg 10min (btc) / 2.5min (ltc) spacing
      const now = Date.now();
      const spacing = coin === 'btc' ? 600 : 150; // seconds
      const secAgo = Math.max(0, (now - targetTs) / 1000);
      let height = Math.max(1, Math.floor(tipH - secAgo / spacing));
      // Fetch 3 nearby blocks
      const heights = [height, height - 1, height + 1].filter(h => h > 0 && h <= tipH);
      const hashes = await Promise.all(heights.map(h => fetchText(`${base}/api/block-height/${h}`)));
      const validHashes = hashes.map(h => h && h.trim()).filter(Boolean);
      const pageJobs = [];
      for (const hash of validHashes) {
        for (const start of [0, 25]) pageJobs.push(fetchJson(`${base}/api/block/${hash}/txs/${start}`));
      }
      const pages = await Promise.all(pageJobs);
      const out = [];
      for (const page of pages) {
        if (!Array.isArray(page)) continue;
        for (const tx of page) {
          const vin = (tx.vin || []).find(v => v && v.prevout && v.prevout.scriptpubkey_address);
          const vout = (tx.vout || []).find(v => v && v.scriptpubkey_address && Number(v.value) > 0);
          const entry = normalizeTxEntry({
            txid: tx.txid,
            from: vin && vin.prevout && vin.prevout.scriptpubkey_address,
            to: vout && vout.scriptpubkey_address,
            amount: vout ? Number(vout.value) / 1e8 : 0,
            ts: (tx.status && tx.status.block_time ? tx.status.block_time : 0) * 1000
          });
          if (entry) out.push(entry);
        }
      }
      return cleanTxPool(out);
    }
    if (coin === 'eth' || coin === 'bnb') {
      const rpc = coin === 'eth' ? 'https://ethereum-rpc.publicnode.com' : 'https://bsc-rpc.publicnode.com';
      const decimals = 18;
      const latest = await fetchJson(rpc, { method:'POST', headers:{'Content-Type':'application/json'}, body: rpcBody('eth_blockNumber', []) });
      const tipNum = latest && latest.result ? parseInt(latest.result, 16) : null;
      if (!tipNum) return [];
      const spacing = coin === 'eth' ? 12 : 3; // seconds per block
      const secAgo = Math.max(0, (Date.now() - targetTs) / 1000);
      const guess = Math.max(1, tipNum - Math.floor(secAgo / spacing));
      const nums = [guess, guess - 1, guess + 1, guess - 2, guess + 2].filter(n => n > 0 && n <= tipNum);
      const blocks = await Promise.all(nums.map(n => fetchJson(rpc, {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: rpcBody('eth_getBlockByNumber', ['0x' + n.toString(16), true])
      })));
      const out = [];
      for (const data of blocks) {
        const block = data && data.result;
        const txs = block && block.transactions;
        if (!Array.isArray(txs)) continue;
        const ts = hexToNumber(block.timestamp, 0) * 1000;
        for (const tx of txs) {
          const entry = normalizeTxEntry({ txid: tx.hash, from: tx.from, to: tx.to, amount: hexToNumber(tx.value, decimals), ts });
          if (entry) out.push(entry);
        }
      }
      return cleanTxPool(out);
    }
    if (coin === 'sol') {
      const slotRes = await fetchJson('https://solana-rpc.publicnode.com', {
        method:'POST', headers:{'Content-Type':'application/json'}, body: rpcBody('getSlot', [])
      });
      const tipSlot = slotRes && slotRes.result;
      if (!tipSlot) return [];
      const spacing = 0.4; // ~400ms per slot
      const secAgo = Math.max(0, (Date.now() - targetTs) / 1000);
      const guess = Math.max(1, tipSlot - Math.floor(secAgo / spacing));
      const slots = [guess, guess - 4, guess + 4, guess - 8, guess + 8];
      const blocks = await Promise.all(slots.map(s => fetchJson('https://solana-rpc.publicnode.com', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: rpcBody('getBlock', [s, { encoding:'json', transactionDetails:'accounts', rewards:false, maxSupportedTransactionVersion:0 }])
      })));
      const out = [];
      for (const blk of blocks) {
        const block = blk && blk.result;
        const txs = block && block.transactions;
        if (!Array.isArray(txs)) continue;
        const ts = (block.blockTime || 0) * 1000;
        for (const tx of txs) {
          const sig = tx.transaction && tx.transaction.signatures && tx.transaction.signatures[0];
          if (!sig || (tx.meta && tx.meta.err)) continue;
          const keys = tx.transaction && tx.transaction.accountKeys;
          const pre = tx.meta && tx.meta.preBalances;
          const post = tx.meta && tx.meta.postBalances;
          if (!keys || !pre || !post) continue;
          let fromIdx = -1, toIdx = -1, amount = 0;
          for (let i=0;i<pre.length;i++){
            const d = post[i] - pre[i];
            if (d < 0 && fromIdx === -1) { fromIdx = i; amount = -d; }
            else if (d > 0 && toIdx === -1) { toIdx = i; }
          }
          if (fromIdx === -1 || toIdx === -1) continue;
          const entry = normalizeTxEntry({ txid: sig, from: solKey(keys[fromIdx]), to: solKey(keys[toIdx]), amount: amount / 1e9, ts });
          if (entry) out.push(entry);
        }
      }
      return cleanTxPool(out);
    }
    if (coin === 'xrp') {
      // XRP closes ~4s ledgers. Estimate ledger index via current validated.
      const cur = await fetchJson('https://xrplcluster.com/', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({method:'ledger_current', params:[{}]})
      });
      const tipIdx = cur && cur.result && (cur.result.ledger_current_index || (cur.result.ledger && cur.result.ledger.ledger_index));
      if (!tipIdx) return [];
      const secAgo = Math.max(0, (Date.now() - targetTs) / 1000);
      const guess = Math.max(1, tipIdx - Math.floor(secAgo / 4));
      const idxs = [guess, guess - 1, guess + 1];
      const ledgers = await Promise.all(idxs.map(i => fetchJson('https://xrplcluster.com/', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({method:'ledger', params:[{ledger_index:i, transactions:true, expand:true}]})
      })));
      const out = [];
      for (const data of ledgers) {
        const ledger = data && data.result && data.result.ledger;
        const txs = ledger && ledger.transactions;
        if (!Array.isArray(txs)) continue;
        const ts = ledger.close_time ? (Number(ledger.close_time) + 946684800) * 1000 : 0;
        for (const tx of txs) {
          if (tx.TransactionType !== 'Payment' || typeof tx.Amount !== 'string') continue;
          const entry = normalizeTxEntry({ txid: tx.hash, from: tx.Account, to: tx.Destination, amount: Number(tx.Amount) / 1e6, ts });
          if (entry) out.push(entry);
        }
      }
      return cleanTxPool(out);
    }
  } catch(_){}
  return [];
}
// Merge historical txs into the pool so subsequent matches benefit too.
function mergeIntoPool(coin, list){
  if (!list || !list.length) return;
  const combined = (TXID_POOL[coin] || []).concat(list);
  TXID_POOL[coin] = cleanTxPool(combined);
  saveTxidPoolCache();
}
async function resolveRealChainTx(coin, amount, targetTs){
  const wantTs = Number(targetTs) || 0;
  const now = Date.now();
  // If targetTs is recent (<2h), the live pool already covers it.
  const isRecent = wantTs && (now - wantTs) < 2 * 3600 * 1000;
  // Try instant match from current pool.
  let match = findTxMatch(coin, amount, wantTs);
  // Determine if existing match is "in the requested time window"
  const winOk = !wantTs || (match && match.ts && Math.abs(match.ts - wantTs) <= 36*3600*1000);
  if (match && winOk) {
    if (Date.now() - (TXID_POOL_TS[coin] || 0) > TXID_POOL_TTL && isRecent) refreshTxidPoolCoin(coin, true);
    return cloneChainTx(match);
  }
  // Need historical fetch for the target time.
  if (wantTs && !isRecent) {
    const hist = await Promise.race([
      fetchHistoricalTxs(coin, wantTs),
      new Promise(r => setTimeout(() => r([]), 6000))
    ]);
    if (hist && hist.length) {
      mergeIntoPool(coin, hist);
      const m2 = findTxMatch(coin, amount, wantTs);
      if (m2) return cloneChainTx(m2);
    }
  }
  // Fall back to recent pool refresh if nothing else.
  if (!match) {
    const fetchP = refreshTxidPoolCoin(coin, true);
    await Promise.race([fetchP, new Promise(r => setTimeout(r, 1500))]);
    match = findTxMatch(coin, amount, wantTs);
  }
  return cloneChainTx(match);
}

function txnRandHex(n){
  const c='0123456789abcdef'; let s=''; for(let i=0;i<n;i++) s+=c[Math.floor(Math.random()*16)]; return s;
}
function txnRandAlnum(n){
  const c='abcdefghijklmnopqrstuvwxyz0123456789'; let s=''; for(let i=0;i<n;i++) s+=c[Math.floor(Math.random()*c.length)]; return s;
}
function txnDeterministic(seed, fn){
  // Use seed to make a stable PRNG
  let s = 0; for (let i=0;i<seed.length;i++) s = (s*31 + seed.charCodeAt(i)) >>> 0;
  const rng = () => { s = (s*1664525 + 1013904223) >>> 0; return s/4294967296; };
  return fn(rng);
}
function txnGenAddr(coin, seed){
  return txnDeterministic(seed, rng => {
    const pre = TXN_COIN_PREFIX[coin] || '';
    const c='abcdefghijklmnopqrstuvwxyz0123456789';
    const len = coin==='btc' ? 38 : coin==='eth' ? 40 : coin==='sol' ? 44 : coin==='xrp' ? 33 : 38;
    let s=pre; for(let i=s.length;i<len;i++) s+=c[Math.floor(rng()*c.length)]; return s;
  });
}
function txnGenTxid(coin, seed){
  const pool = TXID_POOL[coin];
  if (pool && pool.length){
    let s = 0; for (let i=0;i<seed.length;i++) s = (s*31 + seed.charCodeAt(i)) >>> 0;
    const entry = pool[s % pool.length];
    return entry && entry.txid ? entry.txid : entry;
  }
  return txnDeterministic(seed+'tx', rng => {
    const c='0123456789abcdef';
    const len = 64;
    let s=''; for(let i=0;i<len;i++) s+=c[Math.floor(rng()*16)]; return s;
  });
}
function txnGenExtraInputs(coin, seed, isSent){
  return txnDeterministic(seed+'ex', rng => {
    const c='0123456789abcdef';
    const lines = isSent ? 1 : 5;
    const out = [];
    for (let i=0;i<lines;i++){
      let s=''; for(let j=0;j<64;j++) s+=c[Math.floor(rng()*16)];
      out.push(s + '-' + Math.floor(rng()*20));
    }
    return out.join(',');
  });
}
function txnGenConfirm(seed){
  return txnDeterministic(seed+'cf', rng => Math.floor(rng()*9000)+100);
}

function fmtTxnDetailDate(ts){
  const d = new Date(ts);
  const date = `${d.getMonth()+1}/${d.getDate()}/${d.getFullYear()}`;
  const time = d.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'});
  return `${date} - ${time}`;
}

const TXN_DET_ARROW_UP = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="6 11 12 5 18 11"/></svg>';
const TXN_DET_ARROW_DOWN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><polyline points="18 13 12 19 6 13"/></svg>';

function openTxnDetail(t){
  const overlay = document.getElementById('txnDetailOverlay');
  if (!overlay) return;
  const isSent = t.type === 'sent';
  const seed = `${t.coin}-${t.ts}-${t.amount}-${t.type}`;
  const settings = loadSettings();
  const currency = settings.currency || 'usd';
  const cached = getCachedPrice(t.coin, currency);
  const price = cached ? cached.price : (FALLBACK_PRICES[t.coin] || 0);
  const fiat = Math.abs(t.amount) * price;
  const fee = TXN_COIN_FEE[t.coin] || 0.0001;
  const feeFiat = fee * price;
  const sign = isSent ? '-' : '+';
  const sym = COIN_SYMBOLS[t.coin];

  document.getElementById('txnDetailType').textContent = isSent ? 'Sent' : 'Received';
  document.getElementById('txnDetailArrow').innerHTML = isSent ? TXN_DET_ARROW_UP : TXN_DET_ARROW_DOWN;
  const amtEl = document.getElementById('txnDetailAmt');
  amtEl.textContent = `${sign}${fmtAmount(Math.abs(t.amount))} ${sym}`;
  amtEl.className = 'txn-detail-amt ' + (isSent ? 'sent' : 'received');
  document.getElementById('txnDetailFiat').textContent = `${sign}${fmtUSD(fiat)}`;
  document.getElementById('txnDetailConfirm').textContent = `Confirmed (${txnGenConfirm(seed)})`;
  document.getElementById('txnDetailAccount').textContent = `${COIN_NAMES[t.coin]} 1`;
  document.getElementById('txnDetailDate').textContent = fmtTxnDetailDate(t.ts);
  document.getElementById('txnDetailFee').textContent = `${fee.toFixed(8).replace(/0+$/,'').replace(/\.$/,'')} ${sym}`;
  document.getElementById('txnDetailFeeFiat').textContent = fmtUSD(feeFiat);
  const match = cloneChainTx(t.chainTx) || findTxMatch(t.coin, Math.abs(t.amount), t.ts);
  const realTxid = match && match.txid ? match.txid : 'Pulling real transaction...';
  document.getElementById('txnDetailTxid').textContent = realTxid;
  window.__currentTxn = match ? { coin: t.coin, txid: realTxid } : { coin: t.coin, txid: null, pendingKey: seed };
  // Use from/to imported from the exact same real on-chain txid shown above.
  if (match) {
    document.getElementById('txnDetailFrom').textContent = match.from;
    document.getElementById('txnDetailTo').textContent = match.to;
  } else {
    document.getElementById('txnDetailFrom').textContent = 'Pulling real transaction...';
    document.getElementById('txnDetailTo').textContent = 'Pulling real transaction...';
  }
  document.getElementById('txnDetailExtra').textContent = txnGenExtraInputs(t.coin, seed, isSent);

  overlay.classList.add('open');
  document.body.style.overflow = 'hidden';
  const sc = document.getElementById('txnDetailScroll');
  if (sc) sc.scrollTop = 0;
  if (!t.chainTx) resolveRealChainTx(t.coin, Math.abs(t.amount), t.ts).then(real => {
    const cur = window.__currentTxn;
    if (!real || !cur || cur.coin !== t.coin || (cur.txid && cur.txid !== realTxid)) return;
    t.chainTx = real;
    const txns = loadTxns();
    const idx = txns.findIndex(x => x.ts === t.ts && x.coin === t.coin && x.amount === t.amount && x.type === t.type);
    if (idx !== -1) { txns[idx].chainTx = real; saveTxns(txns); }
    document.getElementById('txnDetailTxid').textContent = real.txid;
    document.getElementById('txnDetailFrom').textContent = real.from;
    document.getElementById('txnDetailTo').textContent = real.to;
    window.__currentTxn = { coin: t.coin, txid: real.txid };
  });
}
function closeTxnDetail(){
  const overlay = document.getElementById('txnDetailOverlay');
  if (overlay) overlay.classList.remove('open');
  document.body.style.overflow = '';
}
document.addEventListener('DOMContentLoaded', () => {
  const back = document.getElementById('txnDetailBack');
  if (back) back.addEventListener('click', closeTxnDetail);
  const explorer = document.querySelector('.txn-detail-explorer');
  if (explorer) explorer.addEventListener('click', () => {
    const cur = window.__currentTxn;
    if (!cur) return;
    const builder = EXPLORER_URLS[cur.coin];
    if (!builder) return;
    const url = builder(cur.txid);
    // Force open in Safari (escape webclip standalone). Use x-safari-https scheme on iOS standalone.
    const isStandalone = (window.navigator.standalone === true) ||
      window.matchMedia('(display-mode: standalone)').matches;
    if (isStandalone && /iPhone|iPad|iPod/.test(navigator.userAgent)) {
      const safariUrl = url.replace(/^https:\/\//, 'x-safari-https://').replace(/^http:\/\//, 'x-safari-http://');
      window.location.href = safariUrl;
    } else {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  });
});
