/** PIN-based encryption at rest: PBKDF2 -> AES-GCM. The key only ever lives in memory. */
const enc = new TextEncoder()
const dec = new TextDecoder()

export interface EncryptedBlob {
  enc: true
  v: 1
  salt: string // base64
  iv: string // base64
  data: string // base64 ciphertext
  iter: number
}

function b64(bytes: ArrayBuffer | Uint8Array) {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  let s = ''
  for (const b of arr) s += String.fromCharCode(b)
  return btoa(s)
}
function unb64(s: string) {
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0))
}

export const PBKDF2_ITER = 210_000

export async function deriveKey(pin: string, salt: Uint8Array, iter = PBKDF2_ITER): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations: iter, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

export function randomBytes(n: number) {
  const b = new Uint8Array(n)
  crypto.getRandomValues(b)
  return b
}

export async function encryptJson(key: CryptoKey, salt: Uint8Array, value: unknown): Promise<EncryptedBlob> {
  const iv = randomBytes(12)
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, enc.encode(JSON.stringify(value)))
  return { enc: true, v: 1, salt: b64(salt), iv: b64(iv), data: b64(data), iter: PBKDF2_ITER }
}

export async function decryptJson<T>(key: CryptoKey, blob: EncryptedBlob): Promise<T> {
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(blob.iv) as BufferSource }, key, unb64(blob.data) as BufferSource)
  return JSON.parse(dec.decode(plain)) as T
}

export function saltFromBlob(blob: EncryptedBlob) {
  return unb64(blob.salt)
}
