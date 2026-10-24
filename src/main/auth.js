/**
 * Authentication — Password hashing and TOTP 2FA for AidDesk.
 * 
 * Unattended access requires a password (hashed with Argon2id).
 * Optional TOTP 2FA uses otplib (Google Authenticator compatible).
 * Failed attempts trigger lockout (5 attempts = 60s lockout).
 */

const crypto = require('crypto');

// ─── Argon2 with graceful fallback ──────────────────────────────────────────
let argon2;
try {
  argon2 = require('argon2');
} catch (err) {
  console.warn('[Auth] argon2 native module not available. Using pbkdf2 fallback.');
  // Provide a compatible fallback using built-in crypto
  argon2 = {
    async hash(password) {
      const salt = crypto.randomBytes(32);
      const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512');
      return `pbkdf2:${salt.toString('hex')}:${hash.toString('hex')}`;
    },
    async verify(hash, password) {
      if (hash.startsWith('pbkdf2:')) {
        const [, saltHex, hashHex] = hash.split(':');
        const salt = Buffer.from(saltHex, 'hex');
        const derived = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512');
        return derived.toString('hex') === hashHex;
      }
      return false;
    },
  };
}

// ─── TOTP 2FA ───────────────────────────────────────────────────────────────
let authenticator;
try {
  const { authenticator: auth } = require('otplib');
  authenticator = auth;
} catch (err) {
  console.warn('[Auth] otplib not available. TOTP 2FA disabled.');
  authenticator = null;
}

let qrcode;
try {
  qrcode = require('qrcode');
} catch (err) {
  console.warn('[Auth] qrcode not available. QR generation disabled.');
  qrcode = null;
}

// ─── Lockout Configuration ──────────────────────────────────────────────────
const MAX_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 60_000; // 60 seconds

class AuthManager {
  constructor(db) {
    this.db = db;
  }

  // ─── Password Management ───────────────────────────────────────────────

