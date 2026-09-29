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
    this.data = this._load();
  }

  _load() {
    try {
      if (global.__AHUMA_STORES__[this.name] && Object.keys(global.__AHUMA_STORES__[this.name]).length > 0) {
        return global.__AHUMA_STORES__[this.name];
      }
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf8');
        const parsed = JSON.parse(raw);
        global.__AHUMA_STORES__[this.name] = parsed;
        return parsed;
      }
    } catch (e) {
      console.warn(`[Store ${this.name}] Read error:`, e.message);
    }

    const initial = this.name === 'guestbook' ? { ...INITIAL_GUESTBOOK_ENTRIES } : {};
    global.__AHUMA_STORES__[this.name] = initial;
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
    this.data = this._load();
    this.data[key] = value;
    global.__AHUMA_STORES__[this.name] = this.data;
    this._persist(this.data);
    return true;
  }

  async delete(key) {
    this.data = this._load();
    delete this.data[key];
    global.__AHUMA_STORES__[this.name] = this.data;
    this._persist(this.data);
    return true;
  }
}

function getUnifiedStore(name) {
  // Check if Netlify Blobs can be instantiated without throwing
  let blobsStore = null;
  try {
    const { getStore } = require('@netlify/blobs');
    blobsStore = getStore(name);
  } catch (err) {
    // Expected when NETLIFY_BLOBS_CONTEXT is not provisioned
    return new FileMemoryStore(name);
  }

  // If getStore didn't throw, wrap operations with graceful fallback
  const fallback = new FileMemoryStore(name);
  return {
    async list() {
      try {
        return await blobsStore.list();
      } catch (err) {
        console.warn(`[Netlify Blobs ${name}] list() failed:`, err.message);
        return await fallback.list();
      }
    },
    async get(key, options) {
      try {
        return await blobsStore.get(key, options);
      } catch (err) {
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
      try {
        await blobsStore.delete(key);
      } catch (err) {
        console.warn(`[Netlify Blobs ${name}] delete() failed:`, err.message);
        await fallback.delete(key);
      }
      return true;
    }
  };
}

module.exports = { getUnifiedStore };
