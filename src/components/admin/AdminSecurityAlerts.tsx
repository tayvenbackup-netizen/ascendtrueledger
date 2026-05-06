import { useEffect, useState, useCallback } from 'react';
import { ShieldAlert, RefreshCw, Loader2, MapPin, Smartphone, Check, Ban } from 'lucide-react';

interface AlertEntry {
  id: string;
  key_id: string;
  created_at: string;
  attempt_country: string | null;
  attempt_region: string | null;
  attempt_city: string | null;
  attempt_ip: string | null;
  device_fingerprint: string | null;
  device_info: string | null;
  reason: string;
  blocked: boolean;
  reviewed: boolean;
  access_keys: { key_preview: string | null; key_name: string | null; activation_country: string | null; activation_region: string | null; activation_city: string | null; } | null;
}

interface Props {
  callApi: (action: string, body?: Record<string, unknown>) => Promise<any>;
  onRevokeKey: (keyId: string) => Promise<void> | void;
}

const formatTime = (iso: string) => {
  const d = new Date(iso);
  const diffSec = Math.floor((Date.now() - d.getTime()) / 1000);
  if (diffSec < 60) return `${diffSec}s ago`;
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  return d.toLocaleDateString();
};

const formatLoc = (city: string | null, region: string | null, country: string | null) => {
  const parts = [city, region, country].filter(Boolean);
  return parts.length ? parts.join(', ') : 'Unknown';
};

const AdminSecurityAlerts = ({ callApi, onRevokeKey }: Props) => {
  const [alerts, setAlerts] = useState<AlertEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [onlyUnreviewed, setOnlyUnreviewed] = useState(true);

  const load = useCallback(async (unreviewed: boolean) => {
    setLoading(true);
    try {
      const res = await callApi('list_security_alerts', { limit: 200, only_unreviewed: unreviewed });
      setAlerts(res?.alerts || []);
    } catch {}
    setLoading(false);
  }, [callApi]);

  useEffect(() => { load(onlyUnreviewed); }, [onlyUnreviewed, load]);

  const markReviewed = async (id: string) => {
    await callApi('mark_alert_reviewed', { alert_id: id });
    load(onlyUnreviewed);
  };

  const revokeAndReview = async (alert: AlertEntry) => {
    if (!confirm(`Revoke key "${alert.access_keys?.key_name || alert.access_keys?.key_preview || 'this key'}"?`)) return;
    await onRevokeKey(alert.key_id);
    await markReviewed(alert.id);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <ShieldAlert className="w-3.5 h-3.5 text-[#ff4444]" />
          <span className="text-white text-xs font-bold">Security alerts</span>
        </div>
        <button onClick={() => load(onlyUnreviewed)} disabled={loading} className="w-8 h-8 rounded-lg bg-[#0f212e] flex items-center justify-center text-[#557086] hover:text-white hover:bg-[#2f4553] transition-all">
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <div className="flex gap-1 bg-[#0f212e] rounded-lg p-1">
        <button onClick={() => setOnlyUnreviewed(true)} className={`flex-1 py-1.5 rounded-md text-[10px] font-bold transition-all ${onlyUnreviewed ? 'bg-[#ff4444] text-white' : 'text-[#557086]'}`}>Unreviewed</button>
        <button onClick={() => setOnlyUnreviewed(false)} className={`flex-1 py-1.5 rounded-md text-[10px] font-bold transition-all ${!onlyUnreviewed ? 'bg-[#1475e1] text-white' : 'text-[#557086]'}`}>All</button>
      </div>

      {loading && alerts.length === 0 ? (
        <div className="flex items-center justify-center py-10"><Loader2 className="w-5 h-5 text-[#1475e1] animate-spin" /></div>
      ) : alerts.length === 0 ? (
        <div className="text-center py-10">
          <ShieldAlert className="w-8 h-8 text-[#2f4553] mx-auto mb-2" />
          <p className="text-[#557086] text-[11px]">{onlyUnreviewed ? 'No new alerts. All clear.' : 'No alerts recorded.'}</p>
        </div>
      ) : (
        <div className="space-y-2 max-h-[480px] overflow-y-auto pr-1">
          {alerts.map(alert => {
            const keyLabel = alert.access_keys?.key_name || alert.access_keys?.key_preview || 'Unknown key';
            const activatedAt = formatLoc(alert.access_keys?.activation_city || null, alert.access_keys?.activation_region || null, alert.access_keys?.activation_country || null);
            const attemptedAt = formatLoc(alert.attempt_city, alert.attempt_region, alert.attempt_country);
            return (
              <div key={alert.id} className={`bg-[#0f212e] rounded-xl p-3 border ${alert.reviewed ? 'border-[#2f4553]/40' : 'border-[#ff4444]/40'}`}>
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="w-7 h-7 shrink-0 rounded-md bg-[#ff4444]/15 flex items-center justify-center"><ShieldAlert className="w-3.5 h-3.5 text-[#ff4444]" /></div>
                    <div className="min-w-0">
                      <p className="text-white text-[11px] font-bold truncate">{keyLabel}</p>
                      <p className="text-[#557086] text-[9px]">{formatTime(alert.created_at)}</p>
                    </div>
                  </div>
                  {alert.reviewed && (<span className="shrink-0 text-[9px] font-bold uppercase px-1.5 py-[2px] rounded bg-[#557086]/15 text-[#557086] border border-[#557086]/30">Reviewed</span>)}
                </div>
                <div className="grid grid-cols-2 gap-2 mb-2">
                  <div className="bg-[#1a2c38] rounded-lg p-2">
                    <p className="text-[#557086] text-[9px] font-bold mb-0.5 flex items-center gap-1"><MapPin className="w-2.5 h-2.5" /> Activated in</p>
                    <p className="text-[#00e701] text-[10px] font-bold truncate">{activatedAt}</p>
                  </div>
                  <div className="bg-[#1a2c38] rounded-lg p-2">
                    <p className="text-[#557086] text-[9px] font-bold mb-0.5 flex items-center gap-1"><MapPin className="w-2.5 h-2.5" /> Attempted from</p>
                    <p className="text-[#ff4444] text-[10px] font-bold truncate">{attemptedAt}</p>
                  </div>
                </div>
                {alert.attempt_ip && (<p className="text-[#b1bad3] text-[10px] font-mono truncate"><span className="text-[#557086]">IP: </span>{alert.attempt_ip}</p>)}
                {alert.device_info && (<p className="text-[#b1bad3] text-[10px] truncate flex items-center gap-1"><Smartphone className="w-2.5 h-2.5 text-[#557086]" /><span className="truncate">{alert.device_info}</span></p>)}
                {!alert.reviewed && (
                  <div className="flex gap-1.5 mt-2">
                    <button onClick={() => markReviewed(alert.id)} className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-md bg-[#1a2c38] hover:bg-[#2f4553] text-[#b1bad3] text-[10px] font-bold transition-colors"><Check className="w-3 h-3" />Mark reviewed</button>
                    <button onClick={() => revokeAndReview(alert)} className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-md bg-[#ff4444]/15 hover:bg-[#ff4444]/25 text-[#ff4444] text-[10px] font-bold transition-colors"><Ban className="w-3 h-3" />Revoke key</button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default AdminSecurityAlerts;