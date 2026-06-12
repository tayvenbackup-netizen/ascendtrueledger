import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
  X, Shield, ShieldAlert, Loader2, Key, Plus, Copy, Check, Ban, Trash2,
  RefreshCw, ToggleLeft, ToggleRight, ScrollText, UserPlus, Edit3, Crown,
  MapPin, Smartphone, Globe, ChevronDown, ChevronUp, Search, Store, Package,
} from 'lucide-react';
import AdminAuditLog from './AdminAuditLog';
import AdminSecurityAlerts from './AdminSecurityAlerts';

interface AdminPanelProps {
  isOpen: boolean;
  onClose: () => void;
  subAdminId?: string;
}

interface KeyRecord {
  id: string;
  key_preview: string;
  key_type: string;
  activated_at: string | null;
  expires_at: string | null;
  is_revoked: boolean;
  created_at: string;
  key_name: string | null;
  key_value: string | null;
  device_count?: number;
  device_fingerprint?: string | null;
  session_count?: number;
  total_play_seconds?: number;
  activation_country?: string | null;
  activation_region?: string | null;
  activation_city?: string | null;
  activation_ip?: string | null;
}

interface SubAdminRecord {
  id: string;
  key_name: string | null;
  key_preview: string;
  key_value?: string | null;
  is_revoked: boolean;
  created_at: string;
  device_fingerprint?: string | null;
  activation_country?: string | null;
  activation_region?: string | null;
  activation_city?: string | null;
  keys_created?: number;
  active_keys?: number;
}

