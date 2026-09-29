const fs = require('fs');
const path = require('path');
const os = require('os');

// Genesis entry shown as example before any real signatures exist.
// Only used by the /tmp FileMemoryStore fallback (local dev / Blobs unavailable).
const INITIAL_GUESTBOOK_ENTRIES = {
  entry_ahuma_genesis: {
    name: 'Brian Ahuma Kabutey',
    signature:
      'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 80"><path d="M30 45 Q 60 15 100 45 T 180 35 Q 220 65 270 30" fill="none" stroke="%2338bdf8" stroke-width="3" stroke-linecap="round"/><circle cx="275" cy="30" r="3" fill="%2338bdf8"/><text x="180" y="65" fill="%2394a3b8" font-family="sans-serif" font-size="12">Ahuma</text></svg>',
    timestamp: new Date().toISOString(),
  },
};

// ---------------------------------------------------------------------------
// FileMemoryStore — per-container /tmp fallback for local dev
// ---------------------------------------------------------------------------
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
    // First access in this container — seed with defaults and persist
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
    return { blobs: Object.keys(current).map((key) => ({ key })) };
  }

  async get(key) {
    const current = this._load();
    const item = current[key];
    return item !== undefined ? item : null;
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

// ---------------------------------------------------------------------------
// getUnifiedStore — always try Netlify Blobs, fall back per-operation
// ---------------------------------------------------------------------------
function getUnifiedStore(name) {
  const fallback = new FileMemoryStore(name);

  // Attempt to get a Blobs store handle. This does NOT make a network call yet —
  // failures only happen at request time. If the package itself is missing, fall back.
  let blobsStore = null;
  try {
    const { getStore } = require('@netlify/blobs');
    blobsStore = getStore(name);
  } catch (_) {
    console.warn('[Store] @netlify/blobs unavailable — using /tmp fallback');
    return fallback;
  }

  return {
    // list(): Netlify Blobs is authoritative; /tmp only if Blobs is unreachable
    async list() {
      try {
        const res = await blobsStore.list();
        if (res && Array.isArray(res.blobs)) return res;
        return await fallback.list();
      } catch (err) {
        console.warn(`[Netlify Blobs ${name}] list() error:`, err.message);
        return await fallback.list();
      }
    },

    // get(): If Blobs is reachable, its answer is final (null = deleted — don't
    //         resurrect from /tmp). Fall back to /tmp only if Blobs is unreachable.
    async get(key, options) {
      try {
        const val = await blobsStore.get(key, options);
        // Trust Blobs even when it returns null (key was deleted).
        // Falling back to /tmp would "resurrect" deleted entries.
        return val ?? null;
      } catch (err) {
        console.warn(`[Netlify Blobs ${name}] get() error:`, err.message);
        return await fallback.get(key, options);
      }
    },

    // setJSON(): write to Blobs; fall back to /tmp only if Blobs is unreachable
    async setJSON(key, value) {
      try {
        await blobsStore.setJSON(key, value);
      } catch (err) {
        console.warn(`[Netlify Blobs ${name}] setJSON() error:`, err.message);
        await fallback.setJSON(key, value);
      }
      return true;
    },

    // delete(): propagate Blobs errors so the handler returns 500 instead of a
    //           silent 200 when the entry was never actually removed.
    async delete(key) {
      await blobsStore.delete(key); // throws → caller returns 500
      try {
        await fallback.delete(key); // best-effort /tmp cleanup
      } catch (_) {
        // Not critical — Blobs delete already succeeded
      }
      return true;
    },
  };
}

module.exports = { getUnifiedStore };
