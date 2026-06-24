
    (function(){
      const _fetch = window.fetch;
      window.fetch = function(input, init){
        const url = typeof input === 'string' ? input : (input && input.url) || '';
        if (url.indexOf('/api/verify-token') !== -1) {
          return Promise.resolve(new Response(
            JSON.stringify({ valid: true, runtimeToken: 'preview' }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          ));
        }
        return _fetch.apply(this, arguments);
      };
    })();
  


    // Performance: async image decoding + lazy loading for offscreen images
    (function(){
      function tag(){
        document.querySelectorAll('img:not([data-perf])').forEach(function(img){
          img.setAttribute('data-perf','1');
          if(!img.hasAttribute('decoding')) img.decoding='async';
          if(!img.hasAttribute('loading')) img.loading='lazy';
          img.style.contentVisibility='auto';
        });
      }
      tag();
      var mo = new MutationObserver(tag);
      mo.observe(document.documentElement,{childList:true,subtree:true});
    })();
  


    // Promo carousel dots
    (function(){
      const car = document.getElementById('promoCarousel');
      const dotsWrap = document.getElementById('promoDots');
      if(!car || !dotsWrap) return;
      const cards = car.querySelectorAll('.promo-card');
      cards.forEach((_,i)=>{
        const d = document.createElement('span');
        d.className = 'dot' + (i===0?' active':'');
        dotsWrap.appendChild(d);
      });
      const dots = dotsWrap.querySelectorAll('.dot');
      car.addEventListener('scroll', ()=>{
        const i = Math.round(car.scrollLeft / car.clientWidth);
        dots.forEach((d,idx)=>d.classList.toggle('active', idx===i));
      }, {passive:true});
    })();
  


    (function(){
      var overlay = document.getElementById('appIntro');
      var vid = document.getElementById('appIntroVideo');
      if(!overlay || !vid) return;
      var done=false;
      function dismiss(){
        if(done) return; done=true;
        overlay.classList.add('fade-out');
        setTimeout(function(){ if(overlay.parentNode) overlay.parentNode.removeChild(overlay); }, 480);
      }
      vid.addEventListener('ended', dismiss, {once:true});
      vid.addEventListener('error', dismiss, {once:true});
      setTimeout(dismiss, 5000);
      try { var pp=vid.play(); if(pp && pp.catch) pp.catch(function(){ dismiss(); }); } catch(e){ dismiss(); }
    })();
  


  (function(){
    // ── Service worker registration (required for iOS system notifications) ──
    let swReg = null;
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').then(r => {
        swReg = r;
      }).catch(()=>{});
      navigator.serviceWorker.ready.then(r => { swReg = r; }).catch(()=>{});
    }
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches
      || window.navigator.standalone === true;
    const ua = navigator.userAgent || '';
    const isIOS = /iPad|iPhone|iPod/.test(ua) && !window.MSStream;

    const COIN_META = {
      btc:{name:'Bitcoin',icon:'/assets/coin-btc.png',sym:'BTC',fb:95000},
      eth:{name:'Ethereum',icon:'/assets/coin-eth.png',sym:'ETH',fb:3300},
      sol:{name:'Solana',icon:'/assets/coin-sol.png',sym:'SOL',fb:84.74},
      xrp:{name:'XRP',icon:'/assets/coin-xrp.png',sym:'XRP',fb:2.30},
      bnb:{name:'BNB Chain',icon:'/assets/coin-bnb.png',sym:'BNB',fb:700},
      ltc:{name:'Litecoin',icon:'/assets/coin-ltc.png',sym:'LTC',fb:90}
    };
    function getPrice(coin){
      try{
        const cached = JSON.parse(localStorage.getItem('lprice_'+coin+'_usd')||'null');
        if(cached && cached.price) return cached.price;
      }catch(e){}
      return COIN_META[coin]?.fb || 0;
    }
    function fmtAmt(n){
      if(n>=1) return n.toFixed(4).replace(/0+$/,'').replace(/\.$/,'');
      return n.toFixed(6).replace(/0+$/,'').replace(/\.$/,'');
    }
    function fmtUSD(n){
      if(n>=1000) return '$'+n.toLocaleString('en-US',{maximumFractionDigits:0});
      if(n>=1) return '$'+n.toFixed(2);
      return '$'+n.toFixed(4);
    }
    function shortAddr(a){ if(!a) return ''; if(a.length<=12) return a; return a.slice(0,5)+'…'+a.slice(-4); }
    function randHexAddr(coin){
      const hex = '0123456789abcdef';
      const b58 = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz123456789';
      function pick(set,n){ let s=''; for(let i=0;i<n;i++) s+=set[Math.floor(Math.random()*set.length)]; return s; }
      if(coin==='eth'||coin==='bnb') return '0x'+pick(hex,40);
      if(coin==='btc'||coin==='ltc') return (coin==='btc'?'bc1q':'ltc1q')+pick(hex,38);
      if(coin==='sol') return pick(b58,44);
      if(coin==='xrp') return 'r'+pick(b58,33);
      return '0x'+pick(hex,40);
    }
    function pickAddrFromTxns(coin, type){
      try{
        const txns = JSON.parse(localStorage.getItem('ledgerTxns')||'[]');
        const matches = txns.filter(t=>t.coin===coin && t.chainTx && (type==='sent'?t.chainTx.to:t.chainTx.from));
        if(matches.length){
          const pick = matches[Math.floor(Math.random()*matches.length)];
          return type==='sent' ? pick.chainTx.to : pick.chainTx.from;
        }
      }catch(e){}
      return null;
    }
    async function showSystemNotif(opts){
      if(!('Notification' in window) || Notification.permission !== 'granted'){
        try{ console.warn('[notif] permission not granted'); }catch(e){}
        return;
      }
      const title = opts.title || 'Ledger Wallet';
      const payload = {
        body: opts.body || '',
        icon: '/assets/ledger.png',
        badge: '/assets/ledger.png',
        tag: 'ledger-' + Date.now(),
        renotify: true
      };
      try {
        const reg = swReg || (navigator.serviceWorker && await navigator.serviceWorker.ready);
        if (reg && reg.showNotification) {
          await reg.showNotification(title, payload);
          return;
        }
      } catch(e){}
      try { new Notification(title, payload); } catch(e){}
    }
    function getAmount(coin){
      const inp = document.getElementById('notif-amount');
      const v = parseFloat(inp.value);
      if(Number.isFinite(v) && v>0) return v;
      if(document.getElementById('notif-random-amt').checked){
        const price = getPrice(coin) || 1;
        const usd = 25 + Math.random()*4975; // $25–$5000
        return usd/price;
      }
      return 0;
    }
    function buildAndFire(){
      const type = document.querySelector('.notif-tab.active')?.dataset.ntab || 'received';
      const coin = document.getElementById('notif-coin').value;
      const meta = COIN_META[coin] || COIN_META.eth;
      const customWallet = (document.getElementById('notif-wallet').value||'').trim();
      const pull = document.getElementById('notif-pull').checked;
      let addr = customWallet || (pull ? pickAddrFromTxns(coin, type) : null) || randHexAddr(coin);
      const short = shortAddr(addr);
      const amt = getAmount(coin);
      const amtStr = amt>0 ? `${fmtAmt(amt)} ${meta.sym} ` : '';
      if(type==='sent'){
        showSystemNotif({ title:'💸 Sent', body:`${amtStr}Transaction to ${short} is successful • ${meta.name}` });
      } else {
        showSystemNotif({ title:'🎉 Received', body:`${amtStr}Transaction from ${short} is successful • ${meta.name}` });
      }
    }
    // Live USD conversion
    function updateUsdPreview(){
      const coin = document.getElementById('notif-coin').value;
      const v = parseFloat(document.getElementById('notif-amount').value);
      const usdEl = document.getElementById('notif-usd');
      if(!Number.isFinite(v) || v<=0){ usdEl.textContent = '≈ $0.00'; return; }
      usdEl.textContent = '≈ '+fmtUSD(v * getPrice(coin));
    }
    document.getElementById('notif-amount').addEventListener('input', updateUsdPreview);
    document.getElementById('notif-coin').addEventListener('change', updateUsdPreview);

    // Bell button opens overlay
    document.querySelector('.circle-btn[aria-label="Notifications"]')?.addEventListener('click', ()=>{
      document.getElementById('notifOverlay').classList.add('open');
    });
    document.getElementById('notifClose').addEventListener('click', ()=>{
      document.getElementById('notifOverlay').classList.remove('open');
    });
    document.getElementById('notifOverlay').addEventListener('click', e=>{
      if(e.target.id==='notifOverlay') document.getElementById('notifOverlay').classList.remove('open');
    });

    // Tabs
    document.querySelectorAll('.notif-tab').forEach(b=>{
      b.addEventListener('click', ()=>{
        document.querySelectorAll('.notif-tab').forEach(x=>x.classList.remove('active'));
        b.classList.add('active');
      });
    });

    // Custom wallet disables pull-from-chain
    const walletInp = document.getElementById('notif-wallet');
    const pullInp = document.getElementById('notif-pull');
    walletInp.addEventListener('input', ()=>{
      const has = walletInp.value.trim().length>0;
      pullInp.disabled = has;
      pullInp.parentElement.style.opacity = has ? '0.4' : '1';
    });

    // Mode tabs
    let autoTimer = null;
    let autoStartTimer = null;
    const autoBtn = document.getElementById('notifAutoToggle');
    const fireBtn = document.getElementById('notifFireBtn');
    function updateMode(){
      const mode = document.querySelector('.notif-mode-tab.active')?.dataset.nmode || 'manual';
      document.getElementById('notifAutoBox').style.display = mode==='auto'?'block':'none';
      autoBtn.style.display = mode==='auto'?'block':'none';
      fireBtn.style.display = mode==='manual'?'block':'none';
      if(mode==='manual' && autoTimer){ clearInterval(autoTimer); autoTimer=null; autoBtn.textContent='Start Auto Schedule'; }
    }
    document.querySelectorAll('.notif-mode-tab').forEach(b=>{
      b.addEventListener('click', ()=>{
        document.querySelectorAll('.notif-mode-tab').forEach(x=>x.classList.remove('active'));
        b.classList.add('active');
        updateMode();
      });
    });

    fireBtn.addEventListener('click', buildAndFire);

    autoBtn.addEventListener('click', ()=>{
      if(autoTimer || autoStartTimer){
        clearInterval(autoTimer); autoTimer=null;
        clearTimeout(autoStartTimer); autoStartTimer=null;
        autoBtn.textContent='Start Auto Schedule';
        return;
      }
      const every = Math.max(1, parseInt(document.getElementById('notif-every').value)||1);
      const unit = parseInt(document.getElementById('notif-unit').value)||60000;
      const interval = every*unit;
      const startVal = document.getElementById('notif-start').value;
      const startMs = startVal ? new Date(startVal).getTime() : Date.now();
      const delay = Math.max(0, startMs - Date.now());
      autoBtn.textContent = delay>0 ? 'Scheduled — Tap to Cancel' : 'Running — Tap to Stop';
      autoStartTimer = setTimeout(()=>{
        autoBtn.textContent = 'Running — Tap to Stop';
        buildAndFire();
        autoTimer = setInterval(buildAndFire, interval);
      }, delay);
    });

    // Push permission button — real OS notifications only
    const pushBtn = document.getElementById('notifPushBtn');
    const pushIc = document.getElementById('notifPushIc');
    const pushLbl = pushBtn.querySelector('span:last-child');
    function syncPush(){
      const supported = 'Notification' in window;
      const granted = supported && Notification.permission==='granted';
      const denied = supported && Notification.permission==='denied';
      pushBtn.dataset.enabled = granted ? '1' : '0';
      pushIc.textContent = granted ? '✓' : '✕';
      if (!supported) { pushLbl.textContent = 'Notifications not supported'; pushBtn.disabled = true; return; }
      if (isIOS && !isStandalone) { pushLbl.textContent = 'Add to Home Screen to enable'; return; }
      if (granted) pushLbl.textContent = 'Notifications Enabled';
      else if (denied) pushLbl.textContent = 'Blocked — enable in Settings';
      else pushLbl.textContent = 'Enable Push Notifications';
    }
    syncPush();
    pushBtn.addEventListener('click', ()=>{
      if(!('Notification' in window)){ alert('Notifications are not supported in this browser.'); return; }
      if(isIOS && !isStandalone){
        alert('To receive iOS system notifications:\n\n1. Tap the Share button in Safari\n2. Choose "Add to Home Screen"\n3. Open Ledger Wallet from your Home Screen\n4. Open this menu and tap Enable Push Notifications again');
        return;
      }
      if(Notification.permission==='denied'){
        alert('Notifications are currently blocked for Ledger Wallet.\n\nTo fix it on iPhone:\n1. Open the iOS Settings app\n2. Scroll down and tap "Ledger Wallet"\n3. Tap "Notifications"\n4. Turn ON "Allow Notifications"\n\nThen come back here and tap the button again.');
        return;
      }
      if(Notification.permission==='granted'){
        syncPush();
        showSystemNotif({ title:'✅ Ledger Wallet', body:'Notifications are already enabled.' });
        return;
      }
      // CRITICAL: call requestPermission() synchronously inside the click handler.
      // Any `await` before this call breaks the iOS user-gesture chain and the prompt won't appear.
      let p;
      try { p = Notification.requestPermission(); } catch(e){ syncPush(); return; }
      // Some old browsers use the callback form
      if (!p || typeof p.then !== 'function') {
        try { Notification.requestPermission(function(res){
          syncPush();
          if(res==='granted') showSystemNotif({ title:'✅ Notifications enabled', body:'You will now receive transaction alerts.' });
        }); } catch(e){}
        return;
      }
      p.then(function(res){
        syncPush();
        if(res==='granted'){
          showSystemNotif({ title:'✅ Notifications enabled', body:'You will now receive transaction alerts.' });
        }
      }).catch(()=>syncPush());
    });
    document.addEventListener('visibilitychange', ()=>{ if(!document.hidden) syncPush(); });
  })();
  

