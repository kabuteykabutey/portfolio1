/**
 * Particle system with connecting dots that repel from the mouse cursor.
 * Particles flee from the pointer, opening a path wherever it moves.
 */
(function () {
  'use strict';

  const canvas = document.getElementById('particle-canvas');
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  let width, height;
  let particles = [];
  let mouse = { x: -1000, y: -1000, active: false };
  let animationId;

  // Configuration - Refined, subtle, and non-distracting constellation network
  const CONFIG = {
    particleCount: getParticleCount(),
    particleRadius: 1.6,
    particleColor: 'rgba(125, 155, 255, 0.55)',
    connectionDistance: 125,
    connectionColor: 'rgba(107, 138, 255, 0.16)',
    repulsionRadius: 150,
    repulsionForce: 8.5,
    returnSpeed: 0.02,
    friction: 0.92,
    drift: 0.16,
    maxSpeed: 3,
  };

  function getParticleCount() {
    const w = window.innerWidth;
    if (w < 480) return 40;
    if (w < 768) return 65;
    if (w < 1200) return 90;
    return 105;
  }

  class Particle {
    constructor() {
      this.x = Math.random() * width;
      this.y = Math.random() * height;
      this.baseX = this.x;
      this.baseY = this.y;
      this.vx = (Math.random() - 0.5) * CONFIG.drift;
      this.vy = (Math.random() - 0.5) * CONFIG.drift;
      this.radius = CONFIG.particleRadius * (0.7 + Math.random() * 0.6);
      this.opacity = 0.3 + Math.random() * 0.35;
    }

    update() {
      // Mouse repulsion - particles gently part to open a path for the pointer
      if (mouse.active) {
        const dx = this.x - mouse.x;
        const dy = this.y - mouse.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < CONFIG.repulsionRadius && dist > 0) {
          const force = (CONFIG.repulsionRadius - dist) / CONFIG.repulsionRadius;
          const angle = Math.atan2(dy, dx);
          const pushX = Math.cos(angle) * force * CONFIG.repulsionForce;
          const pushY = Math.sin(angle) * force * CONFIG.repulsionForce;
          this.vx += pushX;
          this.vy += pushY;
        }
      }

      // Gentle drift back toward base position
      const dxBase = this.baseX - this.x;
      const dyBase = this.baseY - this.y;
      this.vx += dxBase * CONFIG.returnSpeed;
      this.vy += dyBase * CONFIG.returnSpeed;

      // Apply friction
      this.vx *= CONFIG.friction;
      this.vy *= CONFIG.friction;

      // Clamp speed
      const speed = Math.sqrt(this.vx * this.vx + this.vy * this.vy);
      if (speed > CONFIG.maxSpeed) {
        this.vx = (this.vx / speed) * CONFIG.maxSpeed;
        this.vy = (this.vy / speed) * CONFIG.maxSpeed;
      }

      // Update position
      this.x += this.vx;
      this.y += this.vy;

      // Soft boundary wrapping
      if (this.x < -20) this.x = width + 20;
      if (this.x > width + 20) this.x = -20;
      if (this.y < -20) this.y = height + 20;
      if (this.y > height + 20) this.y = -20;
    }

    draw() {
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
      ctx.fillStyle = CONFIG.particleColor;
      ctx.globalAlpha = this.opacity;
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  function init() {
    resize();
    particles = [];
    CONFIG.particleCount = getParticleCount();
    for (let i = 0; i < CONFIG.particleCount; i++) {
      particles.push(new Particle());
    }
  }

  function resize() {
    width = window.innerWidth;
    height = window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = width + 'px';
    canvas.style.height = height + 'px';
    ctx.scale(dpr, dpr);
  }

  function drawConnections() {
    const maxDist = CONFIG.connectionDistance;
    const maxDistSq = maxDist * maxDist;

    for (let i = 0; i < particles.length; i++) {
      for (let j = i + 1; j < particles.length; j++) {
        const dx = particles[i].x - particles[j].x;
        const dy = particles[i].y - particles[j].y;
        const distSq = dx * dx + dy * dy;

        if (distSq < maxDistSq) {
          const dist = Math.sqrt(distSq);
          const ratio = 1 - dist / maxDist;
          ctx.beginPath();
          ctx.moveTo(particles[i].x, particles[i].y);
          ctx.lineTo(particles[j].x, particles[j].y);
          ctx.strokeStyle = CONFIG.connectionColor;
          ctx.globalAlpha = ratio * 0.45;
          ctx.lineWidth = 0.6;
          ctx.stroke();
          ctx.globalAlpha = 1;
        }
      }
    }
  }

  function animate() {
    ctx.clearRect(0, 0, width, height);
    drawConnections();
    for (const p of particles) {
      p.update();
      p.draw();
    }
    animationId = requestAnimationFrame(animate);
  }

  // Event listeners
  function onMouseMove(e) {
    mouse.x = e.clientX;
    mouse.y = e.clientY;
    mouse.active = true;
  }

  function onMouseLeave() {
    mouse.active = false;
    mouse.x = -1000;
    mouse.y = -1000;
  }

  function onTouchMove(e) {
    if (e.touches.length > 0) {
      mouse.x = e.touches[0].clientX;
      mouse.y = e.touches[0].clientY;
      mouse.active = true;
    }
  }

  function onTouchEnd() {
    mouse.active = false;
    mouse.x = -1000;
    mouse.y = -1000;
  }

  let resizeTimeout;
  function onResize() {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
      cancelAnimationFrame(animationId);
      init();
      animate();
    }, 200);
  }

  // Visibility API - pause when tab is hidden
  function onVisibilityChange() {
    if (document.hidden) {
      cancelAnimationFrame(animationId);
    } else {
      animate();
    }
  }

  window.addEventListener('mousemove', onMouseMove, { passive: true });
  window.addEventListener('mouseleave', onMouseLeave);
  window.addEventListener('touchmove', onTouchMove, { passive: true });
  window.addEventListener('touchend', onTouchEnd);
  window.addEventListener('resize', onResize);
  document.addEventListener('visibilitychange', onVisibilityChange);

  init();
  animate();
})();
