const jwt = require('jsonwebtoken');
const { getStore } = require('@netlify/blobs');

function verifyToken(event) {
  const auth = event.headers.authorization || event.headers.Authorization || '';
  const token = auth.replace('Bearer ', '');

  if (!token) return null;

  try {
    const jwtSecret = process.env.JWT_SECRET || '0e332368186d9d5a3630114d12bcd7184cd37713de05157a26ff827ead1e66d3';
    return jwt.verify(token, jwtSecret);
  } catch {
    return null;
  }
}

exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-CSRF-Token',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  if (event.httpMethod !== 'DELETE') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed.' }) };
  }

  // Verify admin token
  const decoded = verifyToken(event);
  if (!decoded || decoded.role !== 'admin') {
    return {
      statusCode: 401,
      headers,
      body: JSON.stringify({ error: 'Unauthorized.' }),
    };
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const { id } = body;

    if (!id || typeof id !== 'string') {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Entry ID is required.' }),
      };
    }

    // Validate ID format
    if (!/^entry_\d+_[a-z0-9]+$/.test(id)) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Invalid entry ID.' }),
      };
    }

    const store = getStore('guestbook');
    await store.delete(id);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true }),
    };
  } catch (err) {
    console.error('Guestbook delete error:', err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Internal server error.' }),
    };
  }
};
