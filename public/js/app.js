/**
 * Main application - SPA routing, form handling, admin dashboard, API calls.
 */
(function () {
  'use strict';

  // ============================
  // Security Utilities
  // ============================
  const Security = {
    escapeHtml(str) {
      const div = document.createElement('div');
      div.textContent = str;
      return div.innerHTML;
    },

    sanitizeInput(str) {
      if (typeof str !== 'string') return '';
      return str.trim().replace(/<[^>]*>/g, '');
    },

    generateToken() {
      const arr = new Uint8Array(32);
      crypto.getRandomValues(arr);
      return Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('');
    },

    validateEmail(email) {
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    },

    rateLimiter(maxAttempts, windowMs) {
      const attempts = [];
      return function () {
        const now = Date.now();
        while (attempts.length && attempts[0] < now - windowMs) {
          attempts.shift();
        }
        if (attempts.length >= maxAttempts) return false;
        attempts.push(now);
        return true;
      };
    },
  };

  // Rate limiters
  const contactRateLimit = Security.rateLimiter(3, 60000); // 3 per minute
  const guestbookRateLimit = Security.rateLimiter(5, 60000); // 5 per minute
  const loginRateLimit = Security.rateLimiter(5, 300000); // 5 per 5 minutes

  // CSRF token
  const csrfToken = Security.generateToken();
  const csrfInput = document.getElementById('csrf-token');
  if (csrfInput) csrfInput.value = csrfToken;

  // ============================
  // API Helper
  // ============================
  async function api(endpoint, options = {}) {
    const defaults = {
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrfToken,
      },
    };

    const token = sessionStorage.getItem('admin_token');
    if (token) {
      defaults.headers['Authorization'] = `Bearer ${token}`;
    }

    const config = { ...defaults, ...options };
    if (options.headers) {
      config.headers = { ...defaults.headers, ...options.headers };
    }

    const response = await fetch(`/api/${endpoint}`, config);
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || `Request failed (${response.status})`);
    }

    return data;
  }

  // ============================
  // SPA Router
  // ============================
  const pages = ['home', 'about', 'guestbook', 'connect', 'admin'];
  let currentPage = 'home';

  function navigateTo(page) {
    if (!pages.includes(page)) page = 'home';
    if (page === currentPage) return;

    const oldSection = document.getElementById(`page-${currentPage}`);
    const newSection = document.getElementById(`page-${page}`);
    if (!oldSection || !newSection) return;

    // Fade out current
    oldSection.classList.remove('visible');

    setTimeout(() => {
      oldSection.classList.remove('active');
      newSection.classList.add('active');

      // Trigger reflow
      void newSection.offsetHeight;

      // Fade in new
      requestAnimationFrame(() => {
        newSection.classList.add('visible');
      });

      // Update nav
      document.querySelectorAll('.nav-link').forEach((link) => {
        link.classList.toggle('active', link.dataset.page === page);
      });

      currentPage = page;

      // Close mobile nav
      const toggle = document.getElementById('nav-toggle');
      const navLinks = document.getElementById('nav-links');
      if (toggle && navLinks) {
        toggle.classList.remove('open');
        navLinks.classList.remove('open');
        toggle.setAttribute('aria-expanded', 'false');
        document.body.style.overflow = '';
      }

      // Load page-specific data
      if (page === 'guestbook') loadGuestbookEntries();
      if (page === 'connect') initContactForm();

      // Scroll to top
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }, 200);
  }

  // Handle hash routing
  function handleRoute() {
    const hash = window.location.hash.slice(1) || 'home';
    navigateTo(hash);
  }

  // Initialize on load
  window.addEventListener('hashchange', handleRoute);

  // Handle nav clicks
  document.querySelectorAll('[data-page]').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      const page = el.dataset.page;
      window.location.hash = page;
    });
  });

  // Mobile nav toggle
  const navToggle = document.getElementById('nav-toggle');
  const navLinks = document.getElementById('nav-links');
  if (navToggle && navLinks) {
    navToggle.addEventListener('click', () => {
      const isOpen = navToggle.classList.toggle('open');
      navLinks.classList.toggle('open');
      navToggle.setAttribute('aria-expanded', isOpen);
      document.body.style.overflow = isOpen ? 'hidden' : '';
    });
  }

  // ============================
  // Signature Pad
  // ============================
  let signaturePad = null;

  function initSignaturePad() {
    const canvas = document.getElementById('signature-canvas');
    if (!canvas || signaturePad) return;
    signaturePad = new window.SignaturePad(canvas);

    document.getElementById('clear-signature')?.addEventListener('click', () => {
      signaturePad.clear();
    });

    document.getElementById('submit-signature')?.addEventListener('click', submitSignature);
  }

  async function submitSignature() {
    if (!guestbookRateLimit()) {
      showStatus(null, 'Too many attempts. Please wait a moment.', 'error', 'guestbook-form-area');
      return;
    }

    const nameInput = document.getElementById('guest-name');
    const name = Security.sanitizeInput(nameInput?.value || '');

    if (!name) {
      nameInput?.focus();
      nameInput?.classList.add('error');
      return;
    }

    if (signaturePad?.isEmpty) {
      showStatus(null, 'Please draw your signature above.', 'error', 'guestbook-form-area');
      return;
    }

    const submitBtn = document.getElementById('submit-signature');
    if (submitBtn) submitBtn.disabled = true;

    try {
      const signature = signaturePad.toDataURL();

      await api('guestbook', {
        method: 'POST',
        body: JSON.stringify({
          name: name,
          signature: signature,
          timestamp: new Date().toISOString(),
        }),
      });

      // Reset form
      nameInput.value = '';
      nameInput.classList.remove('error');
      signaturePad.clear();

      showStatus(null, 'Thanks for signing the guestbook!', 'success', 'guestbook-form-area');
      loadGuestbookEntries();
    } catch (err) {
      showStatus(null, err.message || 'Failed to save signature.', 'error', 'guestbook-form-area');
    } finally {
      if (submitBtn) submitBtn.disabled = false;
    }
  }

  async function loadGuestbookEntries() {
    const list = document.getElementById('entries-list');
    const countEl = document.getElementById('entries-count');
    const loading = document.getElementById('guestbook-loading');
    const empty = document.getElementById('guestbook-empty');

    if (!list) return;

    try {
      const data = await api('guestbook');
      const entries = data.entries || [];

      if (loading) loading.style.display = 'none';

      if (entries.length === 0) {
        if (empty) empty.style.display = 'block';
        if (countEl) countEl.textContent = '';
        return;
      }

      if (empty) empty.style.display = 'none';
      if (countEl) countEl.textContent = `${entries.length} signature${entries.length !== 1 ? 's' : ''}`;

      // Clear existing entries (keep loading/empty divs)
      const existingCards = list.querySelectorAll('.entry-card');
      existingCards.forEach((card) => card.remove());

      entries
        .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
        .forEach((entry, index) => {
          const card = document.createElement('div');
          card.className = 'entry-card';
          card.style.animationDelay = `${index * 0.05}s`;
          card.innerHTML = `
            <div class="entry-signature">
              <img src="${Security.escapeHtml(entry.signature)}" 
                   alt="Signature by ${Security.escapeHtml(entry.name)}" 
                   loading="lazy">
            </div>
            <div class="entry-info">
              <span class="entry-name">${Security.escapeHtml(entry.name)}</span>
              <span class="entry-date">${formatDate(entry.timestamp)}</span>
            </div>
          `;
          list.appendChild(card);
        });
    } catch (err) {
      if (loading) loading.textContent = 'Could not load signatures.';
    }
  }

  // ============================
  // Contact Form
  // ============================
  function initContactForm() {
    const form = document.getElementById('contact-form');
    if (!form || form.dataset.initialized) return;
    form.dataset.initialized = 'true';

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      await submitContactForm(form);
    });

    // Clear errors on input
    form.querySelectorAll('.form-input').forEach((input) => {
      input.addEventListener('input', () => {
        input.classList.remove('error');
        const errorEl = document.getElementById(`error-${input.name}`);
        if (errorEl) errorEl.textContent = '';
      });
    });
  }

  async function submitContactForm(form) {
    const status = document.getElementById('form-status');
    const submitBtn = document.getElementById('contact-submit');

    // Honeypot check
    const honeypot = document.getElementById('contact-website');
    if (honeypot && honeypot.value) return;

    if (!contactRateLimit()) {
      showFormStatus(status, 'Too many attempts. Please wait a minute.', 'error');
      return;
    }

    // Gather and validate
    const fields = {
      name: Security.sanitizeInput(form.querySelector('#contact-name')?.value),
      email: Security.sanitizeInput(form.querySelector('#contact-email')?.value),
      subject: Security.sanitizeInput(form.querySelector('#contact-subject')?.value),
      message: Security.sanitizeInput(form.querySelector('#contact-message')?.value),
    };

    let hasError = false;

    if (!fields.name) {
      setFieldError('name', 'Name is required.');
      hasError = true;
    }
    if (!fields.email || !Security.validateEmail(fields.email)) {
      setFieldError('email', 'A valid email is required.');
      hasError = true;
    }
    if (!fields.subject) {
      setFieldError('subject', 'Subject is required.');
      hasError = true;
    }
    if (!fields.message || fields.message.length < 10) {
      setFieldError('message', 'Message must be at least 10 characters.');
      hasError = true;
    }

    if (hasError) return;

    // Show loading
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.querySelector('.btn-text').style.display = 'none';
      submitBtn.querySelector('.btn-loader').style.display = 'inline';
    }

    try {
      await api('contact', {
        method: 'POST',
        body: JSON.stringify(fields),
      });

      showFormStatus(status, 'Message sent. I\'ll get back to you soon.', 'success');
      form.reset();
    } catch (err) {
      showFormStatus(status, err.message || 'Failed to send. Please try again.', 'error');
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.querySelector('.btn-text').style.display = 'inline';
        submitBtn.querySelector('.btn-loader').style.display = 'none';
      }
    }
  }

  function setFieldError(name, message) {
    const input = document.querySelector(`#contact-${name}`);
    const errorEl = document.getElementById(`error-${name}`);
    if (input) input.classList.add('error');
    if (errorEl) errorEl.textContent = message;
  }

  // ============================
  // Admin
  // ============================
  let adminToken = sessionStorage.getItem('admin_token');

  function initAdmin() {
    const loginForm = document.getElementById('admin-login-form');
    if (loginForm) {
      loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        await adminLogin();
      });
    }

    document.getElementById('admin-logout')?.addEventListener('click', adminLogout);

    // Tab switching
    document.querySelectorAll('.admin-tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        const target = tab.dataset.tab;
        document.querySelectorAll('.admin-tab').forEach((t) => t.classList.remove('active'));
        document.querySelectorAll('.admin-tab-content').forEach((c) => {
          c.classList.remove('active');
          c.style.display = 'none';
        });
        tab.classList.add('active');
        const content = document.getElementById(`admin-tab-${target}`);
        if (content) {
          content.style.display = 'block';
          content.classList.add('active');
        }
        if (target === 'messages') loadAdminMessages();
        if (target === 'guestbook-admin') loadAdminGuestbook();
      });
    });

    // Reply modal
    document.getElementById('reply-modal-close')?.addEventListener('click', closeReplyModal);
    document.getElementById('reply-cancel')?.addEventListener('click', closeReplyModal);
    document.querySelector('.modal-backdrop')?.addEventListener('click', closeReplyModal);
    document.getElementById('reply-send')?.addEventListener('click', sendReply);

    // Check if already authenticated
    if (adminToken) {
      showAdminDashboard();
    }
  }

  async function adminLogin() {
    const status = document.getElementById('admin-login-status');
    const btn = document.getElementById('admin-login-btn');

    if (!loginRateLimit()) {
      showFormStatus(status, 'Too many attempts. Try again in 5 minutes.', 'error');
      return;
    }

    const email = Security.sanitizeInput(document.getElementById('admin-email')?.value);
    const password = document.getElementById('admin-password')?.value;

    if (!email || !password) {
      showFormStatus(status, 'Both fields are required.', 'error');
      return;
    }

    if (btn) {
      btn.disabled = true;
      btn.querySelector('.btn-text').style.display = 'none';
      btn.querySelector('.btn-loader').style.display = 'inline';
    }

    try {
      const data = await api('admin-login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });

      adminToken = data.token;
      sessionStorage.setItem('admin_token', adminToken);
      showAdminDashboard();
    } catch (err) {
      showFormStatus(status, err.message || 'Authentication failed.', 'error');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.querySelector('.btn-text').style.display = 'inline';
        btn.querySelector('.btn-loader').style.display = 'none';
      }
    }
  }

  function adminLogout() {
    adminToken = null;
    sessionStorage.removeItem('admin_token');
    document.getElementById('admin-login-view').style.display = 'block';
    document.getElementById('admin-dashboard-view').style.display = 'none';
    document.getElementById('admin-email').value = '';
    document.getElementById('admin-password').value = '';
    showFormStatus(document.getElementById('admin-login-status'), '', '');
  }

  function showAdminDashboard() {
    document.getElementById('admin-login-view').style.display = 'none';
    document.getElementById('admin-dashboard-view').style.display = 'block';
    loadAdminMessages();
  }

  async function loadAdminMessages() {
    const list = document.getElementById('admin-messages-list');
    if (!list) return;

    list.innerHTML = '<div class="loading-state">Loading messages...</div>';

    try {
      const data = await api('admin-messages');
      const messages = data.messages || [];

      if (messages.length === 0) {
        list.innerHTML = '<div class="empty-state">No messages yet.</div>';
        return;
      }

      list.innerHTML = '';
      messages
        .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
        .forEach((msg) => {
          const card = document.createElement('div');
          card.className = 'message-card';
          card.innerHTML = `
            <div class="message-header">
              <div>
                <div class="message-from">${Security.escapeHtml(msg.name)}</div>
                <div class="message-email">${Security.escapeHtml(msg.email)}</div>
              </div>
              <div class="message-date">${formatDate(msg.timestamp)}</div>
            </div>
            <div class="message-subject">${Security.escapeHtml(msg.subject)}</div>
            <div class="message-body">${Security.escapeHtml(msg.message)}</div>
            <div class="message-actions">
              <button class="btn btn-primary btn-sm reply-btn" 
                      data-email="${Security.escapeHtml(msg.email)}" 
                      data-name="${Security.escapeHtml(msg.name)}"
                      data-subject="${Security.escapeHtml(msg.subject)}">
                Reply
              </button>
              <button class="btn btn-danger btn-sm delete-msg-btn" data-id="${Security.escapeHtml(msg.id)}">
                Delete
              </button>
            </div>
          `;
          list.appendChild(card);
        });

      // Bind reply buttons
      list.querySelectorAll('.reply-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          openReplyModal(btn.dataset.email, btn.dataset.name, btn.dataset.subject);
        });
      });

      // Bind delete buttons
      list.querySelectorAll('.delete-msg-btn').forEach((btn) => {
        btn.addEventListener('click', async () => {
          if (confirm('Delete this message?')) {
            try {
              await api('admin-messages', {
                method: 'DELETE',
                body: JSON.stringify({ id: btn.dataset.id }),
              });
              loadAdminMessages();
            } catch (err) {
              alert('Failed to delete: ' + err.message);
            }
          }
        });
      });
    } catch (err) {
      if (err.message.includes('401') || err.message.includes('Unauthorized')) {
        adminLogout();
      }
      list.innerHTML = '<div class="empty-state">Failed to load messages.</div>';
    }
  }

  async function loadAdminGuestbook() {
    const list = document.getElementById('admin-guestbook-list');
    if (!list) return;

    list.innerHTML = '<div class="loading-state">Loading entries...</div>';

    try {
      const data = await api('guestbook');
      const entries = data.entries || [];

      if (entries.length === 0) {
        list.innerHTML = '<div class="empty-state">No guestbook entries.</div>';
        return;
      }

      list.innerHTML = '';
      entries
        .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
        .forEach((entry) => {
          const card = document.createElement('div');
          card.className = 'message-card';
          card.innerHTML = `
            <div class="message-header">
              <div class="message-from">${Security.escapeHtml(entry.name)}</div>
              <div class="message-date">${formatDate(entry.timestamp)}</div>
            </div>
            <div class="entry-signature" style="margin-top: 0.5rem; width: 200px; height: 80px;">
              <img src="${Security.escapeHtml(entry.signature)}" 
                   alt="Signature" loading="lazy" 
                   style="width:100%;height:100%;object-fit:contain;">
            </div>
            <div class="message-actions">
              <button class="btn btn-danger btn-sm delete-entry-btn" data-id="${Security.escapeHtml(entry.id)}">
                Delete
              </button>
            </div>
          `;
          list.appendChild(card);
        });

      list.querySelectorAll('.delete-entry-btn').forEach((btn) => {
        btn.addEventListener('click', async () => {
          if (confirm('Delete this guestbook entry?')) {
            try {
              await api('admin-guestbook-delete', {
                method: 'DELETE',
                body: JSON.stringify({ id: btn.dataset.id }),
              });
              loadAdminGuestbook();
            } catch (err) {
              alert('Failed to delete: ' + err.message);
            }
          }
        });
      });
    } catch (err) {
      list.innerHTML = '<div class="empty-state">Failed to load entries.</div>';
    }
  }

  // Reply modal
  let replyEmail = '';

  function openReplyModal(email, name, subject) {
    replyEmail = email;
    const modal = document.getElementById('reply-modal');
    const info = document.getElementById('reply-to-info');
    const subjectInput = document.getElementById('reply-subject');

    if (info) info.textContent = `Replying to ${name} (${email})`;
    if (subjectInput) subjectInput.value = `Re: ${subject}`;
    if (modal) modal.style.display = 'flex';
  }

  function closeReplyModal() {
    const modal = document.getElementById('reply-modal');
    if (modal) modal.style.display = 'none';
    document.getElementById('reply-message').value = '';
    document.getElementById('reply-status').textContent = '';
    replyEmail = '';
  }

  async function sendReply() {
    const subject = document.getElementById('reply-subject')?.value;
    const message = document.getElementById('reply-message')?.value;
    const status = document.getElementById('reply-status');
    const sendBtn = document.getElementById('reply-send');

    if (!message?.trim()) {
      showFormStatus(status, 'Please write a message.', 'error');
      return;
    }

    if (sendBtn) sendBtn.disabled = true;

    try {
      await api('admin-reply', {
        method: 'POST',
        body: JSON.stringify({
          to: replyEmail,
          subject: subject,
          message: message,
        }),
      });

      showFormStatus(status, 'Reply sent.', 'success');
      setTimeout(closeReplyModal, 1500);
    } catch (err) {
      showFormStatus(status, err.message || 'Failed to send reply.', 'error');
    } finally {
      if (sendBtn) sendBtn.disabled = false;
    }
  }

  // ============================
  // Utilities
  // ============================
  function formatDate(dateStr) {
    try {
      const date = new Date(dateStr);
      const now = new Date();
      const diff = now - date;

      if (diff < 60000) return 'just now';
      if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
      if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
      if (diff < 604800000) return `${Math.floor(diff / 86400000)}d ago`;

      return date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
      });
    } catch {
      return '';
    }
  }

  function showFormStatus(el, message, type) {
    if (!el) return;
    el.textContent = message;
    el.className = 'form-status ' + type;
  }

  function showStatus(el, message, type, parentId) {
    // Find or create a status element within the parent
    const parent = parentId ? document.querySelector(`.${parentId}`) : el?.parentElement;
    if (!parent) return;

    let statusEl = parent.querySelector('.inline-status');
    if (!statusEl) {
      statusEl = document.createElement('div');
      statusEl.className = 'inline-status form-status';
      parent.appendChild(statusEl);
    }

    statusEl.textContent = message;
    statusEl.className = 'inline-status form-status ' + type;

    if (type === 'success') {
      setTimeout(() => {
        statusEl.textContent = '';
        statusEl.className = 'inline-status form-status';
      }, 4000);
    }
  }

  // ============================
  // Initialize
  // ============================
  function init() {
    // Set initial page
    const hash = window.location.hash.slice(1) || 'home';
    const initialPage = pages.includes(hash) ? hash : 'home';

    const section = document.getElementById(`page-${initialPage}`);
    if (section) {
      section.classList.add('active');
      requestAnimationFrame(() => {
        section.classList.add('visible');
      });
    }

    currentPage = initialPage;

    // Update nav
    document.querySelectorAll('.nav-link').forEach((link) => {
      link.classList.toggle('active', link.dataset.page === initialPage);
    });

    // Init components
    initSignaturePad();
    initContactForm();
    initAdmin();

    if (initialPage === 'guestbook') loadGuestbookEntries();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
