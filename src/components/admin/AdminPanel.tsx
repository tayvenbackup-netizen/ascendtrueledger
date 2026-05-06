import { useEffect, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Plus, Copy, Trash2, RefreshCw, Shield, Loader2 } from 'lucide-react';
import { getAuthState } from '@/lib/authState';

interface Key {
  id: string;
  key_value?: string;
  key_preview?: string;
  key_type: string;
  is_active: boolean;
  expires_at: string | null;
  created_at: string;
  notes?: string | null;
}

const API = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/validate-key`;

async function api(action: string, body: Record<string, any> = {}) {
  const auth = getAuthState();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
  };
  if (auth.csrfToken) headers['x-csrf-token'] = auth.csrfToken;
  const res = await fetch(API, {
    method: 'POST',
    credentials: 'include',
    headers,
    body: JSON.stringify({ action, session_token: auth.sessionToken, ...body }),
  });
  return res.json();
}

interface Props { open: boolean; onClose: () => void; }

const AdminPanel = ({ open, onClose }: Props) => {
  const [keys, setKeys] = useState<Key[]>([]);
  const [loading, setLoading] = useState(false);
  const [newType, setNewType] = useState<'daily' | '3day' | 'weekly' | 'monthly' | 'lifetime'>('weekly');
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api('admin_list_keys');
      if (Array.isArray(data?.keys)) setKeys(data.keys);
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => { if (open) load(); }, [open, load]);

  const create = async () => {
    setCreating(true);
    try {
      const data = await api('admin_create_key', { key_type: newType });
      if (data?.key) await load();
    } catch {}
    setCreating(false);
  };

  const revoke = async (id: string) => {
    if (!confirm('Revoke this key?')) return;
    await api('admin_revoke_key', { key_id: id });
    load();
  };

  const copy = (val?: string) => { if (val) navigator.clipboard?.writeText(val); };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="fixed inset-0 z-[9998] flex items-end sm:items-center justify-center"
          style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(6px)' }}
          onClick={onClose}
        >
          <motion.div
            initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 40, opacity: 0 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-t-3xl sm:rounded-3xl overflow-hidden"
            style={{ background: '#0f0d1a', border: '1px solid rgba(187,174,252,0.18)', maxHeight: '88vh' }}
          >
            <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
              <div className="flex items-center gap-2">
                <Shield className="w-5 h-5" style={{ color: '#bbaefc' }} />
                <h2 className="text-white font-bold text-lg">Admin Panel</h2>
              </div>
              <button onClick={onClose} className="text-white/70"><X className="w-5 h-5" /></button>
            </div>

            <div className="px-5 py-4 flex items-center gap-2" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
              <select value={newType} onChange={(e) => setNewType(e.target.value as any)}
                className="flex-1 h-10 rounded-lg px-3 text-sm text-white"
                style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(187,174,252,0.2)' }}>
                <option value="daily">Daily</option>
                <option value="3day">3-Day</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
                <option value="lifetime">Lifetime</option>
              </select>
              <button onClick={create} disabled={creating}
                className="h-10 px-4 rounded-lg text-white font-semibold text-sm flex items-center gap-2"
                style={{ background: 'linear-gradient(135deg,#6c5ce7,#8b6cf3)' }}>
                {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                Generate
              </button>
              <button onClick={load} className="h-10 w-10 rounded-lg flex items-center justify-center text-white/70" style={{ background: 'rgba(255,255,255,0.05)' }}>
                <RefreshCw className="w-4 h-4" />
              </button>
            </div>

            <div className="overflow-y-auto" style={{ maxHeight: '60vh' }}>
              {loading && <div className="p-6 text-center text-white/50 text-sm">Loading…</div>}
              {!loading && keys.length === 0 && <div className="p-6 text-center text-white/50 text-sm">No keys yet</div>}
              {keys.map((k) => (
                <div key={k.id} className="px-5 py-3 flex items-center gap-3" style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-white text-sm font-mono truncate">{k.key_value || k.key_preview || '••••'}</span>
                      {k.key_value && (
                        <button onClick={() => copy(k.key_value)} className="text-white/50 hover:text-white">
                          <Copy className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                    <div className="text-[11px] text-white/50 mt-0.5">
                      {k.key_type} · {k.is_active ? 'active' : 'revoked'}
                      {k.expires_at && ` · expires ${new Date(k.expires_at).toLocaleDateString()}`}
                    </div>
                  </div>
                  {k.is_active && (
                    <button onClick={() => revoke(k.id)} className="p-2 rounded-lg" style={{ color: '#ff7a7a', background: 'rgba(255,122,122,0.08)' }}>
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default AdminPanel;
