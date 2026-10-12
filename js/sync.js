/**
 * LabCal Cloud Sync & Zero-Knowledge E2EE Sync Manager
 * Supports Supabase Auth & PostgreSQL storage with optional AES-GCM-256 client-side encryption.
 * Zero external libraries required (pure Web Crypto API & native fetch).
 */

const CONFIG_STORAGE_KEY = 'lab_calendar_cloud_config';

export const SUPABASE_SETUP_SQL = `-- Run this in your Supabase SQL Editor (takes 10 seconds):
CREATE TABLE IF NOT EXISTS user_calendar_data (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_encrypted BOOLEAN NOT NULL DEFAULT FALSE,
  payload JSONB NOT NULL
);

-- Enable Row-Level Security (RLS) so only YOU can access your lab data:
ALTER TABLE user_calendar_data ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can select own data"
  ON user_calendar_data FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can upsert own data"
  ON user_calendar_data FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
`;

// Helper: Convert Uint8Array to Hex string
function bytesToHex(bytes) {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Helper: Convert Hex string to Uint8Array
function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
  }
  return bytes;
}

/**
 * Client-Side AES-GCM-256 + PBKDF2 Zero-Knowledge Encryption
 */
export async function deriveKey(passphrase, saltBytes) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(passphrase),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: saltBytes,
      iterations: 100000,
      hash: 'SHA-256'
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export async function encryptPayload(dataObject, passphrase) {
  if (!passphrase) {
    return { isEncrypted: false, payload: dataObject };
  }

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt);

  const enc = new TextEncoder();
  const plainBytes = enc.encode(JSON.stringify(dataObject));

  const cipherBuffer = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    plainBytes
  );

  return {
    isEncrypted: true,
    saltHex: bytesToHex(salt),
    ivHex: bytesToHex(iv),
    ciphertextHex: bytesToHex(new Uint8Array(cipherBuffer))
  };
}

export async function decryptPayload(storedWrapper, passphrase) {
  if (!storedWrapper) return null;
  if (!storedWrapper.isEncrypted) {
    return storedWrapper.payload || storedWrapper;
  }

  if (!passphrase) {
    throw new Error('This data is encrypted with a Passphrase. Please enter your Passphrase in Cloud Sync settings to decrypt.');
  }

  const salt = hexToBytes(storedWrapper.saltHex);
  const iv = hexToBytes(storedWrapper.ivHex);
  const cipherBytes = hexToBytes(storedWrapper.ciphertextHex);

  const key = await deriveKey(passphrase, salt);

  try {
    const decryptedBuffer = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      cipherBytes
    );
    const dec = new TextDecoder();
    return JSON.parse(dec.decode(decryptedBuffer));
  } catch (err) {
    throw new Error('Incorrect encryption passphrase. Unable to decrypt calendar.');
  }
}

/**
 * Cloud Sync Manager
 */
export class SyncManager {
  constructor(store) {
    this.store = store;
    this.config = this.loadConfig();
    this.status = 'local_only'; // 'local_only' | 'connected' | 'syncing' | 'synced' | 'error'
    this.statusDetails = '';
    this.listeners = new Set();
    this.debounceTimer = null;
    this.isSyncing = false;
  }

  loadConfig() {
    try {
      const raw = localStorage.getItem(CONFIG_STORAGE_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) {}
    return {
      supabaseUrl: '',
      supabaseAnonKey: '',
      userEmail: '',
      userId: '',
      accessToken: '',
      refreshToken: '',
      passphrase: '',
      lastSyncedAt: null,
      autoSync: true
    };
  }

  saveConfig() {
    try {
      localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(this.config));
    } catch (e) {}
  }

  onStatusChange(fn) {
    this.listeners.add(fn);
    fn(this.status, this.statusDetails, this.config);
    return () => this.listeners.delete(fn);
  }

  setStatus(status, details = '') {
    this.status = status;
    this.statusDetails = details;
    this.listeners.forEach((fn) => fn(status, details, this.config));
  }

