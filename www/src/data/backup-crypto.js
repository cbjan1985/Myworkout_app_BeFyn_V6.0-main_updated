// Optional password protection for backup files (AES-256-GCM, key from PBKDF2-HMAC-SHA256, random salt and IV).
// A wrong password or any change to the file makes decryption fail (GCM authenticates the data).
export const ENC_FORMAT = 'befyn-backup-encrypted';
const ITER = 600000; // OWASP guidance for PBKDF2-HMAC-SHA256
const b64 = (u8) => { let s = ''; u8.forEach((x) => { s += String.fromCharCode(x); }); return btoa(s); };
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const subtleOf = (s) => { const x = s || globalThis.crypto?.subtle; if (!x) throw new Error('Secure encryption is not available in this WebView.'); return x; };
async function keyFor(subtle, password, salt, iterations) {
  const base = await subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  return subtle.deriveKey({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
export const isEncrypted = (obj) => !!obj && obj.format === ENC_FORMAT;

export async function encryptBackup(jsonText, password, subtle) {
  if (!password || password.length < 8) throw new Error('Choose a password with at least 8 characters.');
  const sub = subtleOf(subtle), salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await keyFor(sub, password, salt, ITER);
  const data = await sub.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(jsonText));
  return { format: ENC_FORMAT, v: 1, kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: ITER, salt: b64(salt) }, cipher: { name: 'AES-GCM', iv: b64(iv) }, data: b64(new Uint8Array(data)) };
}
export async function decryptBackup(obj, password, subtle) {
  if (!isEncrypted(obj) || obj.v !== 1 || obj.kdf?.name !== 'PBKDF2' || obj.cipher?.name !== 'AES-GCM') throw new Error('This is not a FiT85 encrypted backup.');
  const iterations = Number(obj.kdf.iterations); if (!(iterations >= 100000 && iterations <= 5000000)) throw new Error('The backup uses unsupported settings.');
  const sub = subtleOf(subtle);
  try {
    const key = await keyFor(sub, password || '', unb64(obj.kdf.salt), iterations);
    return new TextDecoder().decode(await sub.decrypt({ name: 'AES-GCM', iv: unb64(obj.cipher.iv) }, key, unb64(obj.data)));
  } catch (_) { throw new Error('wrong-password'); }
}
