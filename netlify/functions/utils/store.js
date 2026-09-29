const fs = require('fs');
const path = require('path');
const os = require('os');

// In-memory global store to survive warm Lambda invocations
if (!global.__AHUMA_STORES__) {
  global.__AHUMA_STORES__ = {};
}

// Initial guestbook entries so visitors see example signatures
const INITIAL_GUESTBOOK_ENTRIES = {
  entry_ahuma_genesis: {
    name: 'Brian Ahuma Kabutey',
    signature: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 80"><path d="M30 45 Q 60 15 100 45 T 180 35 Q 220 65 270 30" fill="none" stroke="%2338bdf8" stroke-width="3" stroke-linecap="round"/><circle cx="275" cy="30" r="3" fill="%2338bdf8"/><text x="180" y="65" fill="%2394a3b8" font-family="sans-serif" font-size="12">Ahuma</text></svg>',
    timestamp: new Date().toISOString()
  }
};

class FileMemoryStore {
  constructor(name) {
    this.name = name;
    this.filePath = path.join(os.tmpdir(), `ahuma_store_${name}.json`);
  }

  _load() {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf8');
        return JSON.parse(raw);
      }
    } catch (e) {
      console.warn(`[Store ${this.name}] Read error:`, e.message);
    }

    const initial = this.name === 'guestbook' ? { ...INITIAL_GUESTBOOK_ENTRIES } : {};
    this._persist(initial);
    return initial;
  }

  _persist(data) {
    try {
      fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2), 'utf8');
    } catch (e) {
      console.warn(`[Store ${this.name}] Write error:`, e.message);
    }
  }

  async list() {
    const current = this._load();
    const keys = Object.keys(current);
    return {
      blobs: keys.map((key) => ({ key }))
    };
  }

  async get(key, options = {}) {
    const current = this._load();
    const item = current[key];
    if (item === undefined) return null;
    return item;
  }

  async setJSON(key, value) {
    const current = this._load();
    current[key] = value;
    this._persist(current);
    return true;
  }

  async delete(key) {
    const current = this._load();
    if (key in current) {
      delete current[key];
      this._persist(current);
    }
    return true;
  }
}

function getUnifiedStore(name) {
  // Only attempt Netlify Blobs if context or explicit credentials are configured
  const hasBlobsConfig = Boolean(
    process.env.NETLIFY_BLOBS_CONTEXT || 
    (process.env.NETLIFY_SITE_ID && (process.env.NETLIFY_AUTH_TOKEN || process.env.NETLIFY_TOKEN))
  );

  const fallback = new FileMemoryStore(name);

  if (!hasBlobsConfig) {
    return fallback;
  }

  let blobsStore = null;
  try {
    const { getStore } = require('@netlify/blobs');
    blobsStore = getStore(name);
  } catch (err) {
    return fallback;
  }

  return {
    async list() {
      try {
        const res = await blobsStore.list();
        if (res && Array.isArray(res.blobs)) {
          return res;
        }
        return await fallback.list();
      } catch (err) {
        console.warn(`[Netlify Blobs ${name}] list() failed:`, err.message);
        return await fallback.list();
      }
    },
    async get(key, options) {
      try {
        const val = await blobsStore.get(key, options);
        // If Blobs is authoritative (reachable), trust its answer — even if null.
        // Falling back to /tmp here would "resurrect" deleted entries.
        return val ?? null;
      } catch (err) {
        // Blobs unreachable → fall back to /tmp
        console.warn(`[Netlify Blobs ${name}] get() failed:`, err.message);
        return await fallback.get(key, options);
      }
    },
    async setJSON(key, value) {
      try {
        await blobsStore.setJSON(key, value);
      } catch (err) {
        console.warn(`[Netlify Blobs ${name}] setJSON() failed:`, err.message);
        await fallback.setJSON(key, value);
      }
      return true;
    },
    async delete(key) {
      // Let Blobs delete throw — so callers know if it actually failed.
      // The 500 path in the handler will surface this as a proper error.
      await blobsStore.delete(key);
      try {
        // Best-effort: clean up the fallback /tmp file too (different Lambda container)
        await fallback.delete(key);
      } catch (e) {
        // Not critical — the Blobs delete already succeeded
      }
      return true;
    }
  };
}

module.exports = { getUnifiedStore };