  isConnected() {
    return Boolean(
      this.config.supabaseUrl &&
      this.config.supabaseAnonKey &&
      this.config.accessToken &&
      this.config.userId
    );
  }

  formatBaseUrl(url) {
    return (url || '').trim().replace(/\/+$/, '');
  }

  /**
   * Supabase GoTrue Auth: Sign In
   */
  async signIn(email, password) {
    const url = this.formatBaseUrl(this.config.supabaseUrl);
    const anonKey = this.config.supabaseAnonKey;
    if (!url || !anonKey) throw new Error('Supabase URL and Anon Key are required.');

    const res = await fetch(`${url}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': anonKey
      },
      body: JSON.stringify({ email, password })
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error_description || data.msg || data.message || 'Login failed.');
    }

    this.config.accessToken = data.access_token;
    this.config.refreshToken = data.refresh_token;
    this.config.userEmail = data.user.email;
    this.config.userId = data.user.id;
    this.saveConfig();

    this.setStatus('connected', `Logged in as ${data.user.email}`);
    await this.syncNow();
    return data.user;
  }

  /**
   * Supabase GoTrue Auth: Sign Up
   */
  async signUp(email, password) {
    const url = this.formatBaseUrl(this.config.supabaseUrl);
    const anonKey = this.config.supabaseAnonKey;
    if (!url || !anonKey) throw new Error('Supabase URL and Anon Key are required.');

    const res = await fetch(`${url}/auth/v1/signup`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': anonKey
      },
      body: JSON.stringify({ email, password })
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error_description || data.msg || data.message || 'Sign up failed.');
    }

    if (data.access_token) {
      this.config.accessToken = data.access_token;
      this.config.refreshToken = data.refresh_token;
      this.config.userEmail = data.user.email;
      this.config.userId = data.user.id;
      this.saveConfig();
      this.setStatus('connected', `Account created! Logged in as ${data.user.email}`);
      await this.syncNow();
    } else {
      this.setStatus('local_only', 'Account created! Please check your email to confirm registration, then sign in.');
    }

    return data.user;
  }

  /**
   * Disconnect / Log Out
   */
  signOut() {
    this.config.accessToken = '';
    this.config.refreshToken = '';
    this.config.userId = '';
    this.config.userEmail = '';
    this.saveConfig();
    this.setStatus('local_only', 'Disconnected from cloud.');
  }

  /**
   * Pull latest snapshot from Supabase PostgREST
   */
  async pullFromCloud() {
    if (!this.isConnected()) return null;
    const url = this.formatBaseUrl(this.config.supabaseUrl);
    const anonKey = this.config.supabaseAnonKey;

    const res = await fetch(`${url}/rest/v1/user_calendar_data?select=*`, {
      method: 'GET',
      headers: {
        'apikey': anonKey,
        'Authorization': `Bearer ${this.config.accessToken}`
      }
    });

    if (res.status === 401) {
      // Token expired, attempt refresh
      await this.refreshAccessToken();
      return this.pullFromCloud();
    }

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Failed to fetch cloud data (${res.status}): ${err}`);
    }

    const rows = await res.json();
    if (!rows || rows.length === 0) return null;

