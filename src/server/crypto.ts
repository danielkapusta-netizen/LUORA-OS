import { createCipheriv, createDecipheriv, createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { env } from './env';
import { msg } from '@/lib/i18n/msg';

const scryptAsync = promisify(scrypt) as (password: string, salt: Buffer, keylen: number) => Promise<Buffer>;

let warnedDevKey = false;

function encryptionKey(): Buffer {
  const raw = env().ENCRYPTION_KEY;
  if (raw) {
    const key = Buffer.from(raw, 'base64');
    if (key.length !== 32) throw new Error(msg('ENCRYPTION_KEY must be 32 bytes encoded as base64'));
    return key;
  }
  if (env().NODE_ENV === 'production') throw new Error(msg('ENCRYPTION_KEY is required in production'));
  if (!warnedDevKey) {
    console.warn('ENCRYPTION_KEY is not set; using an insecure development key');
    warnedDevKey = true;
  }
  return createHash('sha256').update('luora-os-development-key').digest();
}

/** Encrypts a JSON-serialisable value with AES-256-GCM. */
export function encryptJson(value: unknown): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ['v1', iv.toString('base64'), tag.toString('base64'), ciphertext.toString('base64')].join(':');
}

export function decryptJson<T>(payload: string): T {
  const [version, iv, tag, ciphertext] = payload.split(':');
  if (version !== 'v1' || !iv || !tag || !ciphertext) throw new Error(msg('Unrecognised encrypted payload'));
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  const plaintext = Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64')), decipher.final()]);
  return JSON.parse(plaintext.toString('utf8')) as T;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scryptAsync(password, salt, 64);
  return `scrypt:${salt.toString('base64')}:${hash.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, salt, hash] = stored.split(':');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const actual = await scryptAsync(password, Buffer.from(salt, 'base64'), expected.length);
  return timingSafeEqual(expected, actual);
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}