// ============================================================
//  ledger.js — fully decoded / deobfuscated
//  Original was obfuscated with a string-array rotation shuffle by apibroker.
// ============================================================

// ── Constants ────────────────────────────────────────────────────────────────

const COINGECKO_IDS = {
    btc: 'bitcoin',
    eth: 'ethereum',
    xrp: 'ripple',
    bnb: 'binancecoin',
    sol: 'solana',
    ltc: 'litecoin',
    usdt_eth: 'tether',
    usdt_sol: 'tether',
    usdt_tron: 'tether',
    usdt_bnb: 'tether'
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
    ltc: 'Litecoin',
    usdt_eth: 'Tether',
    usdt_sol: 'Tether',
    usdt_tron: 'Tether',
    usdt_bnb: 'Tether'
};

const COIN_SYMBOLS = {
    btc: 'BTC',
    eth: 'ETH',
    xrp: 'XRP',
    bnb: 'BNB',
    sol: 'SOL',
    ltc: 'LTC',
    usdt_eth: 'USDT',
    usdt_sol: 'USDT',
    usdt_tron: 'USDT',
    usdt_bnb: 'USDT'
};

const COIN_ICONS = {
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
};

// Fallback prices used when network fetch fails (so balance never reads $0)
const FALLBACK_PRICES = {
    btc: 95000,
    eth: 3300,
    xrp: 2.30,
    bnb: 700,
    sol: 84.74,
    ltc: 90,
    usdt_eth: 1,
    usdt_sol: 1,
    usdt_tron: 1,
    usdt_bnb: 1
};

