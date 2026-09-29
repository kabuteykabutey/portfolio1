const { getUnifiedStore } = require('./utils/store');

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
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed.' }),
    };
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const { name, email, subject, message } = body;

    // Validate
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Name is required.' }) };
    }
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Valid email is required.' }) };
    }
    if (!subject || typeof subject !== 'string' || subject.trim().length === 0) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Subject is required.' }) };
    }
    if (!message || typeof message !== 'string' || message.trim().length < 10) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Message must be at least 10 characters.' }) };
    }

    // Length limits
    if (name.length > 100 || email.length > 200 || subject.length > 200 || message.length > 5000) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Input exceeds maximum length.' }) };
    }

    // Sanitize
    const clean = (str) => str.trim().replace(/<[^>]*>/g, '');

    const id = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const entry = {
      name: clean(name),
      email: clean(email),
      subject: clean(subject),
      message: clean(message),
      timestamp: new Date().toISOString(),
      read: false,
    };

    const store = getUnifiedStore('messages');
    await store.setJSON(id, entry);

    // Attempt email notification (non-blocking)
    try {
      await sendNotificationEmail(entry);
    } catch (emailErr) {
      console.error('Email notification failed:', emailErr.message);
      // Don't fail the request if email fails
    }

    return {
      statusCode: 201,
      headers,
      body: JSON.stringify({ success: true }),
    };
  } catch (err) {
    console.error('Contact error:', err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Internal server error.' }),
    };
  }
};

async function sendNotificationEmail(entry) {
  const nodemailer = require('nodemailer');

  const appPassword = process.env.GMAIL_APP_PASSWORD;
  const adminEmail = process.env.ADMIN_EMAIL || 'briankabutey10@gmail.com';

  if (!appPassword) {
    console.log('GMAIL_APP_PASSWORD is not configured. Skipping email notification.');
    return;
  }

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: adminEmail,
      pass: appPassword,
    },
  });

  await transporter.sendMail({
    from: `"Portfolio Contact" <${adminEmail}>`,
    to: adminEmail,
    replyTo: entry.email,
    subject: `New message: ${entry.subject}`,
    text: `New contact form submission:\n\nFrom: ${entry.name}\nEmail: ${entry.email}\nSubject: ${entry.subject}\n\nMessage:\n${entry.message}\n\n---\nReply directly to this email to respond to ${entry.name}.`,
    html: `
      <div style="font-family: -apple-system, sans-serif; max-width: 600px;">
        <h2 style="color: #333;">New Contact Form Message</h2>
        <p><strong>From:</strong> ${entry.name}</p>
        <p><strong>Email:</strong> <a href="mailto:${entry.email}">${entry.email}</a></p>
        <p><strong>Subject:</strong> ${entry.subject}</p>
        <hr style="border: 1px solid #eee;">
        <p style="white-space: pre-wrap;">${entry.message}</p>
        <hr style="border: 1px solid #eee;">
        <p style="color: #888; font-size: 12px;">Reply directly to this email to respond to ${entry.name}.</p>
      </div>
    `,
  });
}
