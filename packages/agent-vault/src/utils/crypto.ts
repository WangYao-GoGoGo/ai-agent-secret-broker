/**
 * Cryptographic utilities for Agent Vault.
 *
 * Uses TweetNaCl for symmetric encryption (secretbox).
 * Key derivation uses PBKDF2 via Node.js crypto.
 */

import nacl from 'tweetnacl'
import naclUtil from 'tweetnacl-util'
const { encodeBase64, decodeBase64, encodeUTF8, decodeUTF8 } = naclUtil
import { pbkdf2Sync } from 'node:crypto'

const PBKDF2_ITERATIONS = 600_000
const SALT_LENGTH = 32
const KEY_LENGTH = nacl.secretbox.keyLength // 32 bytes

/**
 * Derive a 32-byte symmetric key from a master password using PBKDF2.
 */
export function deriveKey(password: string, salt: Uint8Array): Uint8Array {
  const key = pbkdf2Sync(password, Buffer.from(salt), PBKDF2_ITERATIONS, KEY_LENGTH, 'sha-256')
  return new Uint8Array(key)
}

/**
 * Encrypt plaintext using secretbox (XSalsa20-Poly1305).
 *
 * Returns: base64(salt + nonce + ciphertext)
 */
export async function encrypt(plaintext: string, password: string): Promise<string> {
  const salt = nacl.randomBytes(SALT_LENGTH)
  const key = deriveKey(password, salt)
  const nonce = nacl.randomBytes(nacl.secretbox.nonceLength)
  const messageBytes = decodeUTF8(plaintext)
  const ciphertext = nacl.secretbox(messageBytes, nonce, key)

  if (!ciphertext) {
    throw new Error('Encryption failed')
  }

  const combined = new Uint8Array(salt.length + nonce.length + ciphertext.length)
  combined.set(salt, 0)
  combined.set(nonce, salt.length)
  combined.set(ciphertext, salt.length + nonce.length)

  return encodeBase64(combined)
}

/**
 * Decrypt ciphertext that was encrypted with encrypt().
 *
 * Input: base64(salt + nonce + ciphertext)
 */
export async function decrypt(encrypted: string, password: string): Promise<string> {
  const combined = decodeBase64(encrypted)

  const salt = combined.slice(0, SALT_LENGTH)
  const nonce = combined.slice(SALT_LENGTH, SALT_LENGTH + nacl.secretbox.nonceLength)
  const ciphertext = combined.slice(SALT_LENGTH + nacl.secretbox.nonceLength)

  const key = deriveKey(password, salt)
  const plaintext = nacl.secretbox.open(ciphertext, nonce, key)

  if (!plaintext) {
    throw new Error('Decryption failed: wrong password or corrupted data')
  }

  return encodeUTF8(plaintext)
}

/**
 * Generate a cryptographically random token string.
 */
export function generateToken(length: number = 32): string {
  const bytes = nacl.randomBytes(length)
  return encodeBase64(bytes).replace(/[+/=]/g, '').slice(0, length)
}

/**
 * Generate a random salt for key derivation.
 */
export function generateSalt(): Uint8Array {
  return nacl.randomBytes(SALT_LENGTH)
}