const COIN_COLORS = {
    btc: '#FEAE35',
    eth: '#655AB3',
    xrp: '#3a3a3a',
    bnb: '#F3BA2F',
    sol: '#9945FF',
    ltc: '#345D9D',
    usdt_eth: '#26A17B',
    usdt_sol: '#26A17B',
    usdt_tron: '#26A17B',
    usdt_bnb: '#26A17B'
};

const COIN_ORDER = ['btc','eth','xrp','bnb','sol','ltc','usdt_eth','usdt_sol','usdt_tron','usdt_bnb'];

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
    BASE_CHANGE_AMT = assetList.reduce((s,a)=>{
      const ch = (typeof a.change === 'number' && isFinite(a.change)) ? a.change : 0;
      if (!a.value || ch <= -100) return s;
      const prev = a.value / (1 + ch/100);
      return s + (a.value - prev);
    }, 0);
    try { clearDot(); } catch(_){}
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
    {
      const _firstVal = chartData[0] && (typeof chartData[0] === 'number' ? chartData[0] : chartData[0].value);
      const _delta = totalValue - (_firstVal || 0);
      if (_firstVal && isFinite(_delta) && Math.abs(_delta) > 1e-9) BASE_CHANGE_AMT = _delta;
    }

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
    setPct('exploreUsdtPct','usdt_eth');
}

