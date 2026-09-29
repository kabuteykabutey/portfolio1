const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-CSRF-Token',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed.' }) };
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const { email, password } = body;

    if (!email || !password) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Email and password are required.' }),
      };
    }

    const adminEmail = process.env.ADMIN_EMAIL || 'briankabutey10@gmail.com';
    const adminPasswordHash = process.env.ADMIN_PASSWORD_HASH || '$2a$12$HNliePMgWEKAV2Wa7728G.BoPp8h6mqKTXXLl0IZGNsYDqstIP9ni';
    const jwtSecret = process.env.JWT_SECRET || '0e332368186d9d5a3630114d12bcd7184cd37713de05157a26ff827ead1e66d3';

    // Validate credentials
    const emailMatch = email.toLowerCase().trim() === adminEmail.toLowerCase().trim();
    const passwordMatch = await bcrypt.compare(password, adminPasswordHash);

    if (!emailMatch || !passwordMatch) {
      // Constant-time-ish delay to prevent timing attacks
      await new Promise((r) => setTimeout(r, 500 + Math.random() * 500));
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({ error: 'Invalid credentials.' }),
      };
    }

    // Generate JWT
    const token = jwt.sign(
      { email: adminEmail, role: 'admin' },
      jwtSecret,
      { expiresIn: '2h' }
    );

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ token }),
    };
  } catch (err) {
    console.error('Login error:', err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Internal server error.' }),
    };
  }
};
