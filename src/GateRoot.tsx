import { useEffect, useState } from 'react';
import KeyEntryScreen from './components/shell/KeyEntryScreen';
import AdminPanel from './components/admin/AdminPanel';
import { useAccessControl } from './hooks/useAccessControl';
import { isMobileDevice } from './lib/shield';

const GateRoot = () => {
  const { isAuthed, isLoading, validateKey, error } = useAccessControl();
  const [adminOpen, setAdminOpen] = useState(false);
  const [isPC, setIsPC] = useState(() => {
    try {
      const h = location.hostname;
      if (h.includes('lovable.app') || h.includes('lovableproject.com') || h.includes('lovable.dev') || h === 'localhost') return false;
    } catch {}
    return !isMobileDevice();
  });

  useEffect(() => {
    document.body.dataset.authed = isAuthed ? '1' : '0';
    window.dispatchEvent(new CustomEvent('ascend:auth-changed', { detail: { authed: isAuthed } }));
  }, [isAuthed]);

  useEffect(() => {
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

  if (isPC) {
    return (
      <div className="fixed inset-0 z-[10001] flex flex-col items-center justify-center px-6 text-center" style={{ background: '#0a0a14', color: '#fff' }}>
        <div className="text-[10px] font-bold uppercase mb-3" style={{ color: '#bbaefc', letterSpacing: '0.36em' }}>Ascend Ledger</div>
        <h1 className="text-2xl font-bold mb-2">ONLY WORKS ON MOBILE</h1>
        <p className="text-sm max-w-xs" style={{ color: '#8d87a8' }}>This experience is locked to mobile devices. Open the link on your phone to continue.</p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="fixed inset-0 z-[9999] flex items-center justify-center" style={{ background: '#0a0a14', color: '#bbaefc' }}>
        <div className="text-xs uppercase tracking-[0.3em]">Ascend Ledger</div>
      </div>
    );
  }

  return (
    <>
      {!isAuthed && <KeyEntryScreen onValidate={validateKey} error={error} />}
      <AdminPanel isOpen={adminOpen} onClose={() => setAdminOpen(false)} />
    </>
  );
};

export default GateRoot;