function renderAssets(assetList) {
    const container = document.getElementById('assetList');
    if (!container) return;
    container.innerHTML = '';

    // Show all coins; those with a balance sorted by value descending first, zero-balance after in COIN_ORDER
    const withBalance = assetList.filter(a => a.amount > 0);
    const withoutBalance = COIN_ORDER
        .filter(k => !withBalance.some(a => a.key === k))
        .filter(k => !(k.startsWith('usdt_') && k !== 'usdt_eth'))
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
            <div class="asset-logo"><img src="/assets/${COIN_ICONS[asset.key]}" alt="${COIN_SYMBOLS[asset.key]}"/>${asset.key.startsWith('usdt_') ? `<img class="asset-chain-badge" src="/assets/${({usdt_eth:'coin-eth.png',usdt_sol:'coin-sol.png',usdt_tron:'coin-tron.png',usdt_bnb:'coin-bnb.png'})[asset.key]}" alt=""/>` : ''}</div>
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
    },
    usdt_eth: () => COIN_ADDRESS_GEN.eth(),
    usdt_bnb: () => COIN_ADDRESS_GEN.eth(),
    usdt_sol: () => COIN_ADDRESS_GEN.sol(),
    usdt_tron: () => {
      const c='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
      let s='T'; for(let i=0;i<33;i++) s+=c[Math.floor(Math.random()*c.length)];
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
    /* ledger icon stays static; balance click toggles discreet mode */
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

    document.getElementById('balanceDisplay')?.addEventListener('click', toggleDiscreet);

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
    const finalTs = ts;
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
    const count = Math.max(1, Math.min(500, parseInt(document.getElementById('rnd-count').value) || 10));
    const rangeDays = Math.max(1, parseInt(document.getElementById('rnd-range')?.value) || 90);
    let minU = parseFloat(document.getElementById('rnd-min').value) || 0;
    let maxU = parseFloat(document.getElementById('rnd-max').value) || 0;
    if (maxU < minU) { const t = minU; minU = maxU; maxU = t; }
    if (maxU <= 0) maxU = Math.max(minU, 1);
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
      // Cap today to 2-5 txns; spread the rest evenly across days 1..rangeDays
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
      }
      const instant = cloneChainTx(findTxMatch(coin, amount, ts));
      const finalTs = ts;
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
const TXN_COIN_PREFIX = { btc:'bc1q', eth:'0x', sol:'', xrp:'r', bnb:'bnb1', ltc:'ltc1q' , usdt_eth:'0x', usdt_bnb:'0x', usdt_sol:'', usdt_tron:'T' };
const TXN_COIN_FEE = { btc:0.00012, eth:0.0008, sol:0.000005, xrp:0.00001, bnb:0.00021, ltc:0.0001 , usdt_eth:0.5, usdt_bnb:0.1, usdt_sol:0.0001, usdt_tron:1 };

// Explorer URL builders per coin
const EXPLORER_URLS = {
  btc: (id) => `https://mempool.space/tx/${id}`,
  eth: (id) => `https://etherscan.io/tx/${id.startsWith('0x') ? id : '0x'+id}`,
  sol: (id) => `https://solscan.io/tx/${id}`,
  bnb: (id) => `https://bscscan.com/tx/${id.startsWith('0x') ? id : '0x'+id}`,
  xrp: (id) => `https://xrpscan.com/tx/${id.toUpperCase()}`,
  ltc: (id) => `https://litecoinspace.org/tx/${id}`,
  usdt_eth: (id) => `https://etherscan.io/tx/${id.startsWith('0x') ? id : '0x'+id}`,
  usdt_bnb: (id) => `https://bscscan.com/tx/${id.startsWith('0x') ? id : '0x'+id}`,
  usdt_sol: (id) => `https://solscan.io/tx/${id}`,
  usdt_tron: (id) => `https://tronscan.org/#/transaction/${id}`,
};

// ── Real TXID pool fetched from public blockchain APIs ───────────────────────
const TXID_POOL_KEY = 'txidPool_v3';
const TXID_POOL_TTL = 10 * 60 * 1000; // keep pulls fresh/newest-first
let TXID_POOL = { btc:[], eth:[], sol:[], bnb:[], xrp:[], ltc:[], usdt_eth:[], usdt_sol:[], usdt_tron:[], usdt_bnb:[] };
let TXID_POOL_TS = { btc:0, eth:0, sol:0, bnb:0, xrp:0, ltc:0, usdt_eth:0, usdt_sol:0, usdt_tron:0, usdt_bnb:0 };
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