  /**
   * Set or update the unattended access password.
   * @param {string} password - Plain text password
   */
  async setPassword(password) {
    if (!password || password.length < 6) {
      throw new Error('Password must be at least 6 characters');
    }
    const hash = await argon2.hash(password);
    this.db.prepare(
      `INSERT INTO auth_config (key, value, updated_at) VALUES ('password_hash', ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    ).run(hash);
    return true;
  }

  /**
   * Verify a password against the stored hash.
   * @param {string} password - Plain text password to verify
   * @returns {boolean}
   */
  async verifyPassword(password) {
    const row = this.db.prepare("SELECT value FROM auth_config WHERE key = 'password_hash'").get();
    if (!row || !row.value) return false;
    return argon2.verify(row.value, password);
  }

  /**
   * Check if a password has been set.
   */
  hasPassword() {
    const row = this.db.prepare("SELECT value FROM auth_config WHERE key = 'password_hash'").get();
    return !!(row && row.value);
  }

  /**
   * Remove the unattended access password.
   */
  removePassword() {
    this.db.prepare("DELETE FROM auth_config WHERE key = 'password_hash'").run();
    return true;
  }

  // ─── TOTP 2FA ──────────────────────────────────────────────────────────

  /**
   * Generate a new TOTP secret and return it with a QR code data URL.
   * @param {string} deviceId - This device's ID (for the authenticator label)
   */
  async setup2FA(deviceId) {
    if (!authenticator) throw new Error('TOTP library not available');

    const secret = authenticator.generateSecret();
    const otpauthUrl = authenticator.keyuri(deviceId, 'AidDesk', secret);

    // Store secret (not yet enabled — user must verify first)
    this.db.prepare(
      `INSERT INTO auth_config (key, value, updated_at) VALUES ('totp_pending', ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    ).run(secret);

    let qrDataUrl = null;
    if (qrcode) {
      qrDataUrl = await qrcode.toDataURL(otpauthUrl);
    }

    return { secret, otpauthUrl, qrDataUrl };
  }

  /**
   * Verify a TOTP token and activate 2FA if correct.
   * @param {string} token - 6-digit TOTP token
   */
  verify2FASetup(token) {
    if (!authenticator) return false;
    const row = this.db.prepare("SELECT value FROM auth_config WHERE key = 'totp_pending'").get();
    if (!row || !row.value) return false;

    const isValid = authenticator.check(token, row.value);
    if (isValid) {
      // Move from pending to active
      this.db.prepare(
        `INSERT INTO auth_config (key, value, updated_at) VALUES ('totp_secret', ?, datetime('now'))
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
      ).run(row.value);
      this.db.prepare("DELETE FROM auth_config WHERE key = 'totp_pending'").run();
    }
    return isValid;
  }

  /**
   * Verify a TOTP token against the active secret.
   */
  verifyTOTP(token) {
    if (!authenticator) return false;
    const row = this.db.prepare("SELECT value FROM auth_config WHERE key = 'totp_secret'").get();
    if (!row || !row.value) return true; // No 2FA set up = pass
    return authenticator.check(token, row.value);
  }

  /**
   * Check if 2FA is enabled.
   */
  is2FAEnabled() {
    const row = this.db.prepare("SELECT value FROM auth_config WHERE key = 'totp_secret'").get();
    return !!(row && row.value);
  }

  /**
   * Disable 2FA.
   */
  disable2FA() {
    this.db.prepare("DELETE FROM auth_config WHERE key IN ('totp_secret', 'totp_pending')").run();
    return true;
  }

  // ─── Lockout ───────────────────────────────────────────────────────────

  /**
   * Record a login attempt.
   */
  recordAttempt(remoteDeviceId, success) {
    this.db.prepare(
      "INSERT INTO login_attempts (remote_device_id, attempted_at, success) VALUES (?, datetime('now'), ?)"
    ).run(remoteDeviceId, success ? 1 : 0);
  }

  /**
   * Check if a device is locked out due to failed attempts.
   * @returns {{ locked: boolean, remainingSeconds: number }}
   */
  checkLockout(remoteDeviceId) {
    const cutoff = new Date(Date.now() - LOCKOUT_DURATION_MS).toISOString();
    const recent = this.db.prepare(
      `SELECT COUNT(*) as cnt FROM login_attempts
       WHERE remote_device_id = ? AND attempted_at > ? AND success = 0`
    ).get(remoteDeviceId, cutoff);

    if (recent && recent.cnt >= MAX_ATTEMPTS) {
      // Find the most recent failed attempt to calculate remaining time
      const last = this.db.prepare(
        `SELECT attempted_at FROM login_attempts
         WHERE remote_device_id = ? AND success = 0
         ORDER BY attempted_at DESC LIMIT 1`
      ).get(remoteDeviceId);

      const lastTime = new Date(last.attempted_at).getTime();
      const unlockTime = lastTime + LOCKOUT_DURATION_MS;
      const remaining = Math.max(0, Math.ceil((unlockTime - Date.now()) / 1000));

      return { locked: remaining > 0, remainingSeconds: remaining };
    }
    return { locked: false, remainingSeconds: 0 };
  }

  // ─── ACL Whitelist ─────────────────────────────────────────────────────

  /**
   * Check if a device ID is on the ACL whitelist.
   */
  isWhitelisted(deviceId) {
    const row = this.db.prepare('SELECT id FROM acl_whitelist WHERE device_id = ?').get(deviceId);
    return !!row;
  }

  /**
   * Add a device to the whitelist.
   */
  addToWhitelist(deviceId, notes = '') {
    this.db.prepare(
      `INSERT INTO acl_whitelist (device_id, notes, added_at) VALUES (?, ?, datetime('now'))
       ON CONFLICT(device_id) DO UPDATE SET notes = excluded.notes`
    ).run(deviceId, notes);
  }

  /**
   * Remove a device from the whitelist.
   */
  removeFromWhitelist(deviceId) {
    this.db.prepare('DELETE FROM acl_whitelist WHERE device_id = ?').run(deviceId);
  }

  /**
   * Get all whitelisted devices.
   */
  getWhitelist() {
    return this.db.prepare('SELECT * FROM acl_whitelist ORDER BY added_at DESC').all();
  }
}

module.exports = { AuthManager };
