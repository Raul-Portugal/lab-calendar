/**
 * LabCal Cloud Sync & Zero-Knowledge E2EE Sync Manager
 * Supports Supabase Auth & PostgreSQL storage with optional AES-GCM-256 client-side encryption.
 * Zero external libraries required (pure Web Crypto API & native fetch).
 */

const DEFAULT_CONFIG_STORAGE_KEY = 'lab_calendar_cloud_config';

// Isolated config key when the test suite overrides the storage key
function getConfigStorageKey() {
  const override = typeof window !== 'undefined' && window.__LABCAL_STORAGE_KEY__;
  return override ? `${override}_cloud_config` : DEFAULT_CONFIG_STORAGE_KEY;
}

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
    this.syncRequestedWhileBusy = false;
    this.dirtyGeneration = 0;
    // async () => 'local' | 'cloud' | null, set by the UI to resolve sync conflicts
    this.conflictResolver = null;
  }

  loadConfig() {
    const defaults = this.defaultConfig();
    try {
      const raw = localStorage.getItem(getConfigStorageKey());
      // Merge so configs saved by older versions pick up new fields
      if (raw) return { ...defaults, ...JSON.parse(raw) };
    } catch (e) {}
    return defaults;
  }

  defaultConfig() {
    return {
      supabaseUrl: '',
      supabaseAnonKey: '',
      userEmail: '',
      userId: '',
      accessToken: '',
      refreshToken: '',
      passphrase: '',
      lastSyncedAt: null,
      // Server updated_at of the cloud row this device last pulled or pushed
      lastSyncedServerAt: null,
      // True when this device has edits that are not in the cloud yet
      localDirty: true,
      autoSync: true
    };
  }

  /**
   * Record a local data edit so the next sync knows this device has unsynced changes
   */
  markDirty() {
    this.dirtyGeneration += 1;
    if (this.config.localDirty) return;
    this.config.localDirty = true;
    this.saveConfig();
  }

  saveConfig() {
    try {
      localStorage.setItem(getConfigStorageKey(), JSON.stringify(this.config));
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

    if (this.config.userId && this.config.userId !== data.user.id) {
      // Different account: this device has never synced with it
      this.config.lastSyncedServerAt = null;
      this.config.localDirty = true;
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
    // The next account this device connects to starts a fresh sync relationship
    this.config.lastSyncedServerAt = null;
    this.config.localDirty = true;
    this.saveConfig();
    this.setStatus('local_only', 'Disconnected from cloud.');
  }

  /**
   * Authenticated PostgREST request. On 401 the access token is refreshed and the
   * request retried exactly once (no unbounded recursion).
   */
  async authedFetch(path, options = {}, allowRetry = true) {
    const url = this.formatBaseUrl(this.config.supabaseUrl);
    const res = await fetch(`${url}${path}`, {
      ...options,
      headers: {
        ...(options.headers || {}),
        'apikey': this.config.supabaseAnonKey,
        'Authorization': `Bearer ${this.config.accessToken}`
      }
    });
    if (res.status === 401 && allowRetry) {
      await this.refreshAccessToken();
      return this.authedFetch(path, options, false);
    }
    return res;
  }

  buildExportSnapshot() {
    return {
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
  }

  sameServerTime(a, b) {
    if (!a || !b) return false;
    return Date.parse(a) === Date.parse(b);
  }

  /**
   * Fetch this user's cloud row (still encrypted). Returns null when the cloud is empty.
   */
  async pullFromCloud() {
    if (!this.isConnected()) return null;
    const userFilter = `user_id=eq.${encodeURIComponent(this.config.userId)}`;
    const res = await this.authedFetch(`/rest/v1/user_calendar_data?select=updated_at,payload&${userFilter}`, {
      method: 'GET'
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Failed to fetch cloud data (${res.status}): ${err}`);
    }

    const rows = await res.json();
    if (!rows || rows.length === 0) return null;
    return { updatedAt: rows[0].updated_at, payload: rows[0].payload };
  }

  /**
   * Push the current local state, but only if the cloud row is still the version this
   * device expects (optimistic concurrency on updated_at). expectedServerAt === null
   * means "the cloud is empty": the row is inserted, failing if one appeared meanwhile.
   * Throws SyncConflictError when another device wrote first.
   */
  async pushToCloud(expectedServerAt) {
    if (!this.isConnected()) return false;

    const generationAtStart = this.dirtyGeneration;
    const encryptedWrapper = await encryptPayload(this.buildExportSnapshot(), this.config.passphrase);
    const body = {
      user_id: this.config.userId,
      updated_at: new Date().toISOString(),
      is_encrypted: encryptedWrapper.isEncrypted,
      payload: encryptedWrapper
    };
    const headers = { 'Content-Type': 'application/json', 'Prefer': 'return=representation' };

    let res;
    if (expectedServerAt) {
      const filter = `user_id=eq.${encodeURIComponent(this.config.userId)}` +
        `&updated_at=eq.${encodeURIComponent(expectedServerAt)}`;
      res = await this.authedFetch(`/rest/v1/user_calendar_data?${filter}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify(body)
      });
    } else {
      res = await this.authedFetch('/rest/v1/user_calendar_data', {
        method: 'POST',
        headers,
        body: JSON.stringify(body)
      });
      if (res.status === 409) throw new SyncConflictError();
    }

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Failed to save to cloud (${res.status}): ${err}`);
    }

    const rows = await res.json();
    // PATCH matched no row: the cloud changed since expectedServerAt
    if (!Array.isArray(rows) || rows.length === 0) throw new SyncConflictError();

    this.config.lastSyncedServerAt = rows[0].updated_at || body.updated_at;
    this.config.lastSyncedAt = new Date().toISOString();
    // Edits made while the push was in flight are still unsynced
    this.config.localDirty = this.dirtyGeneration !== generationAtStart;
    this.saveConfig();
    return true;
  }

  /**
   * Replace local data with a cloud row (undoable via Ctrl+Z)
   */
  async applyRemote(remote) {
    const state = await decryptPayload(remote.payload, this.config.passphrase);
    if (!state || typeof state !== 'object') throw new Error('Cloud data is empty or unreadable.');

    this.store.pushHistorySnapshot('Sync from cloud');
    this.store.applyData(state);
    this.store.notify('cloud_pull');

    this.config.lastSyncedServerAt = remote.updatedAt;
    this.config.lastSyncedAt = new Date().toISOString();
    this.config.localDirty = false;
    this.saveConfig();
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
      // Keep the sync bookkeeping: signing back into the same account should resume cleanly
      this.config.accessToken = '';
      this.config.refreshToken = '';
      this.saveConfig();
      throw new Error('Session expired. Please sign in again.');
    }

    this.config.accessToken = data.access_token;
    this.config.refreshToken = data.refresh_token;
    this.saveConfig();
  }

  /**
   * Two-way sync. Never discards data silently:
   * - cloud unchanged since our last sync -> push local edits (if any)
   * - cloud changed, no local edits       -> apply cloud
   * - both changed                         -> ask the user via conflictResolver
   */
  async syncNow() {
    if (!this.isConnected()) {
      this.setStatus('local_only', 'Cloud sync not configured.');
      return;
    }

    if (this.isSyncing) {
      this.syncRequestedWhileBusy = true;
      return;
    }
    this.isSyncing = true;
    this.setStatus('syncing', 'Syncing with cloud...');

    try {
      // A conflicting write between our pull and push makes us pull again
      for (let attempt = 0; attempt < 3; attempt++) {
        const remote = await this.pullFromCloud();
        try {
          await this.reconcile(remote);
          break;
        } catch (err) {
          if (!(err instanceof SyncConflictError) || attempt === 2) throw err;
        }
      }
    } catch (err) {
      console.error('Cloud sync error:', err);
      this.setStatus('error', err instanceof SyncConflictError
        ? 'Another device keeps writing to the cloud. Try syncing again.'
        : err.message);
    } finally {
      this.isSyncing = false;
      if (this.syncRequestedWhileBusy) {
        this.syncRequestedWhileBusy = false;
        this.syncNow();
      }
    }
  }

  async reconcile(remote) {
    const time = () => new Date().toLocaleTimeString();

    if (!remote) {
      await this.pushToCloud(null);
      this.setStatus('synced', 'Synced (Initial cloud backup created)');
      return;
    }

    const cloudChanged = !this.sameServerTime(remote.updatedAt, this.config.lastSyncedServerAt);
    const localDirty = Boolean(this.config.localDirty);

    if (!cloudChanged) {
      if (localDirty) await this.pushToCloud(remote.updatedAt);
      this.setStatus('synced', `Synced with cloud at ${time()}`);
      return;
    }

    if (!localDirty) {
      await this.applyRemote(remote);
      this.setStatus('synced', `Updated from another device at ${time()}`);
      return;
    }

    const choice = this.conflictResolver ? await this.conflictResolver() : null;
    if (choice === 'cloud') {
      await this.applyRemote(remote);
      this.setStatus('synced', `Replaced this device with the cloud version at ${time()}`);
    } else if (choice === 'local') {
      await this.pushToCloud(remote.updatedAt);
      this.setStatus('synced', `Replaced the cloud with this device's version at ${time()}`);
    } else {
      this.setStatus('error', 'Sync paused: this device and the cloud both have changes. Click Sync Now to choose which to keep.');
    }
  }

  /**
   * Debounced Auto-Sync triggered on local data edits
   */
  scheduleAutoSync() {
    if (!this.isConnected() || !this.config.autoSync) return;
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => this.syncNow(), 1500);
  }
}

export class SyncConflictError extends Error {
  constructor() {
    super('The cloud copy changed while syncing.');
    this.name = 'SyncConflictError';
  }
}