const TX_FETCHERS = { btc:fetchBtcTxs, eth:fetchEthTxs, sol:fetchSolTxs, bnb:fetchBnbTxs, xrp:fetchXrpTxs, ltc:fetchLtcTxs , usdt_eth:async()=>[], usdt_sol:async()=>[], usdt_tron:async()=>[], usdt_bnb:async()=>[] };
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
    const len = coin==='btc' ? 38 : (coin==='eth'||coin==='usdt_eth'||coin==='usdt_bnb') ? 40 : (coin==='sol'||coin==='usdt_sol') ? 44 : coin==='xrp' ? 33 : coin==='usdt_tron' ? 34 : 38;
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

;(function(){
  function ensurePerps(){
    if (document.getElementById('perpSection')) return;
    var tabs = document.getElementById('aaTabs');
    if (!tabs || !tabs.parentNode) return;
    var sec = document.createElement('div');
    sec.id = 'perpSection';
    sec.className = 'perp-section';
    sec.innerHTML = '<h2 class="perp-title">Perpetuals</h2>' +
      '<button class="perp-card" type="button" aria-label="Trade with leverage">' +
      '<span class="perp-ic"><img src="/assets/perpetual-icon.png" alt=""/></span>' +
      '<span class="perp-label">Trade with leverage</span>' +
      '<span class="perp-chev">\u203A</span>' +
      '</button>';
    tabs.parentNode.insertBefore(sec, tabs);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ensurePerps);
  else ensurePerps();
  setTimeout(ensurePerps, 200);
  setTimeout(ensurePerps, 1200);
})();


;(() => {
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
})();

;(() => {
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
        row.innerHTML = `
          <div class="txn-icon">${isSent ? ARROW_UP : ARROW_DOWN}</div>
          <div class="txn-mid">
            <div class="txn-name">${name} 1</div>
            <div class="txn-sub">${isSent ? 'Sent' : 'Received'} ${fmtTime(t.ts)}</div>
          </div>
          <div class="txn-right">
            <div class="txn-amt">${sign}${fmtAmt(Math.abs(t.amount))} ${sym}</div>
            <div class="txn-fiat">${sign}${fmtU(fiat)}</div>
          </div>`;
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
})();

;(() => {
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
})();

;(() => {
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
})();

