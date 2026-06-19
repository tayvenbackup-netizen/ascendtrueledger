import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { KeyRound, AlertCircle, Eye, EyeOff, Wallet } from 'lucide-react';

interface Props { onValidate: (key: string) => Promise<boolean>; error: string; }

const KeyEntryScreen = ({ onValidate, error }: Props) => {
  const [key, setKey] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [showKey, setShowKey] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!key.trim() || loading) return;
    setLoading(true);
    const ok = await onValidate(key);
    if (ok) { setSuccess(true); }
    setLoading(false);
  };

  // Disable common devtools shortcuts on this screen as additional friction
  const blockKeys = (e: React.KeyboardEvent) => {
    if (e.key === 'F12') e.preventDefault();
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && ['I', 'J', 'C'].includes(e.key.toUpperCase())) e.preventDefault();
  };


  return (
    <div
      onKeyDown={blockKeys}
      onContextMenu={(e) => e.preventDefault()}
      className="fixed left-0 right-0 top-0 z-[9999] flex items-center justify-center px-4 overflow-hidden select-none"
      data-fullscreen-gate="true"
      style={{ minHeight: '100svh', background: 'radial-gradient(circle at 30% 0%, #1a1530 0%, #0a0a14 60%, #050509 100%)', color: '#fff' }}
    >

      <div aria-hidden className="pointer-events-none absolute" style={{ top: '-167px', right: '-140px', width: '440px', height: '447px', borderRadius: '50%', background: 'radial-gradient(circle, rgba(187,174,252,0.18) 0%, rgba(187,174,252,0) 70%)', filter: 'blur(20px)' }} />
      <div aria-hidden className="pointer-events-none absolute" style={{ bottom: '-160px', left: '-120px', width: '380px', height: '380px', borderRadius: '50%', background: 'radial-gradient(circle, rgba(120,90,220,0.14) 0%, rgba(120,90,220,0) 70%)', filter: 'blur(20px)' }} />

      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }} className="relative w-full max-w-sm">
        <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05, duration: 0.5 }} className="flex items-center justify-center gap-2 mb-5">
          <span className="h-px w-8" style={{ background: 'linear-gradient(to right, transparent, #4a4566)' }} />
          <span className="text-[10px] font-bold uppercase" style={{ color: '#bbaefc', letterSpacing: '0.36em' }}>Ascend Ledger</span>
          <span className="h-px w-8" style={{ background: 'linear-gradient(to left, transparent, #4a4566)' }} />
        </motion.div>

        <div className="text-center mb-8">
          <motion.div initial={{ scale: 0.8 }} animate={{ scale: 1 }} transition={{ delay: 0.1, type: 'spring', stiffness: 200 }} className="relative w-24 h-24 mx-auto mb-4">
            <motion.div aria-hidden className="absolute inset-0 rounded-2xl"
              style={{ background: 'radial-gradient(circle, rgba(187,174,252,0.55) 0%, rgba(187,174,252,0) 70%)', filter: 'blur(14px)' }}
              animate={{ opacity: [0.45, 0.85, 0.45], scale: [1, 1.08, 1] }}
              transition={{ duration: 3.2, repeat: Infinity, ease: 'easeInOut' }} />
            <div className="absolute inset-0 flex items-center justify-center rounded-2xl" style={{ background: 'linear-gradient(135deg, rgba(187,174,252,0.18), rgba(120,90,220,0.06))', border: '1px solid rgba(187,174,252,0.25)' }}>
              <Wallet className="w-10 h-10" style={{ color: '#bbaefc' }} />
            </div>
          </motion.div>
          <h1 className="text-2xl font-bold mb-1 tracking-tight">Ascend Ledger</h1>
          <p className="text-sm" style={{ color: '#8d87a8' }}>Enter your access key to continue</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="relative">
            <input
              type={showKey ? 'text' : 'password'}
              value={key}
              onChange={e => setKey(e.target.value)}
              placeholder="Enter your key..."
              disabled={loading || success}
              autoComplete="off"
              spellCheck={false}
              className="w-full h-12 px-4 pr-11 rounded-lg text-sm focus:outline-none transition-colors disabled:opacity-50"
              style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(187,174,252,0.25)', color: '#fff' }}
              autoFocus
            />
            <button type="button" onClick={() => setShowKey(!showKey)} className="absolute right-3 top-1/2 -translate-y-1/2" style={{ color: '#8d87a8' }}>
              {showKey ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
            </button>
          </div>

          <AnimatePresence>
            {error && !success && (
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="flex items-center gap-2 text-xs px-1" style={{ color: '#ff7a7a' }}>
                <AlertCircle className="w-3.5 h-3.5 shrink-0" /><span>{error}</span>
              </motion.div>
            )}
          </AnimatePresence>

          <motion.button type="submit" disabled={!key.trim() || loading || success} whileTap={{ scale: 0.97 }}
            className="w-full h-12 rounded-lg font-semibold text-sm transition-all flex items-center justify-center gap-2 text-white disabled:opacity-40"
            style={{ background: success ? '#16a34a' : 'linear-gradient(135deg, #6c5ce7, #8b6cf3)' }}>
            <KeyRound className="w-4 h-4" /> Unlock
          </motion.button>
        </form>

        <p className="text-center text-[11px] mt-6 leading-relaxed" style={{ color: '#6e6889' }}>
          Don't have a key? Contact <span style={{ color: '#bbaefc' }}>@Ascend2k</span> on Telegram.
        </p>

        <div className="flex items-center justify-center gap-1.5 mt-8">
          <div className="w-1 h-1 rounded-full" style={{ background: '#bbaefc' }} />
          <span className="text-[9px] font-semibold uppercase" style={{ color: '#6e6889', letterSpacing: '0.32em' }}>Powered by Ascend</span>
          <div className="w-1 h-1 rounded-full" style={{ background: '#bbaefc' }} />
        </div>
      </motion.div>
    </div>
  );
};

export default KeyEntryScreen;
