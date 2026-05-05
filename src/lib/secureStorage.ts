const APP_SALT = 'trustledger-v1-static-salt';
const PBKDF2_ITER = 100_000;

function bufToB64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}
function b64ToBuf(s: string): ArrayBuffer {
  const bin = atob(s);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}
async function deriveKey(fingerprint: string): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey('raw', enc.encode(fingerprint), { name: 'PBKDF2' }, false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: enc.encode(APP_SALT), iterations: PBKDF2_ITER, hash: 'SHA-256' },
    baseKey, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
  );
}
export async function encryptToStorage(plaintext: string, fingerprint: string): Promise<string> {
  const key = await deriveKey(fingerprint);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plaintext));
  return JSON.stringify({ iv: bufToB64(iv.buffer), ct: bufToB64(ct) });
}
export async function decryptFromStorage(payload: string, fingerprint: string): Promise<string | null> {
  try {
    const { iv, ct } = JSON.parse(payload);
    const key = await deriveKey(fingerprint);
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: new Uint8Array(b64ToBuf(iv)) }, key, b64ToBuf(ct));
    return new TextDecoder().decode(pt);
  } catch { return null; }
}