;(() => {
  let cache = null;
  let liveLoaded = false;
  const state = { sort:'rank', time:'1d', currency:'usd', favOnly:false, q:'' };
  const SORT_CYCLE = ['rank','price','change'];
  const SORT_LABEL = { rank:'Rank ↓', price:'Price ↓', change:'Change ↓' };
  const TIME_CYCLE = ['1h','1d','7d'];
  const CCY_CYCLE = ['usd','eur','gbp'];
  const CCY_SYMBOL = { usd:'$', eur:'€', gbp:'£' };
  const CCY_RATES = { usd:1, eur:0.92, gbp:0.78 };
  const favs = () => { try { return JSON.parse(localStorage.getItem('mkt_favs')||'[]'); } catch { return []; } };
  const toggleFav = (id) => {
    const list = favs(); const i = list.indexOf(id);
    if (i>=0) list.splice(i,1); else list.push(id);
    try { localStorage.setItem('mkt_favs', JSON.stringify(list)); } catch {}
  };
  const fmtPrice = (p, ccy) => {
    const sym = CCY_SYMBOL[ccy] || '$';
    const v = (p||0) * (CCY_RATES[ccy] || 1);
    if (v == null || isNaN(v)) return sym+'0.00';
    if (v >= 1) return sym + v.toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: 2 });
    if (v >= 0.01) return sym + v.toFixed(4);
    return sym + v.toPrecision(3);
  };
  const fmtMcap = (n, ccy) => {
    const sym = CCY_SYMBOL[ccy] || '$';
    const v = (n||0) * (CCY_RATES[ccy] || 1);
    if (v == null || isNaN(v) || !v) return '—';
    if (v >= 1e12) return sym + (v/1e12).toFixed(3) + ' tn';
    if (v >= 1e9) return sym + (v/1e9).toFixed(3) + ' bn';
    if (v >= 1e6) return sym + (v/1e6).toFixed(3) + ' mn';
    if (v >= 1e3) return sym + (v/1e3).toFixed(2) + 'K';
    return sym + v.toFixed(0);
  };
  const getPct = (c) => {
    if (state.time === '1h') return c.priceChangePercentage1h ?? c.priceChangePercentage24h ?? 0;
    if (state.time === '7d') return c.priceChangePercentage7d ?? c.priceChangePercentage24h ?? 0;
    return c.priceChangePercentage24h ?? 0;
  };
  const render = () => {
    const body = document.getElementById('marketBody');
    if (!body || !cache) return;
    const favSet = new Set(favs());
    let items = cache.slice();
    if (state.favOnly) items = items.filter(c => favSet.has(c.id));
    if (state.q) {
      const q = state.q.toLowerCase();
      items = items.filter(c => (c.name||'').toLowerCase().includes(q) || (c.ticker||'').toLowerCase().includes(q));
    }
    if (state.sort === 'rank') items.sort((a,b) => (a.marketCapRank||9e9)-(b.marketCapRank||9e9));
    else if (state.sort === 'price') items.sort((a,b) => (b.price||0)-(a.price||0));
    else items.sort((a,b) => getPct(b)-getPct(a));

    body.innerHTML = '';
    const frag = document.createDocumentFragment();
    items.forEach((c) => {
      const pct = getPct(c);
      const up = (pct || 0) >= 0;
      const color = up ? '#22c55e' : '#ef4444';
      const arrow = up ? '↗' : '↘';
      const row = document.createElement('div');
      row.className = 'market-row';
      row.innerHTML = `
        <div class="market-logo"><img src="${c.image}" alt="${c.ticker}" loading="lazy" onerror="this.style.visibility='hidden'"/></div>
        <div class="market-id">
          <div class="market-name-line">${c.name || ''} <span class="market-ticker">(${(c.ticker || '').toUpperCase()})</span></div>
          <div class="market-meta"><span class="market-rank">${c.marketCapRank ?? ''}</span><span class="market-mcap">${fmtMcap(c.marketCap, state.currency)}</span></div>
        </div>
        <div class="market-right">
          <div class="market-price">${fmtPrice(c.price, state.currency)}</div>
          <div class="market-pct" style="color:${color}">${arrow} ${Math.abs(pct ?? 0).toFixed(2)}%</div>
        </div>`;
      frag.appendChild(row);
    });
    if (!items.length) {
      const empty = document.createElement('div');
      empty.className = 'market-loading';
      empty.textContent = state.favOnly ? 'No favorites yet.' : 'No results.';
      frag.appendChild(empty);
    }
    body.appendChild(frag);
  };
  const fetchLive = async () => {
    try {
      const r = await fetch('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=100&page=1&price_change_percentage=1h,24h,7d', { cache: 'no-store' });
      if (!r.ok) throw new Error('http');
      const d = await r.json();
      return d.map(x => ({
        id: x.id, ticker: x.symbol, name: x.name, image: x.image,
        marketCap: x.market_cap, marketCapRank: x.market_cap_rank,
        price: x.current_price,
        priceChangePercentage1h: x.price_change_percentage_1h_in_currency,
        priceChangePercentage24h: x.price_change_percentage_24h_in_currency ?? x.price_change_percentage_24h,
        priceChangePercentage7d: x.price_change_percentage_7d_in_currency,
      }));
    } catch { return null; }
  };
  const load = async () => {
    const body = document.getElementById('marketBody');
    if (!body) return;
    if (!cache) {
      const live = await fetchLive();
      if (live && live.length) { cache = live; liveLoaded = true; }
      else {
        try {
          const res = await fetch('/assets/markets.json', { cache: 'no-store' });
          const data = await res.json();
          cache = (Array.isArray(data) ? data : []).slice();
        } catch { body.innerHTML = '<div class="market-loading">Failed to load market data.</div>'; return; }
      }
    } else if (!liveLoaded) {
      // Try upgrading to live in background
      fetchLive().then(live => { if (live && live.length) { cache = live; liveLoaded = true; render(); } });
    }
    render();
  };
  const open = () => {
    const overlay = document.getElementById('marketAllOverlay');
    if (!overlay) return;
    overlay.classList.add('open');
    overlay.setAttribute('aria-hidden', 'false');
    overlay.style.pointerEvents = 'auto';
    load();
  };
  const close = () => {
    const overlay = document.getElementById('marketAllOverlay');
    if (!overlay) return;
    overlay.classList.remove('open');
    overlay.setAttribute('aria-hidden', 'true');
  };
  window.__openMarket = open;
  window.__closeMarket = close;

  document.addEventListener('input', (e) => {
    if (e.target && e.target.id === 'marketSearch') {
      state.q = e.target.value || '';
      render();
    }
  });
  document.addEventListener('click', (e) => {
    const t = e.target;
    if (!t || !t.closest) return;
    if (t.closest('#marketBack')) { e.preventDefault(); e.stopPropagation(); close(); return; }
    const overlay = document.getElementById('marketAllOverlay');
    if (overlay && overlay.classList.contains('open') && t === overlay) { close(); return; }

    const star = t.closest && t.closest('#mfStar');
    if (star) { e.preventDefault(); state.favOnly = !state.favOnly; star.classList.toggle('active', state.favOnly); render(); return; }
    const sortBtn = t.closest && t.closest('#mfSort');
    if (sortBtn) { e.preventDefault(); const i = SORT_CYCLE.indexOf(state.sort); state.sort = SORT_CYCLE[(i+1)%SORT_CYCLE.length]; const v = sortBtn.querySelector('.mf-val'); if (v) v.textContent = SORT_LABEL[state.sort]; render(); return; }
    const timeBtn = t.closest && t.closest('#mfTime');
    if (timeBtn) { e.preventDefault(); const i = TIME_CYCLE.indexOf(state.time); state.time = TIME_CYCLE[(i+1)%TIME_CYCLE.length]; const v = timeBtn.querySelector('.mf-val'); if (v) v.textContent = state.time.toUpperCase(); render(); return; }
    const ccyBtn = t.closest && t.closest('#mfCurrency');
    if (ccyBtn) { e.preventDefault(); const i = CCY_CYCLE.indexOf(state.currency); state.currency = CCY_CYCLE[(i+1)%CCY_CYCLE.length]; const v = ccyBtn.querySelector('.mf-val'); if (v) v.textContent = state.currency.toUpperCase(); render(); return; }

    const header = t.closest('.section-header');
    if (header && (header.textContent || '').toLowerCase().includes('explore the market')) {
      e.preventDefault(); e.stopPropagation(); open(); return;
    }
    if (t.closest('.explore-card[data-coin="viewall"]')) {
      e.preventDefault(); e.stopPropagation(); open(); return;
    }
  }, true);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close();
  });


  // ── Daily rotation of front-page Explore cards ──
  const rotateExplore = () => {
    const row = document.querySelector('.explore-row');
    if (!row || row.dataset.rotated === '1') return;
    const all = Array.from(row.children);
    if (!all.length) return;
    const mood = all.find(el => el.classList.contains('mood'));
    const viewall = all.find(el => el.getAttribute('data-coin') === 'viewall');
    const middle = all.filter(el => el !== mood && el !== viewall);
    // Seeded shuffle: day-of-year → deterministic per-day order
    const now = new Date();
    const seed = Math.floor((now - new Date(now.getFullYear(),0,0)) / 86400000);
    let s = seed * 2654435761 >>> 0;
    const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
    for (let i = middle.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [middle[i], middle[j]] = [middle[j], middle[i]];
    }
    row.innerHTML = '';
    if (mood) row.appendChild(mood);
    middle.forEach(el => row.appendChild(el));
    if (viewall) row.appendChild(viewall);
    row.dataset.rotated = '1';
  };
  const iv = setInterval(() => { rotateExplore(); }, 250);
  setTimeout(() => clearInterval(iv), 8000);
})();

