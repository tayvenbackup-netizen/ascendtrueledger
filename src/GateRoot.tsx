import { useEffect, useState } from 'react';
import KeyEntryScreen from './components/shell/KeyEntryScreen';
import AdminPanel from './components/admin/AdminPanel';
import { useAccessControl } from './hooks/useAccessControl';

const GateRoot = () => {
  const { isAuthed, isAdmin, isLoading, validateKey, error } = useAccessControl();
  const [adminOpen, setAdminOpen] = useState(false);

  useEffect(() => {
    document.body.dataset.authed = isAuthed ? '1' : '0';
    document.body.dataset.admin = isAdmin ? '1' : '0';
    window.dispatchEvent(new CustomEvent('ascend:auth-changed', { detail: { authed: isAuthed, admin: isAdmin } }));
  }, [isAuthed, isAdmin]);

  useEffect(() => {
    const open = () => { if (isAdmin) setAdminOpen(true); else alert('Admin access required'); };
    window.addEventListener('ascend:open-admin', open);
    return () => window.removeEventListener('ascend:open-admin', open);
  }, [isAdmin]);

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