    const row = rows[0];
    const decryptedState = await decryptPayload(row.payload, this.config.passphrase);
    return {
      updatedAt: row.updated_at,
      state: decryptedState
    };
  }

  /**
   * Push current state to Supabase PostgREST
   */
  async pushToCloud() {
    if (!this.isConnected()) return false;
    const url = this.formatBaseUrl(this.config.supabaseUrl);
    const anonKey = this.config.supabaseAnonKey;

    const currentExport = {
      series: this.store.series,
      exceptions: this.store.exceptions,
      events: this.store.events,
      quotas: this.store.quotas,
      customProtocols: this.store.customProtocols,
      deletedProtocolIds: Array.from(this.store.deletedProtocolIds || []),
      quickClasses: this.store.quickClasses,
      categories: this.store.categories,
      settings: this.store.settings,
      timestamp: new Date().toISOString()
    };

    const encryptedWrapper = await encryptPayload(currentExport, this.config.passphrase);

    const body = {
      user_id: this.config.userId,
      updated_at: new Date().toISOString(),
      is_encrypted: encryptedWrapper.isEncrypted,
      payload: encryptedWrapper
    };

    const res = await fetch(`${url}/rest/v1/user_calendar_data`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': anonKey,
        'Authorization': `Bearer ${this.config.accessToken}`,
        'Prefer': 'resolution=merge-duplicates'
      },
      body: JSON.stringify(body)
    });

    if (res.status === 401) {
      await this.refreshAccessToken();
      return this.pushToCloud();
    }

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Failed to save to cloud (${res.status}): ${err}`);
    }

    this.config.lastSyncedAt = new Date().toISOString();
    this.saveConfig();
    return true;
  }

  /**
   * Refresh Supabase GoTrue Auth Token
   */
  async refreshAccessToken() {
    const url = this.formatBaseUrl(this.config.supabaseUrl);
    const anonKey = this.config.supabaseAnonKey;
    if (!this.config.refreshToken) throw new Error('Session expired. Please sign in again.');

    const res = await fetch(`${url}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': anonKey
      },
      body: JSON.stringify({ refresh_token: this.config.refreshToken })
    });

    const data = await res.json();
    if (!res.ok) {
      this.signOut();
      throw new Error('Session expired. Please sign in again.');
    }

    this.config.accessToken = data.access_token;
    this.config.refreshToken = data.refresh_token;
    this.saveConfig();
  }

  /**
   * Execute 2-Way Conflict Resolution Synchronization
   */
  async syncNow() {
    if (!this.isConnected()) {
      this.setStatus('local_only', 'Cloud sync not configured.');
      return;
    }

    if (this.isSyncing) return;
    this.isSyncing = true;
    this.setStatus('syncing', 'Syncing with cloud...');

    try {
      const cloudData = await this.pullFromCloud();

      if (!cloudData || !cloudData.state) {
        // Cloud is empty -> Push current local state
        await this.pushToCloud();
        this.setStatus('synced', 'Synced (Initial cloud backup created)');
      } else {
        const cloudTime = new Date(cloudData.updatedAt || cloudData.state.timestamp || 0).getTime();
        const localTime = new Date(this.config.lastSyncedAt || 0).getTime();

        // If cloud snapshot is newer, merge it locally
        if (cloudTime > localTime) {
          const s = cloudData.state;
          if (s.series) this.store.series = s.series;
          if (s.exceptions) this.store.exceptions = s.exceptions;
          if (s.events) this.store.events = s.events;
          if (s.quotas) this.store.quotas = s.quotas;
          if (s.customProtocols) this.store.customProtocols = s.customProtocols;
          if (s.deletedProtocolIds) this.store.deletedProtocolIds = new Set(s.deletedProtocolIds);
          if (s.quickClasses) this.store.quickClasses = s.quickClasses;
          if (s.categories) this.store.categories = s.categories;

          this.store.notify('import');
          this.config.lastSyncedAt = cloudData.updatedAt;
          this.saveConfig();
          this.setStatus('synced', `Synced with cloud (Updated from other device at ${new Date(cloudTime).toLocaleTimeString()})`);
        } else {
          // Local changes are newer -> Push to cloud
          await this.pushToCloud();
          this.setStatus('synced', `Synced with cloud at ${new Date().toLocaleTimeString()}`);
        }
      }
    } catch (err) {
      console.error('Cloud sync error:', err);
      this.setStatus('error', err.message);
    } finally {
      this.isSyncing = false;
    }
  }

  /**
   * Debounced Auto-Sync triggered on local store mutation
   */
  scheduleAutoSync() {
    if (!this.isConnected() || !this.config.autoSync) return;
    if (this.debounceTimer) clearTimeout(this.debounceTimer);

    this.debounceTimer = setTimeout(() => {
      this.pushToCloud()
        .then(() => {
          this.setStatus('synced', `Auto-synced at ${new Date().toLocaleTimeString()}`);
        })
        .catch((err) => {
          console.warn('Auto-sync notice:', err.message);
          this.setStatus('error', err.message);
        });
    }, 1500);
  }
}
