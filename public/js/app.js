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
      closeMobileNav();

      // Load page-specific data
      if (page === 'guestbook') loadGuestbookEntries();
      if (page === 'connect') initContactForm();

      // Scroll to top
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }, 200);
  }

  // Handle hash routing
  function handleRoute() {
    const rawHash = (window.location.hash || '').replace(/^#/, '');
    if (!rawHash || rawHash === 'home') {
      navigateTo('home');
      return;
    }

    if (pages.includes(rawHash)) {
      navigateTo(rawHash);
    } else {
      // In-page element anchor (e.g. github-showcase)
      const targetEl = document.getElementById(rawHash);
      if (targetEl) {
        targetEl.scrollIntoView({ behavior: 'smooth' });
      }
    }
  }

  // Initialize on load
  window.addEventListener('hashchange', handleRoute);

  // Mobile nav helpers
  function closeMobileNav() {
    const toggle = document.getElementById('nav-toggle');
    const navLinks = document.getElementById('nav-links');
    const backdrop = document.getElementById('nav-backdrop');
    if (toggle) {
      toggle.classList.remove('open');
      toggle.setAttribute('aria-expanded', 'false');
    }
    if (navLinks) {
      navLinks.classList.remove('open');
    }
    if (backdrop) {
      backdrop.classList.remove('open');
    }
    document.body.style.overflow = '';
  }

  function toggleMobileNav() {
    const toggle = document.getElementById('nav-toggle');
    const navLinks = document.getElementById('nav-links');
    const backdrop = document.getElementById('nav-backdrop');
    if (!toggle || !navLinks) return;
    const isOpen = toggle.classList.toggle('open');
    navLinks.classList.toggle('open', isOpen);
    if (backdrop) {
      backdrop.classList.toggle('open', isOpen);
    }
    toggle.setAttribute('aria-expanded', isOpen);
    document.body.style.overflow = isOpen ? 'hidden' : '';
  }

  // Handle nav clicks
  document.querySelectorAll('[data-page]').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      const page = el.dataset.page;
      closeMobileNav();
      const current = (window.location.hash || '').replace(/^#/, '') || 'home';
      if (current === page) {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      } else {
        window.location.hash = page;
      }
    });
  });

  // Mobile nav toggle
  const navToggle = document.getElementById('nav-toggle');
  if (navToggle) {
    navToggle.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleMobileNav();
    });
  }

  // Mobile nav backdrop dismiss
  const navBackdrop = document.getElementById('nav-backdrop');
  if (navBackdrop) {
    navBackdrop.addEventListener('click', closeMobileNav);
  }

  // Close nav on click outside
  document.addEventListener('click', (e) => {
    const mainNav = document.getElementById('main-nav');
    if (mainNav && !mainNav.contains(e.target)) {
      closeMobileNav();
    }
  });

  // Close nav on Escape key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeMobileNav();
    }
  });

  // Close nav when window resized above mobile breakpoint
  window.addEventListener('resize', () => {
    if (window.innerWidth > 768) {
      closeMobileNav();
    }
  });

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
  // Violin Audio Synthesizer (Web Audio API)
  // ============================
  let audioCtx = null;
  let audioUnlocked = false;

  function initViolinAudio() {
    const board = document.getElementById('violin-board');
    if (!board) return;

    function unlockAudio() {
      if (!audioCtx) {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (AudioContext) {
          audioCtx = new AudioContext();
        }
      }
      if (audioCtx && audioCtx.state === 'suspended') {
        audioCtx.resume().then(() => {
          audioUnlocked = true;
        }).catch(() => {});
      } else if (audioCtx && audioCtx.state === 'running') {
        audioUnlocked = true;
      }
    }

    // Unlock audio context on first explicit user interaction
    window.addEventListener('pointerdown', unlockAudio, { once: true, passive: true });
    window.addEventListener('keydown', unlockAudio, { once: true, passive: true });

    function playNote(freq, itemEl) {
      try {
        unlockAudio();
        if (!audioCtx) return;

        // Animate the physical string regardless of audio state
        itemEl.classList.remove('string-vibrating');
        void itemEl.offsetWidth; // trigger reflow
        itemEl.classList.add('string-vibrating');
        setTimeout(() => itemEl.classList.remove('string-vibrating'), 380);

        if (audioCtx.state !== 'running') {
          audioCtx.resume().then(() => playOscillators(freq)).catch(() => {});
          return;
        }

        playOscillators(freq);
      } catch {
        // Silently handle any browser audio constraints
      }
    }

    function playOscillators(freq) {
      if (!audioCtx || audioCtx.state !== 'running') return;
      const now = audioCtx.currentTime;

      // Master gain for this note
      const masterGain = audioCtx.createGain();
      masterGain.gain.setValueAtTime(0, now);
      masterGain.gain.linearRampToValueAtTime(0.28, now + 0.02);
      masterGain.gain.exponentialRampToValueAtTime(0.001, now + 1.2);

      // Lowpass filter modeling wood body resonance
      const filter = audioCtx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(2200, now);
      filter.Q.setValueAtTime(1.8, now);

      // Fundamental harmonic (Sawtooth for warm string texture)
      const osc1 = audioCtx.createOscillator();
      osc1.type = 'sawtooth';
      osc1.frequency.setValueAtTime(freq, now);

      // 2nd harmonic for brightness
      const osc2 = audioCtx.createOscillator();
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(freq * 2, now);
      const osc2Gain = audioCtx.createGain();
      osc2Gain.gain.setValueAtTime(0.3, now);
      osc2.connect(osc2Gain);

      // Sub harmonic for depth
      const osc3 = audioCtx.createOscillator();
      osc3.type = 'triangle';
      osc3.frequency.setValueAtTime(freq, now);
      const osc3Gain = audioCtx.createGain();
      osc3Gain.gain.setValueAtTime(0.2, now);
      osc3.connect(osc3Gain);

      // Connect graph
      osc1.connect(filter);
      osc2Gain.connect(filter);
      osc3Gain.connect(filter);
      filter.connect(masterGain);
      masterGain.connect(audioCtx.destination);

      osc1.start(now);
      osc2.start(now);
      osc3.start(now);

      osc1.stop(now + 1.2);
      osc2.stop(now + 1.2);
      osc3.stop(now + 1.2);
    }

    board.querySelectorAll('.violin-string-item').forEach((item) => {
      const freq = parseFloat(item.dataset.freq);

      // Explicit clicks and taps are valid user gestures
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        playNote(freq, item);
      });

      item.addEventListener('touchstart', (e) => {
        e.preventDefault();
        e.stopPropagation();
        playNote(freq, item);
      }, { passive: false });

      // Only play on mouseenter if user is actively holding down the mouse button (bowing across)
      item.addEventListener('mouseenter', (e) => {
        if (e.buttons > 0 && audioUnlocked && audioCtx && audioCtx.state === 'running') {
          playNote(freq, item);
        }
      });
    });
  }

  // ============================
  // GitHub Repositories Showcase
  // ============================
  const FALLBACK_REPOS = [
    {
      name: 'portfolio1',
      description: 'Personal portfolio featuring bespoke architecture, native Netlify backend, freehand canvas guestbook, and interactive violin audio synthesis.',
      language: 'JavaScript',
      stars: 0,
      forks: 0,
      url: 'https://github.com/kabuteykabutey/portfolio1',
      updated_at: '2026-09-29T08:33:00Z',
    },
    {
      name: 'Ghana-Revenue-Taxing-System',
      description: 'Algorithmic software solution modeling progressive taxation brackets, income deductions, and automated payroll calculations for Ghana.',
      language: 'Python',
      stars: 0,
      forks: 0,
      url: 'https://github.com/kabuteykabutey/Ghana-Revenue-Taxing-System',
      updated_at: '2025-11-19T12:26:00Z',
    },
    {
      name: 'Students-Registration-Form-SQL',
      description: 'Structured relational SQL database schema and management system for student enrolments, course registrations, and academic tracking.',
      language: 'SQL',
      stars: 0,
      forks: 0,
      url: 'https://github.com/kabuteykabutey/Students-Registration-Form-SQL',
      updated_at: '2025-11-29T08:45:00Z',
    },
    {
      name: 'E-commerce-database-for-products',
      description: 'Relational database schema modeling product inventories, customer transactions, order management, and catalog hierarchies in SQL.',
      language: 'SQL',
      stars: 0,
      forks: 0,
      url: 'https://github.com/kabuteykabutey/E-commerce-database-for-products',
      updated_at: '2025-11-29T16:55:00Z',
    },
    {
      name: 'roadside-rescue',
      description: 'Automotive emergency roadside assistance web application built with TypeScript, modular services, and responsive customer dispatch views.',
      language: 'TypeScript',
      stars: 0,
      forks: 0,
      url: 'https://github.com/kabuteykabutey/roadside-rescue',
      updated_at: '2026-01-17T10:22:00Z',
    },
    {
      name: 'python_assignment',
      description: 'Computer science algorithmic solutions, data structure implementations, and practical computational utilities in Python.',
      language: 'Python',
      stars: 0,
      forks: 0,
      url: 'https://github.com/kabuteykabutey/python_assignment',
      updated_at: '2025-11-14T21:39:00Z',
    },
    {
      name: 'Daily-updates',
      description: 'Automated Python workflow script suite for recurring system notifications, log parsing, and scheduled updates.',
      language: 'Python',
      stars: 0,
      forks: 0,
      url: 'https://github.com/kabuteykabutey/Daily-updates',
      updated_at: '2026-01-06T21:44:00Z',
    },
    {
      name: 'changing-link-addresses-to-QR-codes',
      description: 'Interactive client-side web utility converting dynamic web links and URLs into instantaneous, high-contrast QR matrix codes.',
      language: 'CSS',
      stars: 0,
      forks: 0,
      url: 'https://github.com/kabuteykabutey/changing-link-addresses-to-QR-codes',
      updated_at: '2025-12-16T21:08:00Z',
    },
    {
      name: 'Job-Listings',
      description: 'Employment opportunity and job listing database interface with category filtering, indexing, and role requirements modeling.',
      language: 'SQL',
      stars: 0,
      forks: 0,
      url: 'https://github.com/kabuteykabutey/Job-Listings',
      updated_at: '2025-10-05T22:54:00Z',
    },
    {
      name: 'portfolio',
      description: 'Original portfolio exploration and web interface designs highlighting frontend fundamentals.',
      language: 'JavaScript',
      stars: 0,
      forks: 0,
      url: 'https://github.com/kabuteykabutey/portfolio',
      updated_at: '2026-09-29T07:17:00Z',
    },
    {
      name: 'special-octo-guide',
      description: 'Frontend experimentation and web development learning sandbox demonstrating semantic HTML and layout strategies.',
      language: 'HTML',
      stars: 0,
      forks: 0,
      url: 'https://github.com/kabuteykabutey/special-octo-guide',
      updated_at: '2026-08-26T22:17:00Z',
    },
    {
      name: 'my-portfolio',
      description: 'Foundational developer profile site establishing clean semantic structure and responsive web layouts.',
      language: 'HTML',
      stars: 0,
      forks: 0,
      url: 'https://github.com/kabuteykabutey/my-portfolio',
      updated_at: '2026-01-17T10:45:00Z',
    },
  ];

  const LANG_COLORS = {
    Python: '#3572A5',
    JavaScript: '#f1e05a',
    TypeScript: '#3178c6',
    SQL: '#e38c00',
    HTML: '#e34c26',
    CSS: '#563d7c',
  };

  let allRepos = [...FALLBACK_REPOS];
  let currentFilter = 'all';
  let searchQuery = '';
  let pollInterval = null;

  function calculateTechStacks(repos) {
    // Base stacks Ahuma codes in
    const stacks = new Set(['Python', 'SQL', 'JavaScript', 'React', 'HTML', 'CSS']);

    repos.forEach((repo) => {
      if (repo.language && repo.language !== 'Code') {
        stacks.add(repo.language);
      }
      // Inspect repo names and descriptions for additional tech stacks
      const text = `${repo.name} ${repo.description || ''}`.toLowerCase();
      if (text.includes('react')) stacks.add('React');
      if (text.includes('typescript')) stacks.add('TypeScript');
      if (text.includes('sql') || text.includes('database')) stacks.add('SQL');
      if (text.includes('node')) stacks.add('Node.js');
    });

    return stacks.size;
  }

  function updateMetrics(repos, userProfile) {
    const totalRepos = (userProfile && typeof userProfile.public_repos === 'number' && userProfile.public_repos >= repos.length)
      ? userProfile.public_repos
      : repos.length;

    const countEl = document.getElementById('stat-repos-count');
    const countAll = document.getElementById('count-all');
    const stacksEl = document.getElementById('stat-stacks-count');

    if (countEl) countEl.textContent = totalRepos;
    if (countAll) countAll.textContent = totalRepos;

    const totalStacks = calculateTechStacks(repos);
    if (stacksEl) stacksEl.textContent = `${totalStacks}+`;
  }

  function initGitHubRepos() {
    const grid = document.getElementById('repos-grid');
    const searchInput = document.getElementById('repo-search');
    const filterContainer = document.getElementById('repo-filters');
    const exploreBtn = document.getElementById('btn-explore-repos');

    if (!grid) return;

    // Load any cached data from localStorage for instant 0ms render
    try {
      const cached = localStorage.getItem('ahuma_github_cache');
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed.repos) && parsed.repos.length > 0) {
          allRepos = parsed.repos;
          updateMetrics(allRepos, parsed.user);
        }
      }
    } catch {}

    // Smooth scroll from hero button to repos showcase
    if (exploreBtn) {
      exploreBtn.addEventListener('click', (e) => {
        e.preventDefault();
        const section = document.getElementById('github-showcase');
        if (section) {
          section.scrollIntoView({ behavior: 'smooth' });
        }
      });
    }

    // Render initial repos and initial metrics
    renderRepos();
    updateMetrics(allRepos, null);

    // Fetch live repos from GitHub API immediately
    fetchGitHubRepos();

    // Constantly keep updating: poll GitHub API every 45 seconds
    if (!pollInterval) {
      pollInterval = setInterval(fetchGitHubRepos, 45000);
    }

    // Also fetch immediately when user returns to the tab
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) {
        fetchGitHubRepos();
      }
    });

    // Search filter
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        searchQuery = e.target.value.toLowerCase().trim();
        renderRepos();
      });
    }

    // Category pills
    if (filterContainer) {
      filterContainer.querySelectorAll('.filter-pill').forEach((btn) => {
        btn.addEventListener('click', () => {
          filterContainer.querySelectorAll('.filter-pill').forEach((b) => b.classList.remove('active'));
          btn.classList.add('active');
          currentFilter = btn.dataset.filter;
          renderRepos();
        });
      });
    }
  }

  async function fetchGitHubRepos() {
    try {
      // Fetch both repositories and user profile in parallel
      const [reposRes, userRes] = await Promise.allSettled([
        fetch('https://api.github.com/users/kabuteykabutey/repos?sort=updated&per_page=100'),
        fetch('https://api.github.com/users/kabuteykabutey')
      ]);

      let userProfile = null;
      if (userRes.status === 'fulfilled' && userRes.value.ok) {
        userProfile = await userRes.value.json();
      }

      if (reposRes.status === 'fulfilled' && reposRes.value.ok) {
        const data = await reposRes.value.json();
        if (Array.isArray(data) && data.length > 0) {
          const fallbackMap = new Map(FALLBACK_REPOS.map((r) => [r.name.toLowerCase(), r]));

          allRepos = data.map((item) => {
            const fb = fallbackMap.get(item.name.toLowerCase());
            let detectedLang = item.language;
            if (!detectedLang && (item.name.includes('SQL') || item.name.includes('database') || item.name.includes('Listings'))) {
              detectedLang = 'SQL';
            }
            if (!detectedLang && fb) {
              detectedLang = fb.language;
            }

            return {
              name: item.name,
              description: item.description || (fb ? fb.description : 'Open source project by Ahuma.'),
              language: detectedLang || 'Code',
              stars: item.stargazers_count || 0,
              forks: item.forks_count || 0,
              url: item.html_url,
              updated_at: item.updated_at,
            };
          });

          // Cache fresh data in localStorage
          try {
            localStorage.setItem('ahuma_github_cache', JSON.stringify({
              repos: allRepos,
              user: userProfile,
              time: Date.now()
            }));
          } catch {}

          // Update metrics (repo count and tech stacks count)
          updateMetrics(allRepos, userProfile);

          // Re-render
          renderRepos();
        }
      } else if (userProfile) {
        updateMetrics(allRepos, userProfile);
      }
    } catch {
      // Gracefully continue using current state
    }
  }

  function renderRepos() {
    const grid = document.getElementById('repos-grid');
    if (!grid) return;

    let filtered = allRepos;

    // Apply category filter
    if (currentFilter !== 'all') {
      if (currentFilter === 'SQL') {
        filtered = filtered.filter((r) => r.language === 'SQL' || r.name.toLowerCase().includes('sql') || r.name.toLowerCase().includes('database'));
      } else if (currentFilter === 'JavaScript') {
        filtered = filtered.filter((r) => r.language === 'JavaScript' || r.language === 'TypeScript');
      } else if (currentFilter === 'HTML') {
        filtered = filtered.filter((r) => r.language === 'HTML' || r.language === 'CSS');
      } else {
        filtered = filtered.filter((r) => (r.language || '').toLowerCase() === currentFilter.toLowerCase());
      }
    }

    // Apply search query
    if (searchQuery) {
      filtered = filtered.filter((r) =>
        r.name.toLowerCase().includes(searchQuery) ||
        (r.description && r.description.toLowerCase().includes(searchQuery)) ||
        (r.language && r.language.toLowerCase().includes(searchQuery))
      );
    }

    if (filtered.length === 0) {
      grid.innerHTML = `
        <div class="repo-empty-match">
          <p>No repositories found matching "<strong>${Security.escapeHtml(searchQuery)}</strong>".</p>
        </div>
      `;
      return;
    }

    grid.innerHTML = filtered.map((repo, idx) => {
      const color = LANG_COLORS[repo.language] || '#6b8aff';
      const cleanName = Security.escapeHtml(repo.name);
      const cleanDesc = Security.escapeHtml(repo.description || 'Open source project repository.');
      const cleanLang = Security.escapeHtml(repo.language || 'Code');
      const dateText = formatDate(repo.updated_at);

      return `
        <article class="repo-card" style="animation: fadeUp 0.4s var(--ease-out) ${idx * 0.04}s forwards;">
          <div>
            <div class="repo-top">
              <div class="repo-folder-icon" aria-hidden="true">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                </svg>
              </div>
              <a href="${Security.escapeHtml(repo.url)}" target="_blank" rel="noopener noreferrer" class="repo-external-link" title="Open ${cleanName} on GitHub" aria-label="Open ${cleanName} repository on GitHub">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M7 17L17 7M17 7H7M17 7v10"/>
                </svg>
              </a>
            </div>
            <h3 class="repo-title">
              <a href="${Security.escapeHtml(repo.url)}" target="_blank" rel="noopener noreferrer">${cleanName}</a>
            </h3>
            <p class="repo-desc">${cleanDesc}</p>
          </div>

          <div class="repo-footer">
            <div class="repo-lang">
              <span class="repo-lang-dot" style="background-color: ${color};"></span>
              <span>${cleanLang}</span>
            </div>
            <div class="repo-meta">
              ${repo.stars > 0 ? `
                <span class="repo-meta-item" title="${repo.stars} star${repo.stars !== 1 ? 's' : ''}">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
                  </svg>
                  ${repo.stars}
                </span>` : ''}
              ${repo.forks > 0 ? `
                <span class="repo-meta-item" title="${repo.forks} fork${repo.forks !== 1 ? 's' : ''}">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <circle cx="12" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><circle cx="18" cy="6" r="3"/>
                    <path d="M18 9v1a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V9"/><path d="M12 12v3"/>
                  </svg>
                  ${repo.forks}
                </span>` : ''}
              <span class="repo-date">${dateText}</span>
            </div>
          </div>
        </article>
      `;
    }).join('');
  }

  // ============================
  // Initialize
  // ============================
  function init() {
    // Set initial page
    const hash = window.location.hash.slice(1) || 'home';
    const initialPage = pages.includes(hash) ? hash : 'home';

    // Deactivate all pages first
    pages.forEach((p) => {
      const el = document.getElementById(`page-${p}`);
      if (el) {
        el.classList.remove('active', 'visible');
      }
    });

    const section = document.getElementById(`page-${initialPage}`);
    if (section) {
      section.classList.add('active');
      requestAnimationFrame(() => {
        section.classList.add('visible');
      });
    }

    currentPage = initialPage;
    window.scrollTo(0, 0);

    // Update nav
    document.querySelectorAll('.nav-link').forEach((link) => {
      link.classList.toggle('active', link.dataset.page === initialPage);
    });

    // Init components
    initSignaturePad();
    initContactForm();
    initAdmin();
    initViolinAudio();
    initGitHubRepos();

    if (initialPage === 'guestbook') loadGuestbookEntries();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
