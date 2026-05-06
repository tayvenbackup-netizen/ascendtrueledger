import { useEffect, useState, useCallback } from 'react';
import { ScrollText, RefreshCw, Loader2, Shield, ShieldAlert, KeyRound, LogIn, Pencil, Ban, Trash2, RotateCcw } from 'lucide-react';

interface AuditEntry {
  id: string;
  created_at: string;
  actor_type: 'master' | 'sub_admin';
  actor_id: string | null;
  actor_label: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  target_label: string | null;
  metadata: Record<string, unknown>;
  ip_address: string | null;
  success: boolean;
}

interface Props {
  callApi: (action: string, body?: Record<string, unknown>) => Promise<any>;
}

const FILTERS: { id: string; label: string }[] = [
  { id: '', label: 'All' },
  { id: 'admin_login', label: 'Logins' },
  { id: 'key_created', label: 'Created' },
  { id: 'key_revoked', label: 'Revoked' },
  { id: 'key_deleted', label: 'Deleted' },
];

const ACTION_META: Record<string, { label: string; icon: typeof KeyRound; color: string }> = {
  admin_login:        { label: 'Admin login',     icon: LogIn,     color: '#00e701' },
  admin_login_failed: { label: 'Failed login',    icon: ShieldAlert, color: '#ff4444' },
  key_created:        { label: 'Key created',     icon: KeyRound,  color: '#1475e1' },
  key_renamed:        { label: 'Key renamed',     icon: Pencil,    color: '#b1bad3' },
  key_revoked:        { label: 'Key revoked',     icon: Ban,       color: '#f5a623' },
  key_deleted:        { label: 'Key deleted',     icon: Trash2,    color: '#ff4444' },
  key_refreshed:      { label: 'Key refreshed',   icon: RotateCcw, color: '#1475e1' },
};

const formatTime = (iso: string) => {
  const d = new Date(iso);
  const diffSec = Math.floor((Date.now() - d.getTime()) / 1000);
  if (diffSec < 60) return `${diffSec}s ago`;
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  return d.toLocaleDateString();
};

const AdminAuditLog = ({ callApi }: Props) => {
  const [logs, setLogs] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<string>('');

  const load = useCallback(async (f: string) => {
    setLoading(true);
    try {
      const res = await callApi('list_audit_log', { limit: 200, filter_action: f || undefined });
      setLogs(res?.logs || []);
    } catch {}
    setLoading(false);
  }, [callApi]);

  useEffect(() => { load(filter); }, [filter, load]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <ScrollText className="w-3.5 h-3.5 text-[#1475e1]" />
          <span className="text-white text-xs font-bold">Audit log</span>
        </div>
        <button onClick={() => load(filter)} disabled={loading} className="w-8 h-8 rounded-lg bg-[#0f212e] flex items-center justify-center text-[#557086] hover:text-white hover:bg-[#2f4553] transition-all">
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <div className="flex gap-1 overflow-x-auto pb-1 scrollbar-none">
        {FILTERS.map(f => (
          <button key={f.id} onClick={() => setFilter(f.id)} className={`shrink-0 px-2.5 py-1 rounded-md text-[10px] font-bold transition-all ${filter === f.id ? 'bg-[#1475e1] text-white' : 'bg-[#0f212e] text-[#557086] hover:text-white'}`}>
            {f.label}
          </button>
        ))}
      </div>

      {loading && logs.length === 0 ? (
        <div className="flex items-center justify-center py-10"><Loader2 className="w-5 h-5 text-[#1475e1] animate-spin" /></div>
      ) : logs.length === 0 ? (
        <p className="text-[#557086] text-[11px] text-center py-10">No log entries yet.</p>
      ) : (
        <div className="space-y-1.5 max-h-[420px] overflow-y-auto pr-1">
          {logs.map(log => {
            const meta = ACTION_META[log.action] || { label: log.action, icon: ScrollText, color: '#557086' };
            const Icon = meta.icon;
            const failed = !log.success;
            return (
              <div key={log.id} className={`flex items-start gap-2.5 bg-[#0f212e] rounded-lg p-2.5 border ${failed ? 'border-[#ff4444]/30' : 'border-[#2f4553]/40'}`}>
                <div className="w-7 h-7 shrink-0 rounded-md flex items-center justify-center" style={{ background: `${meta.color}20` }}>
                  <Icon className="w-3.5 h-3.5" style={{ color: meta.color }} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-white text-[11px] font-bold truncate">{meta.label}{failed && ' (failed)'}</span>
                    <span className="text-[#557086] text-[9px] shrink-0">{formatTime(log.created_at)}</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-[10px] text-[#557086] mt-0.5">
                    {log.actor_type === 'master' ? <Shield className="w-3 h-3 text-[#1475e1]" /> : <ShieldAlert className="w-3 h-3 text-[#f5a623]" />}
                    <span className="truncate">{log.actor_label || (log.actor_type === 'master' ? 'master' : 'sub-admin')}</span>
                    {log.target_label && (<><span>·</span><span className="text-[#b1bad3] truncate">{log.target_label}</span></>)}
                  </div>
                  {log.ip_address && (<p className="text-[#557086] text-[9px] mt-0.5 font-mono truncate">{log.ip_address}</p>)}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default AdminAuditLog;