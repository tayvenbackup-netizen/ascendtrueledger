// Client-side hardening: PC detection, devtools detection, anti-tampering.
// Not bulletproof — pairs with server-side enforcement.

const _w = window as any;

export function isMobileDevice(): boolean {
  const ua = navigator.userAgent || '';
  const uaMob = /Android|iPhone|iPad|iPod|Mobile|BlackBerry|IEMobile|Opera Mini|webOS/i.test(ua);
  const touch = (navigator.maxTouchPoints || 0) > 1;
  const coarse = matchMedia('(pointer:coarse)').matches;
  // iPad Pro reports as Mac — accept if touch+coarse
  return uaMob || (touch && coarse);
}

let blanked = false;
function blank(reason: string) {
  if (blanked) return;
  blanked = true;
  try {
    document.documentElement.innerHTML = '<head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#fff;width:100vw;height:100vh"></body>';
  } catch {}
  // Wipe storage so attacker loses session
  try { localStorage.clear(); } catch {}
  try { sessionStorage.clear(); } catch {}
  try { document.cookie.split(';').forEach(c => { document.cookie = c.split('=')[0] + '=;expires=' + new Date(0).toUTCString() + ';path=/'; }); } catch {}
  // eslint-disable-next-line no-console
  console.warn(reason);
  // Hard reload after a moment so any stuck state is gone
  setTimeout(() => { try { location.replace('about:blank'); } catch {} }, 50);
}

export function installDevtoolsShield() {
  // Detect devtools by timing of `debugger` statement.
  const check = () => {
    const t0 = performance.now();
    // eslint-disable-next-line no-debugger
    debugger;
    const dt = performance.now() - t0;
    if (dt > 120) blank('dt');
  };

  // Detect by window size delta (devtools docked)
  const sizeCheck = () => {
    const wDiff = window.outerWidth - window.innerWidth;
    const hDiff = window.outerHeight - window.innerHeight;
    if (wDiff > 200 || hDiff > 220) blank('sz');
  };

  // Detect via console.log getter trick
  const trapCheck = () => {
    let triggered = false;
    const o: any = {};
    Object.defineProperty(o, 'id', { get() { triggered = true; return 'x'; } });
    // eslint-disable-next-line no-console
    console.log('%c', o);
    if (triggered) blank('cn');
  };

  setInterval(() => { try { check(); } catch { blank('ex'); } }, 1500);
  setInterval(sizeCheck, 1200);
  setInterval(trapCheck, 2500);

  // Block common shortcuts
  window.addEventListener('keydown', e => {
    const k = e.key?.toUpperCase();
    if (k === 'F12') { e.preventDefault(); blank('f12'); }
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && (k === 'I' || k === 'J' || k === 'C')) { e.preventDefault(); blank('sk'); }
    if ((e.ctrlKey || e.metaKey) && k === 'U') { e.preventDefault(); blank('vu'); }
    if ((e.ctrlKey || e.metaKey) && k === 'S') { e.preventDefault(); }
  }, true);

  window.addEventListener('contextmenu', e => e.preventDefault(), true);

  // Catch obvious tampering with our globals
  Object.freeze(_w.AscendShield = { v: 1 });
}

export function installPCBlock(onPC: () => void) {
  if (!isMobileDevice()) onPC();
  // Re-check on resize / orientation
  const recheck = () => { if (!isMobileDevice()) onPC(); };
  window.addEventListener('resize', recheck);
  window.addEventListener('orientationchange', recheck);
}