const API_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/validate-key`;
const ADMIN_TOKEN_KEY = '__ascend_admin_tok';
const ADMIN_CSRF_KEY = '__ascend_admin_csrf';

let inMemoryCsrf: string | null = sessionStorage.getItem(ADMIN_CSRF_KEY);
let inMemoryAdminTok: string | null = sessionStorage.getItem(ADMIN_TOKEN_KEY);

function setAdminAuth(adminToken: string | null, csrf: string | null) {
  inMemoryAdminTok = adminToken;
  inMemoryCsrf = csrf;
  if (adminToken) sessionStorage.setItem(ADMIN_TOKEN_KEY, adminToken);
  else sessionStorage.removeItem(ADMIN_TOKEN_KEY);
  if (csrf) sessionStorage.setItem(ADMIN_CSRF_KEY, csrf);
  else sessionStorage.removeItem(ADMIN_CSRF_KEY);
}

async function adminApiFetch(body: Record<string, unknown>, csrf?: string | null, adminTok?: string | null) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
  };
  if (csrf) headers['x-csrf-token'] = csrf;
  if (adminTok) headers['x-admin-token'] = adminTok;
  const res = await fetch(API_URL, {
    method: 'POST', credentials: 'include', headers, body: JSON.stringify(body),
  });
  return res.json();
}

async function adminApi(action: string, body: Record<string, unknown> = {}) {
  const data = await adminApiFetch({ action, ...body }, inMemoryCsrf, inMemoryAdminTok);
  if (data?.error) throw new Error(data.error);
  return data;
}

type AdminTab = 'keys' | 'admins' | 'reseller' | 'audit' | 'alerts' | 'settings';
type KeyType = 'daily' | '3day' | 'weekly' | 'monthly' | 'lifetime';

// Ascend Ledger brand palette
const C = {
  bg: '#0a0a14',
  surface: '#15131f',
  surfaceAlt: '#1f1b30',
  border: 'rgba(187,174,252,0.18)',
  borderSoft: 'rgba(187,174,252,0.10)',
  text: '#ffffff',
  textMuted: '#cfc8e8',
  textDim: '#8d87a8',
  accent: '#bbaefc',
  accentHover: '#a99cf0',
  accentSoft: 'rgba(187,174,252,0.12)',
  green: '#5dd49a',
  greenDark: '#3aa776',
  yellow: '#f5c25b',
  red: '#ff7a7a',
};

const AdminPanel = ({ isOpen, onClose, subAdminId }: AdminPanelProps) => {
  const [authed, setAuthed] = useState(false);
  const [isMaster, setIsMaster] = useState(false);
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState('');
  const [keys, setKeys] = useState<KeyRecord[]>([]);
  const [admins, setAdmins] = useState<SubAdminRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<AdminTab>('keys');

  // Generate-key form
  const [genType, setGenType] = useState<KeyType>('weekly');
  const [genName, setGenName] = useState('');
  const [genCustom, setGenCustom] = useState('');
  const [genMode, setGenMode] = useState<'auto' | 'custom'>('auto');
  const [generatedKey, setGeneratedKey] = useState('');
  const [generating, setGenerating] = useState(false);
  const [copied, setCopied] = useState<string>('');
  const [genError, setGenError] = useState('');

  // Admin key form
  const [adminName, setAdminName] = useState('');
  const [adminCustom, setAdminCustom] = useState('');
  const [createdAdmin, setCreatedAdmin] = useState('');
  const [creatingAdmin, setCreatingAdmin] = useState(false);
  const [adminError, setAdminError] = useState('');

  // Rename
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  // Expanded key (for device/location details)
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  // Search
  const [searchQuery, setSearchQuery] = useState('');

  // Reseller tab state
  const [resellerName, setResellerName] = useState('');
  const [bulkCount, setBulkCount] = useState('10');
  const [bulkType, setBulkType] = useState<KeyType>('weekly');
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkError, setBulkError] = useState('');
  const [bulkGenerated, setBulkGenerated] = useState<string[]>([]);
  const [resellerGroups, setResellerGroups] = useState<any[]>([]);
  const [openReseller, setOpenReseller] = useState<string | null>(null);
  const [resellerKeys, setResellerKeys] = useState<Record<string, any[]>>({});

  const [bypassEnabled, setBypassEnabled] = useState(false);

  const authenticate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password.trim()) { setAuthError('Enter password'); return; }
    try {
      const data = await adminApiFetch({ action: 'admin_auth', admin_password: password.trim() });
      if (data?.error || !data?.success) throw new Error(data?.error || 'Wrong password');
      setAdminAuth(data.admin_token || null, data.csrf_token || null);
      setPassword(''); setAuthed(true); setIsMaster(!!data.is_master); setAuthError('');
      loadKeys(); loadBypass(); if (data.is_master) loadAdmins();
    } catch (err: any) {
      setAuthError(err?.message || 'Wrong password');
    }
  };

  const loadKeys = async () => {
    setLoading(true);
    try { const data = await adminApi('list_keys'); setKeys(data.keys || []); } catch {}
    setLoading(false);
  };

  const loadAdmins = async () => {
    try { const data = await adminApi('list_sub_admins'); setAdmins(data.admins || []); } catch {}
  };

  const loadBypass = async () => {
    try { const data = await adminApiFetch({ action: 'check_bypass' }); setBypassEnabled(data?.bypass === true); } catch {}
  };

  const generateKey = async () => {
    setGenerating(true); setGeneratedKey(''); setGenError('');
    try {
      let data;
      if (genMode === 'custom') {
        const trimmed = genCustom.trim();
        if (trimmed.length < 3) throw new Error('Custom key must be at least 3 characters');
        data = await adminApi('create_custom_key', {
          key_type: genType, key_name: genName.trim() || null, custom_key: trimmed,
        });
      } else {
        data = await adminApi('generate_key', {
          key_type: genType, key_name: genName.trim() || null,
        });
      }
      setGeneratedKey(data.key);
      setGenName(''); setGenCustom('');
      loadKeys();
    } catch (e: any) {
      setGenError(e?.message || 'Failed to create key');
    }
    setGenerating(false);
  };

  const createAdminKey = async () => {
    setCreatingAdmin(true); setCreatedAdmin(''); setAdminError('');
    try {
      const trimmed = adminCustom.trim();
      if (trimmed.length < 3) throw new Error('Admin key must be at least 3 characters');
      const data = await adminApi('create_sub_admin', {
        key_name: adminName.trim() || 'Sub-Admin', custom_key: trimmed,
      });
      setCreatedAdmin(data.key);
      setAdminName(''); setAdminCustom('');
      loadAdmins();
    } catch (e: any) {
      setAdminError(e?.message || 'Failed to create admin key');
    }
    setCreatingAdmin(false);
  };

  const revokeKey = async (id: string) => { await adminApi('revoke_key', { key_id: id }); loadKeys(); };
  const deleteKey = async (id: string) => { if (!confirm('Delete this key?')) return; await adminApi('delete_key', { key_id: id }); loadKeys(); };
  const revokeAdmin = async (id: string) => { if (!confirm('Revoke this admin key? They will lose access immediately.')) return; try { await adminApi('revoke_sub_admin', { key_id: id }); } catch (e: any) { alert(e?.message || 'Failed to revoke'); } loadAdmins(); };
  const refreshAdmin = async (id: string) => { if (!confirm('Reset this admin key\'s device binding? They can re-activate on a new device.')) return; try { await adminApi('refresh_sub_admin', { key_id: id }); } catch (e: any) { alert(e?.message || 'Failed to refresh'); } loadAdmins(); };
  const deleteAdmin = async (id: string) => { if (!confirm('PERMANENTLY delete this admin key? This cannot be undone. Keys they created will be kept (detached).')) return; try { await adminApi('delete_sub_admin', { key_id: id }); } catch (e: any) { alert(e?.message || 'Failed to delete'); } loadAdmins(); };
  const renameKey = async (id: string) => {
    if (!renameValue.trim()) { setRenameId(null); return; }
    try { await adminApi('rename_key', { key_id: id, key_name: renameValue.trim() }); } catch {}
    setRenameId(null); setRenameValue(''); loadKeys();
  };
  const toggleBypass = async () => { const v = !bypassEnabled; await adminApi('toggle_bypass', { bypass_enabled: v }); setBypassEnabled(v); };

  const refreshKey = async (id: string) => {
    if (!confirm('Reset this key\'s device binding? The user can re-activate on a new device.')) return;
    try { await adminApi('refresh_key', { key_id: id }); } catch (e: any) { alert(e?.message || 'Failed'); }
    loadKeys();
  };
  const refreshAllKeys = async () => {
    if (!confirm('Reset device binding for ALL active keys? Every user will have to re-activate.')) return;
    try { await adminApi('refresh_all_keys'); } catch (e: any) { alert(e?.message || 'Failed'); }
    loadKeys();
  };

  const loadResellerGroups = async () => {
    try {
      const data = await adminApi('list_groups');
      const all = (data.groups || []).filter((g: any) => (g.name || '').startsWith('Reseller: '));
      setResellerGroups(all);
    } catch {}
  };
  const loadResellerKeys = async (groupId: string) => {
    try {
      const data = await adminApi('list_bulk_keys', { group_id: groupId });
      setResellerKeys(prev => ({ ...prev, [groupId]: data.keys || [] }));
    } catch {}
  };
  const generateBulkKeys = async () => {
    setBulkBusy(true); setBulkError(''); setBulkGenerated([]);
    try {
      const data = await adminApi('generate_bulk_keys', {
        reseller_name: resellerName.trim(),
        count: Number(bulkCount),
        key_type: bulkType,
      });
      setBulkGenerated(data.keys || []);
      loadResellerGroups();
      if (data.group_id) loadResellerKeys(data.group_id);
    } catch (e: any) {
      setBulkError(e?.message || 'Failed to generate bulk keys');
    }
    setBulkBusy(false);
  };
  const deleteResellerGroup = async (groupId: string) => {
    if (!confirm('Delete this reseller and ALL its bulk keys? This cannot be undone.')) return;
    try { await adminApi('delete_bulk_group', { group_id: groupId }); } catch (e: any) { alert(e?.message || 'Failed'); }
    loadResellerGroups();
  };

  const copyToClipboard = (text: string, tag: string) => {
    navigator.clipboard.writeText(text);
    setCopied(tag);
    setTimeout(() => setCopied(''), 2000);
  };

  useEffect(() => {
    if (!isOpen) {
      setAuthed(false); setIsMaster(false); setPassword(''); setAuthError('');
      setGeneratedKey(''); setCreatedAdmin(''); setActiveTab('keys');
      if (inMemoryAdminTok) adminApiFetch({ action: 'admin_logout' }, inMemoryCsrf, inMemoryAdminTok).catch(() => {});
      setAdminAuth(null, null);
    } else if (subAdminId) {
      adminApiFetch({ action: 'sub_admin_auth', sub_admin_id: subAdminId }).then(data => {
        if (data?.success) {
          setAdminAuth(data.admin_token || null, data.csrf_token || null);
          setAuthed(true); setIsMaster(false); loadKeys();
        } else setAuthError(data?.error || 'Admin access revoked');
      }).catch(() => setAuthError('Failed to authenticate sub-admin'));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, subAdminId]);

  if (!isOpen) return null;

  const activeKeys = keys.filter(k => !k.is_revoked);
  const revokedKeys = keys.filter(k => k.is_revoked);

  const tabs: { id: AdminTab; label: string; icon: typeof Key; masterOnly?: boolean }[] = [
    { id: 'keys', label: 'Keys', icon: Key },
    { id: 'admins', label: 'Admins', icon: Crown, masterOnly: true },
    { id: 'reseller', label: 'Reseller', icon: Store, masterOnly: true },
    { id: 'audit', label: 'Audit', icon: ScrollText, masterOnly: true },
    { id: 'alerts', label: 'Alerts', icon: ShieldAlert, masterOnly: true },
    { id: 'settings', label: 'Settings', icon: Shield, masterOnly: true },
  ];
  const visibleTabs = tabs.filter(t => !t.masterOnly || isMaster);

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-[10000] flex items-start justify-center pt-6 px-3 overflow-y-auto"
      style={{ background: 'rgba(0,0,0,0.78)', backdropFilter: 'blur(6px)' }}
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.96, y: 8 }} animate={{ scale: 1, y: 0 }}
        onClick={e => e.stopPropagation()}
        className="w-full max-w-md rounded-2xl mb-8 overflow-hidden"
        style={{ background: C.surface, border: `1px solid ${C.border}`, boxShadow: '0 24px 60px rgba(0,0,0,0.55)' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-3.5 py-2.5 border-b" style={{ borderColor: C.border }}>
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center"
                 style={{ background: isMaster ? `${C.accent}25` : `${C.yellow}25` }}>
              {isMaster ? <Crown className="w-3.5 h-3.5" style={{ color: C.accent }} />
                        : <Shield className="w-3.5 h-3.5" style={{ color: C.yellow }} />}
            </div>
            <div>
              <span className="font-bold text-[12px] block leading-tight" style={{ color: C.text }}>
                {isMaster ? 'Master Admin' : authed ? 'Sub-Admin' : 'Admin Panel'}
              </span>
              <span className="text-[9px]" style={{ color: C.textDim }}>
                {isMaster ? 'Full access' : authed ? 'Restricted' : 'Auth required'}
              </span>
            </div>
          </div>
          <button onClick={onClose}
                  className="w-7 h-7 rounded-lg flex items-center justify-center transition-all hover:opacity-80"
                  style={{ background: C.bg, color: C.textDim }}>
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="p-3">
          {!authed ? (
            <form onSubmit={authenticate} className="space-y-2.5">
              <div className="rounded-lg p-3" style={{ background: C.bg, border: `1px solid ${C.border}` }}>
                <p className="text-[11px] mb-2" style={{ color: C.textMuted }}>Enter admin password</p>
                <input type="password" value={password} onChange={e => setPassword(e.target.value)}
                       placeholder="Password..." autoFocus
                       className="w-full h-9 px-3 rounded-md text-[12px] focus:outline-none transition-colors"
                       style={{ background: C.surface, border: `1px solid ${C.border}`, color: C.text }} />
                {authError && (<p className="text-[11px] mt-2" style={{ color: C.red }}>{authError}</p>)}
              </div>
              <button type="submit"
                      className="w-full h-9 rounded-lg text-[12px] font-bold transition-colors hover:opacity-90"
                      style={{ background: C.accent, color: C.text }}>
                Unlock
              </button>
            </form>
          ) : (
            <div className="space-y-2.5">
              {/* Tabs */}
              <div className="flex gap-0.5 rounded-lg p-0.5 overflow-x-auto"
                   style={{ background: C.bg }}>
                {visibleTabs.map(tab => (
                  <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                          className="shrink-0 flex items-center justify-center gap-1 px-2 py-1.5 rounded-md text-[10px] font-bold transition-all"
                          style={{
                            background: activeTab === tab.id ? C.surfaceAlt : 'transparent',
                            color: activeTab === tab.id ? C.text : C.textDim,
                          }}>
                    <tab.icon className="w-3 h-3" />{tab.label}
                  </button>
                ))}
              </div>

              {/* KEYS TAB */}
              {activeTab === 'keys' && (
                <div className="space-y-2.5">
                  <div className="rounded-lg p-3 space-y-2"
                       style={{ background: C.bg, border: `1px solid ${C.border}` }}>
                    <div className="flex items-center gap-2">
                      <Plus className="w-4 h-4" style={{ color: C.green }} />
                      <span className="text-xs font-bold" style={{ color: C.text }}>Create Key</span>
                    </div>

                    {/* Mode toggle */}
                    <div className="flex gap-1 p-1 rounded-lg" style={{ background: C.surface }}>
                      {(['auto', 'custom'] as const).map(m => (
                        <button key={m} onClick={() => setGenMode(m)}
                                className="flex-1 h-8 rounded-md text-[11px] font-bold transition-all"
                                style={{
                                  background: genMode === m ? C.accent : 'transparent',
                                  color: genMode === m ? C.text : C.textDim,
                                }}>
                          {m === 'auto' ? 'Auto-generate' : 'Custom name'}
                        </button>
                      ))}
                    </div>

                    <input type="text" value={genName} onChange={e => setGenName(e.target.value)}
                           placeholder="Label (optional, e.g. John's key)"
                           className="w-full h-9 px-3 rounded-lg text-xs focus:outline-none"
                           style={{ background: C.surface, border: `1px solid ${C.border}`, color: C.text }} />

                    {genMode === 'custom' && (
                      <input type="text" value={genCustom} onChange={e => setGenCustom(e.target.value)}
                             placeholder="Custom key value (e.g. JOHN-VIP-2026)"
                             className="w-full h-9 px-3 rounded-lg text-xs font-mono focus:outline-none"
                             style={{ background: C.surface, border: `1px solid ${C.border}`, color: C.text }} />
                    )}

                    <div className="flex gap-1 flex-wrap">
                      {(['daily', '3day', 'weekly', 'monthly', 'lifetime'] as const).map(t => (
                        <button key={t} onClick={() => setGenType(t)}
                                className="flex-1 min-w-[60px] h-9 rounded-lg text-[10px] font-bold transition-all"
                                style={{
                                  background: genType === t ? C.accent : C.surface,
                                  color: genType === t ? C.text : C.textDim,
                                  border: `1px solid ${genType === t ? C.accent : C.border}`,
                                }}>
                          {t === '3day' ? '3-Day' : t.charAt(0).toUpperCase() + t.slice(1)}
                        </button>
                      ))}
                    </div>

                    <button onClick={generateKey} disabled={generating}
                            className="w-full h-10 rounded-lg text-xs font-black flex items-center justify-center gap-2 disabled:opacity-50 transition-opacity"
                            style={{ background: C.green, color: C.bg }}>
                      {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Key className="w-4 h-4" />}
                      {genMode === 'custom' ? 'Create Custom Key' : 'Generate'}
                    </button>

                    {genError && (<p className="text-xs" style={{ color: C.red }}>{genError}</p>)}

                    {generatedKey && (
                      <div className="rounded-lg p-3" style={{ background: C.surface, border: `1px solid ${C.green}40` }}>
                        <div className="flex items-center justify-between mb-1.5">
                          <p className="text-[10px] font-bold" style={{ color: C.green }}>✓ Key Created</p>
                          <button onClick={() => copyToClipboard(generatedKey, 'gen')}
                                  className="flex items-center gap-1 px-2 py-1 rounded-md"
                                  style={{ background: `${C.green}15` }}>
                            {copied === 'gen' ? <Check className="w-3 h-3" style={{ color: C.green }} />
                                              : <Copy className="w-3 h-3" style={{ color: C.green }} />}
                            <span className="text-[10px] font-bold" style={{ color: C.green }}>
                              {copied === 'gen' ? 'Copied' : 'Copy'}
                            </span>
                          </button>
                        </div>
                        <code className="text-[11px] break-all font-mono block" style={{ color: '#4eff4e' }}>
                          {generatedKey}
                        </code>
                      </div>
                    )}
                  </div>

                  {/* Keys list */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between px-1">
                      <h3 className="text-[10px] font-bold uppercase tracking-widest" style={{ color: C.textMuted }}>
                        Keys ({keys.length})
                      </h3>
                      <div className="flex items-center gap-1">
                        {isMaster && (
                          <button onClick={refreshAllKeys} title="Reset device binding for ALL keys"
                                  className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-bold"
                                  style={{ background: `${C.yellow}15`, color: C.yellow }}>
                            <RefreshCw className="w-3 h-3" /> Refresh All
                          </button>
                        )}
                        <button onClick={loadKeys} disabled={loading} className="p-1" style={{ color: C.textDim }}>
                          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
                        </button>
                      </div>
                    </div>
                    <div className="relative">
                      <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: C.textDim }} />
                      <input type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                             placeholder="Search by name or key…"
                             className="w-full h-8 pl-8 pr-3 rounded-lg text-[11px] focus:outline-none"
                             style={{ background: C.bg, border: `1px solid ${C.border}`, color: C.text }} />
                    </div>
                    <div className="space-y-2 max-h-[340px] overflow-y-auto pr-0.5">
                      {[...activeKeys, ...revokedKeys].filter(k => {
                        const q = searchQuery.trim().toLowerCase();
                        if (!q) return true;
                        return (k.key_name || '').toLowerCase().includes(q)
                          || (k.key_value || '').toLowerCase().includes(q)
                          || (k.key_preview || '').toLowerCase().includes(q);
                      }).map(k => (
                        <div key={k.id} className="rounded-xl px-3.5 py-2.5"
                             style={{ background: C.bg, border: `1px solid ${k.is_revoked ? `${C.red}30` : C.border}` }}>
                          <div className="flex items-center gap-3">
                            <div className="w-7 h-7 rounded-lg flex items-center justify-center"
                                 style={{ background: k.is_revoked ? `${C.red}15` : `${C.accent}15` }}>
                              <Key className="w-3.5 h-3.5"
                                   style={{ color: k.is_revoked ? `${C.red}99` : C.accent }} />
                            </div>
                            <div className="flex-1 min-w-0">
                              {renameId === k.id ? (
                                <input value={renameValue}
                                       onChange={e => setRenameValue(e.target.value)}
                                       onBlur={() => renameKey(k.id)}
                                       onKeyDown={e => e.key === 'Enter' && renameKey(k.id)}
                                       autoFocus
                                       className="w-full h-7 px-2 rounded text-[11px]"
                                       style={{ background: C.surface, border: `1px solid ${C.accent}`, color: C.text }} />
                              ) : (
                                <p className="text-[11px] font-bold truncate" style={{ color: C.text }}>
                                  {k.key_name || `Key …${k.key_preview}`}
                                </p>
                              )}
                              <p className="text-[10px]" style={{ color: C.textDim }}>
                                {k.key_type} · {k.is_revoked ? 'Revoked' : k.activated_at ? 'Active' : 'Unused'}
                                {k.activated_at && k.device_fingerprint && (
                                  <> · <span style={{ color: C.green }}>1 device locked</span></>
                                )}
                              </p>
                            </div>
                            <button onClick={() => setExpandedKey(expandedKey === k.id ? null : k.id)}
                                    className="p-1.5 rounded-lg"
                                    style={{ background: `${C.textDim}15` }}>
                              {expandedKey === k.id
                                ? <ChevronUp className="w-3 h-3" style={{ color: C.textMuted }} />
                                : <ChevronDown className="w-3 h-3" style={{ color: C.textMuted }} />}
                            </button>
                            <button onClick={() => { setRenameId(k.id); setRenameValue(k.key_name || ''); }}
                                    className="p-1.5 rounded-lg"
                                    style={{ background: `${C.accent}15` }}>
                              <Edit3 className="w-3 h-3" style={{ color: C.accent }} />
                            </button>
                            {!k.is_revoked && (
                              <button onClick={() => refreshKey(k.id)} title="Reset device binding"
                                      className="p-1.5 rounded-lg"
                                      style={{ background: `${C.accent}15` }}>
                                <RefreshCw className="w-3 h-3" style={{ color: C.accent }} />
                              </button>
                            )}
                            {!k.is_revoked && (
                              <button onClick={() => revokeKey(k.id)} className="p-1.5 rounded-lg"
                                      style={{ background: `${C.yellow}15` }}>
                                <Ban className="w-3 h-3" style={{ color: C.yellow }} />
                              </button>
                            )}
                            <button onClick={() => deleteKey(k.id)} className="p-1.5 rounded-lg"
                                    style={{ background: `${C.red}15` }}>
                              <Trash2 className="w-3 h-3" style={{ color: C.red }} />
                            </button>
                          </div>
                          {k.key_value && (
                            <div className="flex items-center gap-2 mt-2">
                              <code className="text-[10px] font-mono break-all flex-1 select-all" style={{ color: '#4eff4e' }}>
                                {k.key_value}
                              </code>
                              <button onClick={() => copyToClipboard(k.key_value!, k.id)}
                                      className="shrink-0 p-1 rounded">
                                {copied === k.id ? <Check className="w-3 h-3" style={{ color: C.green }} />
                                                : <Copy className="w-3 h-3" style={{ color: C.textDim }} />}
                              </button>
                            </div>
                          )}
                          {expandedKey === k.id && (
                            <div className="mt-3 pt-3 space-y-2" style={{ borderTop: `1px solid ${C.border}` }}>
                              <div className="grid grid-cols-2 gap-2">
                                <div className="rounded-lg px-2.5 py-2" style={{ background: C.surface }}>
                                  <div className="flex items-center gap-1.5 mb-1">
                                    <Smartphone className="w-3 h-3" style={{ color: C.accent }} />
                                    <span className="text-[9px] font-bold uppercase tracking-wider" style={{ color: C.textDim }}>Device</span>
                                  </div>
                                  <p className="text-[10px] font-bold" style={{ color: C.text }}>
                                    {k.device_fingerprint ? '1 / 1 locked' : 'Not bound'}
                                  </p>
                                  {k.device_fingerprint && (
                                    <p className="text-[9px] font-mono truncate" style={{ color: C.textDim }} title={k.device_fingerprint}>
                                      {k.device_fingerprint.slice(0, 12)}…
                                    </p>
                                  )}
                                </div>
                                <div className="rounded-lg px-2.5 py-2" style={{ background: C.surface }}>
                                  <div className="flex items-center gap-1.5 mb-1">
                                    <MapPin className="w-3 h-3" style={{ color: C.accent }} />
                                    <span className="text-[9px] font-bold uppercase tracking-wider" style={{ color: C.textDim }}>Location</span>
                                  </div>
                                  <p className="text-[10px] font-bold" style={{ color: C.text }}>
                                    {k.activation_city || k.activation_region || k.activation_country || 'Unknown'}
                                  </p>
                                  <p className="text-[9px]" style={{ color: C.textDim }}>
                                    {[k.activation_region, k.activation_country].filter(Boolean).join(', ') || '—'}
                                  </p>
                                </div>
                                <div className="rounded-lg px-2.5 py-2" style={{ background: C.surface }}>
                                  <div className="flex items-center gap-1.5 mb-1">
                                    <Globe className="w-3 h-3" style={{ color: C.accent }} />
                                    <span className="text-[9px] font-bold uppercase tracking-wider" style={{ color: C.textDim }}>IP Address</span>
                                  </div>
                                  <p className="text-[10px] font-mono" style={{ color: C.text }}>
                                    {k.activation_ip || '—'}
                                  </p>
                                </div>
                                <div className="rounded-lg px-2.5 py-2" style={{ background: C.surface }}>
                                  <div className="flex items-center gap-1.5 mb-1">
                                    <Shield className="w-3 h-3" style={{ color: C.accent }} />
                                    <span className="text-[9px] font-bold uppercase tracking-wider" style={{ color: C.textDim }}>Sessions</span>
                                  </div>
                                  <p className="text-[10px] font-bold" style={{ color: C.text }}>
                                    {k.session_count ?? 0} logins
                                  </p>
                                  <p className="text-[9px]" style={{ color: C.textDim }}>
                                    {Math.floor((k.total_play_seconds ?? 0) / 60)} min total
                                  </p>
                                </div>
                              </div>
                              {k.activated_at && (
                                <p className="text-[9px] text-center" style={{ color: C.textDim }}>
                                  Activated {new Date(k.activated_at).toLocaleString()}
                                  {k.expires_at && <> · Expires {new Date(k.expires_at).toLocaleDateString()}</>}
                                </p>
                              )}
                            </div>
                          )}
                        </div>
                      ))}
                      {keys.length === 0 && !loading && (
                        <p className="text-xs text-center py-6" style={{ color: C.textDim }}>No keys yet</p>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* ADMINS TAB (master only) */}
              {activeTab === 'admins' && isMaster && (
                <div className="space-y-4">
                  <div className="rounded-xl p-4 space-y-3"
                       style={{ background: C.bg, border: `1px solid ${C.border}` }}>
                    <div className="flex items-center gap-2">
                      <UserPlus className="w-4 h-4" style={{ color: C.accent }} />
                      <span className="text-xs font-bold" style={{ color: C.text }}>Create Admin Key</span>
                    </div>
                    <p className="text-[10px]" style={{ color: C.textDim }}>
                      Admin keys grant access to the panel (manage keys only — no master settings).
                    </p>
                    <input type="text" value={adminName} onChange={e => setAdminName(e.target.value)}
                           placeholder="Admin name (e.g. Mike)"
                           className="w-full h-9 px-3 rounded-lg text-xs focus:outline-none"
                           style={{ background: C.surface, border: `1px solid ${C.border}`, color: C.text }} />
                    <input type="text" value={adminCustom} onChange={e => setAdminCustom(e.target.value)}
                           placeholder="Admin key value (e.g. MIKE-ADMIN-2026)"
                           className="w-full h-9 px-3 rounded-lg text-xs font-mono focus:outline-none"
                           style={{ background: C.surface, border: `1px solid ${C.border}`, color: C.text }} />
                    <button onClick={createAdminKey} disabled={creatingAdmin}
                            className="w-full h-10 rounded-lg text-xs font-black flex items-center justify-center gap-2 disabled:opacity-50"
                            style={{ background: C.accent, color: C.text }}>
                      {creatingAdmin ? <Loader2 className="w-4 h-4 animate-spin" /> : <Crown className="w-4 h-4" />}
                      Create Admin Key
                    </button>
                    {adminError && (<p className="text-xs" style={{ color: C.red }}>{adminError}</p>)}
                    {createdAdmin && (
                      <div className="rounded-lg p-3" style={{ background: C.surface, border: `1px solid ${C.accent}40` }}>
                        <div className="flex items-center justify-between mb-1.5">
                          <p className="text-[10px] font-bold" style={{ color: C.accent }}>✓ Admin Key Created</p>
                          <button onClick={() => copyToClipboard(createdAdmin, 'admin')}
                                  className="flex items-center gap-1 px-2 py-1 rounded-md"
                                  style={{ background: `${C.accent}15` }}>
                            {copied === 'admin' ? <Check className="w-3 h-3" style={{ color: C.accent }} />
                                                : <Copy className="w-3 h-3" style={{ color: C.accent }} />}
                            <span className="text-[10px] font-bold" style={{ color: C.accent }}>
                              {copied === 'admin' ? 'Copied' : 'Copy'}
                            </span>
                          </button>
                        </div>
                        <code className="text-[11px] break-all font-mono block" style={{ color: '#7cc1ff' }}>
                          {createdAdmin}
                        </code>
                      </div>
                    )}
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between px-1">
                      <h3 className="text-[10px] font-bold uppercase tracking-widest" style={{ color: C.textMuted }}>
                        Admin Keys ({admins.length})
                      </h3>
                      <button onClick={loadAdmins} className="p-1" style={{ color: C.textDim }}>
                        <RefreshCw className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <div className="space-y-2 max-h-[300px] overflow-y-auto pr-0.5">
                      {admins.map(a => (
                        <div key={a.id} className="rounded-xl px-3.5 py-2.5"
                             style={{ background: C.bg, border: `1px solid ${a.is_revoked ? `${C.red}30` : C.border}` }}>
                          <div className="flex items-center gap-3">
                            <div className="w-7 h-7 rounded-lg flex items-center justify-center"
                                 style={{ background: a.is_revoked ? `${C.red}15` : `${C.accent}15` }}>
                              <Crown className="w-3.5 h-3.5"
                                     style={{ color: a.is_revoked ? `${C.red}99` : C.accent }} />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-[11px] font-bold truncate" style={{ color: C.text }}>
                                {a.key_name || `Admin …${a.key_preview}`}
                              </p>
                              <p className="text-[10px]" style={{ color: C.textDim }}>
                                {a.is_revoked ? 'Revoked' : 'Active'}
                                {a.device_fingerprint ? ' · Device locked' : ' · No device'}
                                {typeof a.keys_created === 'number' ? ` · ${a.keys_created} key${a.keys_created === 1 ? '' : 's'}` : ''}
                              </p>
                              {a.device_fingerprint && (
                                <p className="text-[9px] font-mono truncate" style={{ color: C.textDim }} title={a.device_fingerprint}>
                                  {a.device_fingerprint.slice(0, 14)}…
                                </p>
                              )}
                            </div>
                            {isMaster && (
                              <div className="flex items-center gap-1 shrink-0">
                                {!a.is_revoked && (
                                  <button onClick={() => refreshAdmin(a.id)} className="p-1.5 rounded-lg" title="Reset device binding"
                                          style={{ background: `${C.accent}15` }}>
                                    <RefreshCw className="w-3 h-3" style={{ color: C.accent }} />
                                  </button>
                                )}
                                {!a.is_revoked && (
                                  <button onClick={() => revokeAdmin(a.id)} className="p-1.5 rounded-lg" title="Revoke access"
                                          style={{ background: `${C.red}15` }}>
                                    <Shield className="w-3 h-3" style={{ color: C.red }} />
                                  </button>
                                )}
                                <button onClick={() => deleteAdmin(a.id)} className="p-1.5 rounded-lg" title="Delete permanently"
                                        style={{ background: `${C.red}25` }}>
                                  <Trash2 className="w-3 h-3" style={{ color: C.red }} />
                                </button>
                              </div>
                            )}
                          </div>
                          {a.key_value && (
                            <div className="flex items-center gap-2 mt-2">
                              <code className="text-[10px] font-mono break-all flex-1 select-all" style={{ color: '#7cc1ff' }}>
                                {a.key_value}
                              </code>
                              <button onClick={() => copyToClipboard(a.key_value!, a.id)} className="shrink-0 p-1 rounded">
                                {copied === a.id ? <Check className="w-3 h-3" style={{ color: C.green }} />
                                                : <Copy className="w-3 h-3" style={{ color: C.textDim }} />}
                              </button>
                            </div>
                          )}
                        </div>
                      ))}
                      {admins.length === 0 && (
                        <p className="text-xs text-center py-6" style={{ color: C.textDim }}>No admin keys yet</p>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {activeTab === 'audit' && isMaster && <AdminAuditLog callApi={adminApi} />}
              {activeTab === 'alerts' && isMaster && (
                <AdminSecurityAlerts callApi={adminApi} onRevokeKey={async (id) => { await revokeKey(id); }} />
              )}

              {/* RESELLER TAB (master only) */}
              {activeTab === 'reseller' && isMaster && (
                <div className="space-y-3">
                  <div className="rounded-xl p-4 space-y-3"
                       style={{ background: C.bg, border: `1px solid ${C.border}` }}>
                    <div className="flex items-center gap-2">
                      <Package className="w-4 h-4" style={{ color: C.accent }} />
                      <span className="text-xs font-bold" style={{ color: C.text }}>Generate Bulk Keys</span>
                    </div>
                    <p className="text-[10px]" style={{ color: C.textDim }}>
                      Bulk keys are hidden from the main Keys tab. Names follow{' '}
                      <code style={{ color: C.accent }}>Reseller-RR-####</code>.
                    </p>
                    <input type="text" value={resellerName} onChange={e => setResellerName(e.target.value)}
                           placeholder="Reseller name (e.g. Ascend)"
                           className="w-full h-9 px-3 rounded-lg text-xs focus:outline-none"
                           style={{ background: C.surface, border: `1px solid ${C.border}`, color: C.text }} />
                    <div className="flex gap-2">
                      <input type="number" min={1} max={500} value={bulkCount}
                             onChange={e => setBulkCount(e.target.value)}
                             placeholder="Bulk keys amount"
                             className="flex-1 h-9 px-3 rounded-lg text-xs focus:outline-none"
                             style={{ background: C.surface, border: `1px solid ${C.border}`, color: C.text }} />
                    </div>
                    <div className="flex gap-1 flex-wrap">
                      {(['daily', '3day', 'weekly', 'monthly', 'lifetime'] as const).map(t => (
                        <button key={t} onClick={() => setBulkType(t)}
                                className="flex-1 min-w-[60px] h-9 rounded-lg text-[10px] font-bold transition-all"
                                style={{
                                  background: bulkType === t ? C.accent : C.surface,
                                  color: bulkType === t ? C.text : C.textDim,
                                  border: `1px solid ${bulkType === t ? C.accent : C.border}`,
                                }}>
                          {t === '3day' ? '3-Day' : t.charAt(0).toUpperCase() + t.slice(1)}
                        </button>
                      ))}
                    </div>
                    <button onClick={generateBulkKeys} disabled={bulkBusy || !resellerName.trim()}
                            className="w-full h-10 rounded-lg text-xs font-black flex items-center justify-center gap-2 disabled:opacity-50"
                            style={{ background: C.green, color: C.bg }}>
                      {bulkBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Package className="w-4 h-4" />}
                      Generate Bulk Key {bulkCount || ''}
                    </button>
                    {bulkError && (<p className="text-xs" style={{ color: C.red }}>{bulkError}</p>)}
                    {bulkGenerated.length > 0 && (
                      <div className="rounded-lg p-3 space-y-1.5" style={{ background: C.surface, border: `1px solid ${C.green}40` }}>
                        <div className="flex items-center justify-between">
                          <p className="text-[10px] font-bold" style={{ color: C.green }}>
                            ✓ {bulkGenerated.length} Keys Created
                          </p>
                          <button onClick={() => copyToClipboard(bulkGenerated.join('\n'), 'bulk')}
                                  className="flex items-center gap-1 px-2 py-1 rounded-md"
                                  style={{ background: `${C.green}15` }}>
                            {copied === 'bulk' ? <Check className="w-3 h-3" style={{ color: C.green }} />
                                              : <Copy className="w-3 h-3" style={{ color: C.green }} />}
                            <span className="text-[10px] font-bold" style={{ color: C.green }}>
                              {copied === 'bulk' ? 'Copied' : 'Copy All'}
                            </span>
                          </button>
                        </div>
                        <div className="max-h-32 overflow-y-auto font-mono text-[10px] space-y-0.5" style={{ color: '#4eff4e' }}>
                          {bulkGenerated.map(k => <div key={k}>{k}</div>)}
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between px-1">
                      <h3 className="text-[10px] font-bold uppercase tracking-widest" style={{ color: C.textMuted }}>
                        Resellers ({resellerGroups.length})
                      </h3>
                      <button onClick={loadResellerGroups} className="p-1" style={{ color: C.textDim }}>
                        <RefreshCw className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <div className="space-y-2 max-h-[300px] overflow-y-auto pr-0.5">
                      {resellerGroups.map(g => {
                        const displayName = (g.name || '').replace(/^Reseller:\s*/, '');
                        const opened = openReseller === g.id;
                        const keysList = resellerKeys[g.id] || [];
                        return (
                          <div key={g.id} className="rounded-xl"
                               style={{ background: C.bg, border: `1px solid ${C.border}` }}>
                            <div className="flex items-center gap-2 px-3 py-2">
                              <Store className="w-3.5 h-3.5" style={{ color: C.accent }} />
                              <p className="flex-1 text-[11px] font-bold truncate" style={{ color: C.text }}>
                                {displayName}
                              </p>
                              <button onClick={() => {
                                const next = opened ? null : g.id;
                                setOpenReseller(next);
                                if (next && !resellerKeys[g.id]) loadResellerKeys(g.id);
                              }} className="p-1.5 rounded-lg" style={{ background: `${C.textDim}15` }}>
                                {opened ? <ChevronUp className="w-3 h-3" style={{ color: C.textMuted }} />
                                        : <ChevronDown className="w-3 h-3" style={{ color: C.textMuted }} />}
                              </button>
                              <button onClick={() => deleteResellerGroup(g.id)} className="p-1.5 rounded-lg"
                                      style={{ background: `${C.red}15` }}>
                                <Trash2 className="w-3 h-3" style={{ color: C.red }} />
                              </button>
                            </div>
                            {opened && (
                              <div className="px-3 pb-3 space-y-1" style={{ borderTop: `1px solid ${C.border}` }}>
                                <p className="text-[9px] pt-2" style={{ color: C.textDim }}>
                                  {keysList.length} key{keysList.length === 1 ? '' : 's'}
                                </p>
                                <div className="max-h-40 overflow-y-auto font-mono text-[10px] space-y-0.5" style={{ color: '#4eff4e' }}>
                                  {keysList.map(k => (
                                    <div key={k.id} className="flex items-center gap-1">
                                      <span className="flex-1 truncate" style={{ color: k.is_revoked ? C.red : '#4eff4e' }}>
                                        {k.key_value || k.key_name}
                                      </span>
                                      <span className="text-[9px]" style={{ color: C.textDim }}>
                                        {k.activated_at ? 'used' : 'new'}
                                      </span>
                                    </div>
                                  ))}
                                  {keysList.length === 0 && (
                                    <p className="text-center py-2" style={{ color: C.textDim }}>No keys</p>
                                  )}
                                </div>
                                {keysList.length > 0 && (
                                  <button onClick={() => copyToClipboard(
                                    keysList.map(k => k.key_value || k.key_name).join('\n'), `r${g.id}`,
                                  )}
                                          className="w-full mt-1 h-7 rounded-md text-[10px] font-bold flex items-center justify-center gap-1"
                                          style={{ background: `${C.accent}15`, color: C.accent }}>
                                    {copied === `r${g.id}` ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                                    {copied === `r${g.id}` ? 'Copied' : 'Copy all keys'}
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                      {resellerGroups.length === 0 && (
                        <p className="text-xs text-center py-6" style={{ color: C.textDim }}>
                          No resellers yet. Generate bulk keys above to create one.
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {activeTab === 'settings' && isMaster && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between rounded-xl px-4 py-3"
                       style={{ background: C.bg, border: `1px solid ${C.border}` }}>
                    <div>
                      <p className="text-xs font-bold" style={{ color: C.text }}>Bypass Mode</p>
                      <p className="text-[10px]" style={{ color: C.textDim }}>Allow everyone without key</p>
                    </div>
                    <button onClick={toggleBypass}>
                      {bypassEnabled
                        ? <ToggleRight className="w-8 h-8" style={{ color: C.green }} />
                        : <ToggleLeft className="w-8 h-8" style={{ color: C.textDim }} />}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
};

export default AdminPanel;
