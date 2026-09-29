const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');

function verifyToken(event) {
  const auth = event.headers.authorization || event.headers.Authorization || '';
  const token = auth.replace('Bearer ', '');

  if (!token || !process.env.JWT_SECRET) return null;

  try {
    return jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    return null;
  }
}

exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-CSRF-Token',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
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
    const { to, subject, message } = body;

    if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Valid recipient email is required.' }) };
    }

    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Message is required.' }) };
    }

    const adminEmail = process.env.ADMIN_EMAIL || 'briankabutey10@gmail.com';
    const appPassword = process.env.GMAIL_APP_PASSWORD;

    if (!appPassword) {
      console.error('Email service error: GMAIL_APP_PASSWORD is not configured.');
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Email service not configured.' }),
      };
    }

    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: adminEmail,
        pass: appPassword,
      },
    });

    // Sanitize
    const clean = (str) => (str || '').replace(/<[^>]*>/g, '');

    await transporter.sendMail({
      from: `"Ahuma" <${adminEmail}>`,
      to: clean(to),
      subject: clean(subject) || 'Reply from Ahuma',
      text: clean(message),
      html: `
        <div style="font-family: -apple-system, sans-serif; max-width: 600px;">
          <p style="white-space: pre-wrap;">${clean(message)}</p>
          <hr style="border: 1px solid #eee; margin-top: 24px;">
          <p style="color: #888; font-size: 12px;">Sent from Ahuma's portfolio.</p>
        </div>
      `,
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true }),
    };
  } catch (err) {
    console.error('Reply error:', err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Failed to send reply.' }),
    };
  }
};
