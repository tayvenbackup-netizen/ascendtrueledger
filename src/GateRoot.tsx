import { useEffect, useRef, useState } from 'react';
import KeyEntryScreen from './components/shell/KeyEntryScreen';
import AdminPanel from './components/admin/AdminPanel';
import { useAccessControl } from './hooks/useAccessControl';
import { isMobileDevice } from './lib/shield';

// Wallet sources are shipped locally in public/wallet/ — fully editable in Xcode
// and bundled into the IPA via vite → dist → cap sync. No remote fetch.
const WALLET_HTML_URL = '/wallet/index.html';
const WALLET_CSS_URL = '/wallet/ledger.css';
const WALLET_JS_URL = '/wallet/ledger.js';
const BUNDLE_TIMEOUT_MS = 15000;


const IntroOverlay = () => (
  <div className="fixed inset-0 z-[9999]" style={{ background: '#0a0a14' }} />
);

// Detect Capacitor native shell (iOS/Android IPA/APK).
const isNativeShell = () => {
  try {
    const w: any = window as any;
    return !!(w.Capacitor && typeof w.Capacitor.isNativePlatform === 'function' && w.Capacitor.isNativePlatform());
  } catch { return false; }
};

// Shim the web Notification API onto Capacitor Local Notifications so the
// bundle's `new Notification()` / `Notification.requestPermission()` calls
// keep working inside the iOS/Android WKWebView (which has no Notification API).
async function installNativeNotificationShim() {
  if (!isNativeShell()) return;
  try {
    const mod: any = await import('@capacitor/local-notifications');
    const LN = mod.LocalNotifications;
    if (!LN) return;
    try { await LN.requestPermissions(); } catch {}
    const fire = (title: string, opts: any) => {
      try {
        LN.schedule({
          notifications: [{
            id: Math.floor(Math.random() * 2_000_000_000),
            title: title || 'Ledger Wallet',
            body: (opts && opts.body) || '',
            schedule: { at: new Date(Date.now() + 50) },
          }],
        });
      } catch {}
    };
    const ShimNotification: any = function (title: string, opts: any) { fire(title, opts); };
    ShimNotification.permission = 'granted';
    ShimNotification.requestPermission = async () => 'granted';
    try { (window as any).Notification = ShimNotification; } catch {}
    // Also patch ServiceWorkerRegistration.showNotification fallback used in bundle.
    try {
      (window as any).__nativeShowNotification = (title: string, opts: any) => fire(title, opts);
    } catch {}
  } catch (e) {
    console.warn('[native-notif] shim failed', e);
  }
}

