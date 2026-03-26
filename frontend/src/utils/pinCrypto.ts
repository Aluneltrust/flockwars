// ============================================================================
// PIN-BASED WALLET ENCRYPTION
// ============================================================================
// Encrypts the WIF private key using a 4-digit PIN via:
//   PBKDF2 (100k iterations, SHA-256) → AES-256-GCM
//
// Stored in localStorage as JSON: { salt, iv, ciphertext }
// All values are base64-encoded.
//
// This blocks opportunistic XSS from grabbing a plaintext WIF.
// A targeted attacker could still brute-force 10,000 PINs offline,
// but that's a significant step up from "read one localStorage key."
// ============================================================================

const STORAGE_KEY = 'herdswacker_wallet';
const PBKDF2_ITERATIONS = 100_000;

interface EncryptedWallet {
  salt: string;      // base64
  iv: string;        // base64
  ciphertext: string; // base64
  // Optional: address stored in cleartext for display before unlock
  addressHint?: string;
}

// ============================================================================
// HELPERS
// ============================================================================

function toBase64(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}

function fromBase64(b64: string): ArrayBuffer {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

async function deriveKey(pin: string, salt: ArrayBuffer): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const pinBytes = encoder.encode(pin);

  const baseKey = await crypto.subtle.importKey(
    'raw', pinBytes, 'PBKDF2', false, ['deriveKey'],
  );

  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Encrypt a WIF with a 4-digit PIN and store in localStorage.
 * Optionally stores the address in cleartext for display before unlock.
 */
export async function encryptAndStoreWif(
  wif: string,
  pin: string,
  addressHint?: string,
): Promise<void> {
  validatePin(pin);

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(pin, salt.buffer);

  const encoder = new TextEncoder();
  const plaintext = encoder.encode(wif);

  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    plaintext,
  );

  const stored: EncryptedWallet = {
    salt: toBase64(salt.buffer),
    iv: toBase64(iv.buffer),
    ciphertext: toBase64(ciphertext),
    addressHint,
  };

  localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));

  // Remove any legacy plaintext WIF
  localStorage.removeItem('herdswacker_wif');
}

/**
 * Decrypt the stored WIF using the PIN.
 * Returns the WIF string, or throws on wrong PIN / no wallet.
 */
export async function decryptStoredWif(pin: string): Promise<string> {
  validatePin(pin);

  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) throw new Error('No wallet stored');

  let stored: EncryptedWallet;
  try {
    stored = JSON.parse(raw);
  } catch {
    throw new Error('Corrupted wallet data');
  }

  if (!stored.salt || !stored.iv || !stored.ciphertext) {
    throw new Error('Invalid wallet format');
  }

  const salt = fromBase64(stored.salt);
  const iv = fromBase64(stored.iv);
  const ciphertext = fromBase64(stored.ciphertext);
  const key = await deriveKey(pin, salt);

  try {
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: new Uint8Array(iv) },
      key,
      ciphertext,
    );

    return new TextDecoder().decode(plaintext);
  } catch {
    throw new Error('Wrong PIN');
  }
}

/**
 * Check if an encrypted wallet exists in storage.
 */
export function hasStoredWallet(): boolean {
  return localStorage.getItem(STORAGE_KEY) !== null;
}

/**
 * Check if a legacy plaintext WIF exists (for migration).
 */
export function hasLegacyWallet(): boolean {
  return localStorage.getItem('herdswacker_wif') !== null;
}

/**
 * Get the legacy plaintext WIF (for one-time migration).
 */
export function getLegacyWif(): string | null {
  return localStorage.getItem('herdswacker_wif');
}

/**
 * Remove the legacy plaintext WIF after migration.
 */
export function removeLegacyWallet(): void {
  localStorage.removeItem('herdswacker_wif');
}

/**
 * Get the address hint (stored in cleartext) for display before unlock.
 * Returns null if no wallet or no hint stored.
 */
export function getAddressHint(): string | null {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    const stored: EncryptedWallet = JSON.parse(raw);
    return stored.addressHint || null;
  } catch {
    return null;
  }
}

/**
 * Delete the stored wallet entirely.
 */
export function deleteStoredWallet(): void {
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem('herdswacker_wif');
}

/**
 * Change the PIN on an existing wallet.
 * Requires the old PIN to decrypt, then re-encrypts with the new PIN.
 */
export async function changePin(
  oldPin: string,
  newPin: string,
): Promise<void> {
  const wif = await decryptStoredWif(oldPin);
  const hint = getAddressHint();
  await encryptAndStoreWif(wif, newPin, hint || undefined);
}

/**
 * Validate that a PIN is exactly 4 digits.
 */
export function validatePin(pin: string): void {
  if (!/^\d{4}$/.test(pin)) {
    throw new Error('PIN must be exactly 4 digits');
  }
}

/**
 * Check if a PIN is correct without returning the WIF.
 */
export async function verifyPin(pin: string): Promise<boolean> {
  try {
    await decryptStoredWif(pin);
    return true;
  } catch {
    return false;
  }
}