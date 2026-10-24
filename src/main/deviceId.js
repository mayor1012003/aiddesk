/**
 * Device ID — Unique identifier for this AidDesk installation.
 * 
 * Generates a cryptographically random 9-digit ID formatted as XXX-XXX-XXX
 * on first launch and persists it in the app's userData directory.
 * This ID is used for signaling, connection requests, and address book entries.
 */

const { app } = require('electron');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DEVICE_ID_FILE = 'device-id.json';

/**
 * Generate a random 9-digit numeric string formatted XXX-XXX-XXX.
 * Uses crypto.randomInt for uniform distribution.
 */
function generateDeviceId() {
  // Generate 9 random digits (000000000 - 999999999)
  const raw = crypto.randomInt(0, 1_000_000_000).toString().padStart(9, '0');
  return `${raw.slice(0, 3)}-${raw.slice(3, 6)}-${raw.slice(6, 9)}`;
}

/**
 * Read existing device ID from userData, or create and persist a new one.
 * @returns {string} Device ID in XXX-XXX-XXX format
 */
function getOrCreateDeviceId() {
  const userDataPath = app.getPath('userData');
  const filePath = path.join(userDataPath, DEVICE_ID_FILE);

  try {
    if (fs.existsSync(filePath)) {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      if (data && data.deviceId && /^\d{3}-\d{3}-\d{3}$/.test(data.deviceId)) {
        return data.deviceId;
      }
    }
  } catch (err) {
    console.warn('[DeviceID] Could not read existing ID, generating new one:', err.message);
  }

  // Generate and persist
  const deviceId = generateDeviceId();
  try {
    fs.mkdirSync(userDataPath, { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify({ deviceId, createdAt: new Date().toISOString() }), 'utf-8');
  } catch (err) {
    console.error('[DeviceID] Could not persist device ID:', err.message);
  }

  return deviceId;
}

module.exports = { getOrCreateDeviceId, generateDeviceId };