const GateRoot = () => {
  const { isAuthed, isAdmin, isLoading, validateKey, error, session } = useAccessControl();
  const [adminOpen, setAdminOpen] = useState(false);
  const [bundleLoading, setBundleLoading] = useState(false);
  const [bundleError, setBundleError] = useState('');
  const injectedRef = useRef(false);
  const justValidatedRef = useRef(false);
  const [isPC, setIsPC] = useState(() => {
    try {
      const h = location.hostname;
      if (h.includes('lovable.app') || h.includes('lovableproject.com') || h.includes('lovable.dev') || h === 'localhost') return false;
    } catch {}
    return !isMobileDevice();
  });

  useEffect(() => {
    document.body.dataset.authed = isAuthed ? '1' : '0';
  }, [isAuthed]);

  useEffect(() => {
    try {
      const h = location.hostname;
      if (h.includes('lovable.app') || h.includes('lovableproject.com') || h.includes('lovable.dev') || h === 'localhost') return;
    } catch {}
    const r = () => setIsPC(!isMobileDevice());
    window.addEventListener('resize', r);
    window.addEventListener('orientationchange', r);
    return () => { window.removeEventListener('resize', r); window.removeEventListener('orientationchange', r); };
  }, []);

  useEffect(() => {
    const open = () => setAdminOpen(true);
    window.addEventListener('ascend:open-admin', open);
    return () => window.removeEventListener('ascend:open-admin', open);
  }, []);

  // Fetch + inject the protected wallet bundle after authentication
  useEffect(() => {
    if (!isAuthed || injectedRef.current || !session?.session_token) return;
    injectedRef.current = true;
    setBundleLoading(true);
    setBundleError('');
    // Hard watchdog — never let the loader hang forever even if fetch never settles.
    const watchdog = window.setTimeout(() => {
      setBundleError((prev) => prev || 'App load took too long. Please refresh.');
      setBundleLoading(false);
    }, BUNDLE_TIMEOUT_MS + 5000);
    (async () => {
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), BUNDLE_TIMEOUT_MS);
      const fetchText = async (url: string) => {
        const r = await fetch(url, { signal: controller.signal, cache: 'no-cache' });
        if (!r.ok) throw new Error(`${url} ${r.status}`);
        return r.text();
      };
      try {
        const [html, css, js] = await Promise.all([
          fetchText(WALLET_HTML_URL),
          fetchText(WALLET_CSS_URL),
          fetchText(WALLET_JS_URL),
        ]);

        // Inject CSS
        const styleEl = document.createElement('style');
        styleEl.id = 'protected-css';
        styleEl.textContent = css;
        document.head.appendChild(styleEl);

        // Inject HTML into protected root
        const root = document.getElementById('protected-root');
        if (root) {
          root.innerHTML = html;
          root.querySelector('#appIntro')?.remove();
        }

        // Wire admin button visibility BEFORE running bundle JS
        const cardBtn = document.querySelector('[data-nav="card"]') as HTMLElement | null;
        if (cardBtn) {
          if (isAdmin) {
            cardBtn.addEventListener('click', (ev) => {
              ev.preventDefault();
              ev.stopPropagation();
              window.dispatchEvent(new CustomEvent('ascend:open-admin'));
            }, true);
          } else {
            cardBtn.style.display = 'none';
          }
        }

        // Expose session + API endpoints to the wallet bundle (for P2P, etc.)
        try {
          (window as any).__LARP_SESSION = session.session_token;
          (window as any).__LARP_SB_URL = import.meta.env.VITE_SUPABASE_URL;
          (window as any).__LARP_SB_ANON = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
        } catch {}

        // Install native-shell notification shim before running bundle.
        try { await installNativeNotificationShim(); } catch {}

        // Execute wallet JS in a function scope.
        try {
          const fn = new Function(js);
          fn();
        } catch (bundleErr) {
          console.error('[wallet] runtime error', bundleErr);
        }

        setBundleLoading(false);
      } catch (e: any) {
        console.error('[wallet] load error', e);
        setBundleError(e?.name === 'AbortError' ? 'App load timed out. Refresh and try again.' : (e?.message || 'Failed to load app'));
        setBundleLoading(false);
        injectedRef.current = false;
      } finally {
        window.clearTimeout(timeout);
        window.clearTimeout(watchdog);
      }
    })();
  }, [isAuthed, isAdmin, session?.session_token]);


  if (isPC) {
    return (
      <div className="fixed inset-0 z-[10001] flex flex-col items-center justify-center px-6 text-center" style={{ background: '#0a0a14', color: '#fff' }}>
        <div className="text-[10px] font-bold uppercase mb-3" style={{ color: '#bbaefc', letterSpacing: '0.36em' }}>@richlater</div>
        <h1 className="text-2xl font-bold mb-2">ONLY WORKS ON MOBILE</h1>
        <p className="text-sm max-w-xs" style={{ color: '#8d87a8' }}>This experience is locked to mobile devices. Open the link on your phone to continue.</p>
      </div>
    );
  }

  // Show overlay during the initial session check, and also while the protected
  // bundle is loading on a restored session (page reload / returning user) —
  // otherwise the dashboard would render as a black screen until injection
  // finishes. After a fresh key entry we skip the overlay and go straight in.
  const showOverlay = isLoading || (isAuthed && bundleLoading && !justValidatedRef.current && !bundleError);
  if (showOverlay) {
    return <IntroOverlay />;
  }

  return (
    <>
      {!isAuthed && <KeyEntryScreen onValidate={async (k: string) => { const ok = await validateKey(k); if (ok) justValidatedRef.current = true; return ok; }} error={error} />}
      {isAuthed && bundleError && (
        <div className="fixed inset-0 z-[9998] flex items-center justify-center px-6 text-center" style={{ background: '#0a0a14', color: '#ff7a7a' }}>
          <div className="text-sm">Failed to load app: {bundleError}</div>
        </div>
      )}
      <AdminPanel isOpen={adminOpen} onClose={() => setAdminOpen(false)} subAdminId={session?.sub_admin_id} />
    </>
  );
};

export default GateRoot;
