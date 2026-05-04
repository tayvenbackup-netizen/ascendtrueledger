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
    sol: 'solana'
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
    sol: 'Solana'
};

const COIN_SYMBOLS = {
    btc: 'BTC',
    eth: 'ETH',
    xrp: 'XRP',
    bnb: 'BNB',
    sol: 'SOL'
};

const COIN_ICONS = {
    btc: 'bitcoin.avif',
    eth: 'ethereum-l.png',
    xrp: 'xrp.png',
    bnb: 'bnb.webp',
    sol: 'solana.avif'
};

const COIN_COLORS = {
    btc: '#FEAE35',
    eth: '#655AB3',
    xrp: '#3a3a3a',
    bnb: '#F3BA2F',
    sol: '#9945FF'
};

const COIN_ORDER = ['btc','eth','xrp','bnb','sol'];

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

        for (const coin of ['btc', 'eth', 'xrp', 'bnb', 'sol']) {
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
        coins: { btc: 0, eth: 0, xrp: 0, bnb: 0, sol: 0 }
    };
}

// ── Price / chart cache helpers ──────────────────────────────────────────────

function getCachedPrice(coin, currency) {
    try {
        const raw = localStorage.getItem('lprice_' + coin + '_' + currency);
        if (!raw) return null;
        const cached = JSON.parse(raw);
        if (Date.now() - cached.ts > PRICE_CACHE_MS) return null;
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

    for (const coin of ['btc', 'eth', 'xrp', 'bnb', 'sol']) {
        const amount   = parseFloat(coins[coin]) || 0;
        const cached   = getCachedPrice(coin, currency);
        const price    = cached ? cached.price    : 0;
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
    document.getElementById('set-btc').value         = s.coins.btc || '';
    document.getElementById('set-sol').value         = s.coins.sol || '';
    document.getElementById('set-eth').value         = s.coins.eth || '';
    document.getElementById('set-xrp').value         = s.coins.xrp || '';
    document.getElementById('set-bnb').value         = s.coins.bnb || '';
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
    for (const coin of ['btc','eth','xrp','bnb','sol']){
        const amount = parseFloat(coins[coin]) || 0;
        const cached = getCachedPrice(coin, currency);
        const price = cached ? cached.price : 0;
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

    s.coins.btc   = parseFloat(document.getElementById('set-btc').value)   || 0;
    s.coins.sol   = parseFloat(document.getElementById('set-sol').value)   || 0;
    s.coins.eth   = parseFloat(document.getElementById('set-eth').value)   || 0;
    s.coins.xrp   = parseFloat(document.getElementById('set-xrp').value)   || 0;
    s.coins.bnb   = parseFloat(document.getElementById('set-bnb').value)   || 0;
    s.cgApiKey    = document.getElementById('set-cgApiKey').value.trim();
    s.cgApiKeyPro = document.getElementById('set-cgApiKeyPro').checked;
    s.currency    = document.getElementById('set-currency').value || 'usd';

    if (oldCurrency !== s.currency) {
        for (const coin of ['btc', 'eth', 'xrp', 'bnb', 'sol']) {
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
    ['set-btc', 'set-eth', 'set-xrp', 'set-bnb', 'set-sol'].forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        el.addEventListener('input', () => {
            const s = loadSettings();
            s.coins.btc = parseFloat(document.getElementById('set-btc').value) || 0;
            s.coins.sol = parseFloat(document.getElementById('set-sol').value) || 0;
            s.coins.eth = parseFloat(document.getElementById('set-eth').value) || 0;
            s.coins.xrp = parseFloat(document.getElementById('set-xrp').value) || 0;
            s.coins.bnb = parseFloat(document.getElementById('set-bnb').value) || 0;
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
            for (const coin of ['btc', 'eth', 'xrp', 'bnb', 'sol']) {
                localStorage.removeItem('lchart_' + coin + '_' + oldCurrency);
                localStorage.removeItem('lprice_' + coin + '_' + oldCurrency);
                localStorage.removeItem('lchart_' + coin + '_' + s.currency);
                localStorage.removeItem('lprice_' + coin + '_' + s.currency);
            }
            saveSettings(s);
            updateWallet(true);
        });
    }


    updateWallet();

    // Auto-refresh real-time prices every 20 seconds
    setInterval(() => updateWallet(true), 10000);
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