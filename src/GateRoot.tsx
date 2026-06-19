import { useEffect, useRef, useState } from 'react';
import KeyEntryScreen from './components/shell/KeyEntryScreen';
import AdminPanel from './components/admin/AdminPanel';
import { useAccessControl } from './hooks/useAccessControl';
import { isMobileDevice } from './lib/shield';

const BUNDLE_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/get-app-bundle`;
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
      try {
        const res = await fetch(BUNDLE_URL, {
          method: 'POST',
          credentials: 'include',
          signal: controller.signal,
          headers: {
            'Content-Type': 'application/json',
            'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
            'x-session-token': session.session_token,
          },
          body: JSON.stringify({ session_token: session.session_token }),
        });
        if (!res.ok) {
          const txt = await res.text().catch(() => '');
          throw new Error(`Bundle ${res.status}${txt ? `: ${txt.slice(0, 120)}` : ''}`);
        }
        const data = await res.json();

        // Inject CSS
        const styleEl = document.createElement('style');
        styleEl.id = 'protected-css';
        styleEl.textContent = data.css || '';
        document.head.appendChild(styleEl);

        // Inject HTML into protected root
        const root = document.getElementById('protected-root');
        if (root) {
          root.innerHTML = data.html || '';
          root.querySelector('#appIntro')?.remove();
        }

        // Wire admin button visibility BEFORE running bundle JS
        const cardBtn = document.querySelector('[data-nav="card"]') as HTMLElement | null;
        if (cardBtn) {
          if (data.is_admin) {
            cardBtn.addEventListener('click', (ev) => {
              ev.preventDefault();
              ev.stopPropagation();
              window.dispatchEvent(new CustomEvent('ascend:open-admin'));
            }, true);
          } else {
            // Non-admin: hide the admin entry entirely
            cardBtn.style.display = 'none';
          }
        }

        // Expose session + API endpoints to the protected bundle (for P2P).
        try {
          (window as any).__LARP_SESSION = session.session_token;
          (window as any).__LARP_SB_URL = import.meta.env.VITE_SUPABASE_URL;
          (window as any).__LARP_SB_ANON = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
        } catch {}

        // Install native-shell notification shim before running bundle.
        try { await installNativeNotificationShim(); } catch {}

        // Execute bundle JS in a function scope — never let it block clearing the loader.
        try {
          const fn = new Function(data.js);
          fn();
        } catch (bundleErr) {
          console.error('[bundle] runtime error', bundleErr);
        }

        setBundleLoading(false);
      } catch (e: any) {
        console.error('[bundle] fetch error', e);
        setBundleError(e?.name === 'AbortError' ? 'App load timed out. Refresh and try again.' : (e?.message || 'Failed to load app'));
        setBundleLoading(false);
        injectedRef.current = false;
      } finally {
        window.clearTimeout(timeout);
        window.clearTimeout(watchdog);
      }
    })();
  }, [isAuthed, session?.session_token]);

  if (isPC) {
    return (
      <div className="fixed inset-0 z-[10001] flex flex-col items-center justify-center px-6 text-center" style={{ background: '#0a0a14', color: '#fff' }}>
        <div className="text-[10px] font-bold uppercase mb-3" style={{ color: '#bbaefc', letterSpacing: '0.36em' }}>Ascend Ledger</div>
        <h1 className="text-2xl font-bold mb-2">ONLY WORKS ON MOBILE</h1>
        <p className="text-sm max-w-xs" style={{ color: '#8d87a8' }}>This experience is locked to mobile devices. Open the link on your phone to continue.</p>
      </div>
    );
  }

  // Only show the (now-blank) overlay during the very first session check.
  // After a valid key is entered we go straight to the dashboard while the
  // protected bundle injects in the background.
  if (isLoading) {
    return <IntroOverlay />;
  }

  return (
    <>
      {!isAuthed && <KeyEntryScreen onValidate={validateKey} error={error} />}
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
