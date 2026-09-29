const { getUnifiedStore } = require('./utils/store');

exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-CSRF-Token',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  try {
    const store = getUnifiedStore('guestbook');

    // GET - List all entries
    if (event.httpMethod === 'GET') {
      const { blobs } = await store.list();
      const entries = [];

      for (const blob of blobs) {
        try {
          const data = await store.get(blob.key, { type: 'json' });
          if (data) {
            entries.push({ id: blob.key, ...data });
          }
        } catch (e) {
          // Skip corrupted entries
        }
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ entries }),
      };
    }

    // POST - Create new entry
    if (event.httpMethod === 'POST') {
      const body = JSON.parse(event.body || '{}');
      const { name, signature, timestamp } = body;

      // Validate
      if (!name || typeof name !== 'string' || name.trim().length === 0) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Name is required.' }),
        };
      }

      if (name.trim().length > 60) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Name is too long.' }),
        };
      }

      if (!signature || typeof signature !== 'string' || !signature.startsWith('data:image/')) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Valid signature image is required.' }),
        };
      }

      // Limit signature size (500KB max)
      if (signature.length > 500000) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Signature image is too large.' }),
        };
      }

      // Strip HTML from name
      const cleanName = name.trim().replace(/<[^>]*>/g, '');

      const id = `entry_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const entry = {
        name: cleanName,
        signature,
        timestamp: timestamp || new Date().toISOString(),
      };

      await store.setJSON(id, entry);

      return {
        statusCode: 201,
        headers,
        body: JSON.stringify({ success: true, id }),
      };
    }

    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed.' }),
    };
  } catch (err) {
    console.error('Guestbook error:', err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message || 'Internal server error.' }),
    };
  }
};
