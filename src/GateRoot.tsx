import { useEffect, useState } from 'react';
import KeyEntryScreen from './components/shell/KeyEntryScreen';
import AdminPanel from './components/admin/AdminPanel';
import { useAccessControl } from './hooks/useAccessControl';

const GateRoot = () => {
  const { isAuthed, isLoading, validateKey, error } = useAccessControl();
  const [adminOpen, setAdminOpen] = useState(false);

  useEffect(() => {
    document.body.dataset.authed = isAuthed ? '1' : '0';
    window.dispatchEvent(new CustomEvent('ascend:auth-changed', { detail: { authed: isAuthed } }));
  }, [isAuthed]);

  useEffect(() => {
    const open = () => setAdminOpen(true);
    window.addEventListener('ascend:open-admin', open);
    return () => window.removeEventListener('ascend:open-admin', open);
  }, []);

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
      <AdminPanel open={adminOpen} onClose={() => setAdminOpen(false)} />
    </>
  );
};

export default GateRoot;