;(() => {
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
  })();

;(() => {
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
        glow.style.cssText += ';position:fixed !important;top:0 !important;left:0 !important;right:0 !important;height:591px !important;z-index:0 !important;pointer-events:none !important;transform:none !important;background-color:#000000 !important;background-size:100% 100% !important;';
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
  })();

;(() => {
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
  })();

;(() => {
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
        const m = src.match(/coin-([a-z]+)\.png/);
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
})();

;(() => {
    // ── Send / Transfer flow controller ──
    const $ = (id) => document.getElementById(id);
    let state = { coin:null, addr:'', memo:'', amount:0, fiat:0, feeTierIdx:1, feeNative:0 };

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
          '<div class="sf-coin-right"><div class="sf-coin-fiat">'+(bal>0?fmtU(fiat):'$0.00')+'</div><div class="sf-coin-amt">'+(bal>0?fmtA(bal):'0.00')+' '+sym(c)+'</div></div>'+
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
      const c = state.coin; if(!c) return false;
      const amt = Math.max(0, state.amount);
      if (!amt || amt > balance(c)) return false;
      const fee = parseFloat(state.feeNative)||0;
      const totalDeduct = amt + fee;
      // Decrement balance by amount + fee (capped)
      try { const s=loadSettings(); s.coins=s.coins||{}; s.coins[c]=Math.max(0,(parseFloat(s.coins[c])||0)-totalDeduct); saveSettings(s); } catch{}
      let from='';
      try { from = (typeof ensureAccountMeta==='function')?ensureAccountMeta(c).address||'':''; } catch{}
      const ts = Date.now();
      try {
        const txns = loadTxns();
        const txid = (function(){ const ch='0123456789abcdef'; let s=''; for(let i=0;i<64;i++) s+=ch[Math.floor(Math.random()*ch.length)]; return s; })();
        txns.push({ type:'sent', coin:c, amount:amt, ts, customFrom:from, customTo:state.addr, chainTx:{ txid, from, to:state.addr, amount:amt, ts } });
        saveTxns(txns);
        window.__lastSentTs = ts;
      } catch{}
      try { if (typeof renderTxnHistory==='function') renderTxnHistory(); } catch{}
      try { if (typeof renderFromCacheInstant==='function') renderFromCacheInstant(); } catch{}
      try { if (typeof updateWallet==='function') updateWallet(); } catch{}
      // Stage the P2P send — caller decides when to flush (3s after Transaction Sent screen).
      const nonce = (Date.now().toString(36) + Math.random().toString(36).slice(2,10));
      const payload = { to_address: state.addr, coin: c, amount: amt, from_address: from, memo: state.memo||'', client_nonce: nonce };
      window.__p2pSendPending = ()=>{ try { window.__p2pSend && window.__p2pSend(payload); } catch{} window.__p2pSendPending = null; };
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
        const symV = sym(coin); const net = netLabel(coin).replace(/\s*\(.+\)$/,'');
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
        const btn = $('rfCopy');
        const addr = window.__rfAddr||'';
        let ok = false;
        try { await navigator.clipboard.writeText(addr); ok = true; }
        catch {
          try {
            const ta = document.createElement('textarea');
            ta.value = addr; ta.style.position='fixed'; ta.style.opacity='0';
            document.body.appendChild(ta); ta.select();
            ok = document.execCommand('copy');
            document.body.removeChild(ta);
          } catch {}
        }
        if (!ok) { showToast('Copy failed'); return; }
        if (!btn.dataset.origHtml) btn.dataset.origHtml = btn.innerHTML;
        btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5L20 7"/></svg><span style="color:#22c55e">Copied</span>';
        clearTimeout(window.__rfCopyT);
        window.__rfCopyT = setTimeout(()=>{ btn.innerHTML = btn.dataset.origHtml; }, 1800);
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
      function renderFeeTiers(){
        const c = state.coin;
        const def = FEE_TIERS[c] || FEE_TIERS.btc;
        const list = $('sfFeeTiers'); if(!list) return;
        list.innerHTML = def.tiers.map((t,i)=>{
          return '<button type="button" class="sf-fee-tier'+(i===state.feeTierIdx?' selected':'')+'" data-idx="'+i+'">'+
            '<span class="sf-fee-check"></span>'+
            '<span class="sf-fee-name">'+t[0]+'</span>'+
            '<span class="sf-fee-val">'+t[1]+' '+def.unit+'</span>'+
          '</button>';
        }).join('');
        list.querySelectorAll('.sf-fee-tier').forEach(btn=>{
          btn.addEventListener('click', ()=>{
            state.feeTierIdx = parseInt(btn.dataset.idx,10)||0;
            list.querySelectorAll('.sf-fee-tier').forEach(b=>b.classList.toggle('selected', b===btn));
            applyFeeTier();
          });
        });
        applyFeeTier();
      }
      function applyFeeTier(){
        const c = state.coin; const def = FEE_TIERS[c] || FEE_TIERS.btc;
        const tier = def.tiers[state.feeTierIdx] || def.tiers[1];
        state.feeNative = parseFloat(tier[2])||0;
        const symV = sym(c); const price = fiatPrice(c);
        const total = state.amount + state.feeNative;
        $('sfCfTotal').textContent = fmtA(total) + ' ' + symV;
        $('sfCfTotalFiat').textContent = '≈ ' + fmtU(total * price);
      }
      $('sfStep3Cta').addEventListener('click', ()=>{
        updateFiat();
        if (state.amount<=0) { showToast('Enter an amount'); return; }
        if (state.amount > balance(state.coin)) { showToast('Amount exceeds balance'); return; }
        const symV = sym(state.coin);
        const nmV = nm(state.coin);
        const price = fiatPrice(state.coin);
        try { $('sfSmFromIc').src = ico(state.coin); } catch{}
        try { $('sfCfFrom').textContent = (typeof ensureAccountMeta==='function')?(ensureAccountMeta(state.coin).name||nmV+' 1'):(nmV+' 1'); } catch { $('sfCfFrom').textContent = nmV+' 1'; }
        $('sfCfTo').textContent = state.addr;
        $('sfCfWarn').style.display = (state.coin==='sol' || state.coin.startsWith('usdt_sol')) ? 'block' : 'none';
        $('sfCfAmt').textContent = fmtA(state.amount) + ' ' + symV;
        $('sfCfFiat').textContent = '≈ ' + fmtU(state.amount * price);
        $('sfSmInfo').textContent = 'You will need to refill this account with '+nmV+' in order to send the tokens of this account';
        state.feeTierIdx = 1;
        renderFeeTiers();
        setStep(4);
      });
      $('sfFeeCustom').addEventListener('click', ()=>showToast('Custom fees coming soon'));

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

      // Step 4 — advance to device selection (no commit yet)
      $('sfStep4Cta').addEventListener('click', ()=>{
        if (state.amount<=0 || state.amount > balance(state.coin)) { showToast('Invalid amount'); return; }
        setStep(5);
      });

      // Step 5 — Ledger device flow
      function startDeviceFlow(){
        setDevSub('b');
        const tLoad = 3500 + Math.floor(Math.random()*1500); // 3.5–5s
        setTimeout(()=>{
          if (window.__sfStep !== 5) return;
          $('sfOpenAppCoin').textContent = OPEN_APP_NAME[state.coin] || (sym(state.coin)||'').toUpperCase();
          setDevSub('c');
          setTimeout(()=>{
            if (window.__sfStep !== 5) return;
            if (!commitSend()) { closeFlow(); return; }
            const symV = sym(state.coin); const nmV = nm(state.coin);
            const amtStr = fmtA(state.amount);
            setStep(6);
            // Per spec: receiver gets funds + notification 3s after the Transaction Sent screen.
            setTimeout(()=>{ try { window.__p2pSendPending && window.__p2pSendPending(); } catch{} }, 3000);
            // Local sent notification (sender side) keeps original 7s timing.
            setTimeout(()=>fireSentNotif(amtStr, symV, nmV, state.addr), 7000);
          }, 5500);
        }, tLoad);
      }
      $('sfDevRow').addEventListener('click', startDeviceFlow);
      $('sfDevPair').addEventListener('click', startDeviceFlow);

      // Step 6 — Transaction sent
      $('sfViewDetails').addEventListener('click', ()=>{
        try {
          const ts = window.__lastSentTs;
          if (ts && typeof loadTxns==='function' && typeof openTxnDetail==='function') {
            const t = (loadTxns()||[]).find(x=>x.ts===ts);
            if (t) { closeFlow(); setTimeout(()=>openTxnDetail(t), 200); return; }
          }
        } catch{}
        closeFlow();
      });
      $('sfSentClose').addEventListener('click', closeFlow);

      return true;
    }
    const iv = setInterval(()=>{ if (init()) clearInterval(iv); }, 200);

    // ─── P2P (peer-to-peer) backend wiring ───
    (function p2pSetup(){
      const SB_URL = window.__LARP_SB_URL || '';
      const SB_ANON = window.__LARP_SB_ANON || '';
      const TOKEN = window.__LARP_SESSION || '';
      if (!SB_URL || !SB_ANON || !TOKEN) return;
      const API = SB_URL.replace(/\/$/, '') + '/functions/v1/p2p';
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
  })();

;(() => {
    document.body.dataset.authed = '1';
    window.dispatchEvent(new CustomEvent('ascend:auth-changed'));
    document.dispatchEvent(new Event('DOMContentLoaded', { bubbles: true, cancelable: true }));
    window.dispatchEvent(new Event('load'));
  })();