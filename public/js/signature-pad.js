/**
 * Signature Pad - Freehand drawing on canvas for the guestbook.
 * Supports mouse and touch input with smooth line rendering.
 */
(function () {
  'use strict';

  class SignaturePad {
    constructor(canvasEl) {
      this.canvas = canvasEl;
      this.ctx = canvasEl.getContext('2d');
      this.isDrawing = false;
      this.isEmpty = true;
      this.lastPoint = null;
      this.points = [];

      this.strokeColor = '#e8e8ec';
      this.strokeWidth = 2;
      this.minStrokeWidth = 1;
      this.maxStrokeWidth = 3.5;
      this.velocityFilterWeight = 0.7;
      this.lastVelocity = 0;
      this.lastWidth = this.strokeWidth;

      this._resizeCanvas();
      this._bindEvents();
    }

    _resizeCanvas() {
      const rect = this.canvas.parentElement.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      this.canvas.width = rect.width * dpr;
      this.canvas.height = rect.height * dpr;
      this.ctx.scale(dpr, dpr);
      this.ctx.lineCap = 'round';
      this.ctx.lineJoin = 'round';
    }

    _bindEvents() {
      // Mouse
      this.canvas.addEventListener('mousedown', (e) => this._startStroke(e));
      this.canvas.addEventListener('mousemove', (e) => this._continueStroke(e));
      this.canvas.addEventListener('mouseup', () => this._endStroke());
      this.canvas.addEventListener('mouseleave', () => this._endStroke());

      // Touch
      this.canvas.addEventListener('touchstart', (e) => {
        e.preventDefault();
        this._startStroke(e.touches[0]);
      }, { passive: false });
      this.canvas.addEventListener('touchmove', (e) => {
        e.preventDefault();
        this._continueStroke(e.touches[0]);
      }, { passive: false });
      this.canvas.addEventListener('touchend', () => this._endStroke());

      // Resize
      let resizeTimer;
      window.addEventListener('resize', () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
          // Save current image
          const imageData = this.toDataURL();
          this._resizeCanvas();
          // Restore image
          if (!this.isEmpty) {
            const img = new Image();
            img.onload = () => {
              this.ctx.drawImage(img, 0, 0, 
                this.canvas.width / (window.devicePixelRatio || 1),
                this.canvas.height / (window.devicePixelRatio || 1));
            };
            img.src = imageData;
          }
        }, 200);
      });
    }

    _getPoint(e) {
      const rect = this.canvas.getBoundingClientRect();
      return {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
        time: Date.now(),
      };
    }

    _startStroke(e) {
      this.isDrawing = true;
      this.isEmpty = false;
      this.lastPoint = this._getPoint(e);
      this.points = [this.lastPoint];

      // Hide placeholder
      const placeholder = document.getElementById('canvas-placeholder');
      if (placeholder) placeholder.classList.add('hidden');

      // Dispatch custom event
      this.canvas.dispatchEvent(new CustomEvent('signaturestart'));
    }

    _continueStroke(e) {
      if (!this.isDrawing) return;

      const point = this._getPoint(e);
      this.points.push(point);

      // Calculate velocity for pressure simulation
      const dx = point.x - this.lastPoint.x;
      const dy = point.y - this.lastPoint.y;
      const dt = Math.max(point.time - this.lastPoint.time, 1);
      const velocity = Math.sqrt(dx * dx + dy * dy) / dt;

      const filteredVelocity =
        this.velocityFilterWeight * velocity +
        (1 - this.velocityFilterWeight) * this.lastVelocity;

      // Width based on velocity (faster = thinner)
      const newWidth = Math.max(
        this.minStrokeWidth,
        Math.min(this.maxStrokeWidth, this.maxStrokeWidth / (filteredVelocity + 0.5))
      );

      this._drawSegment(this.lastPoint, point, this.lastWidth, newWidth);

      this.lastPoint = point;
      this.lastVelocity = filteredVelocity;
      this.lastWidth = newWidth;
    }

    _drawSegment(start, end, startWidth, endWidth) {
      this.ctx.beginPath();
      this.ctx.moveTo(start.x, start.y);

      // Smooth curve using midpoint
      const midX = (start.x + end.x) / 2;
      const midY = (start.y + end.y) / 2;
      this.ctx.quadraticCurveTo(start.x, start.y, midX, midY);

      this.ctx.strokeStyle = this.strokeColor;
      this.ctx.lineWidth = (startWidth + endWidth) / 2;
      this.ctx.stroke();
    }

    _endStroke() {
      if (!this.isDrawing) return;

      // Draw a dot if it was just a click
      if (this.points.length === 1) {
        const p = this.points[0];
        this.ctx.beginPath();
        this.ctx.arc(p.x, p.y, this.strokeWidth / 2, 0, Math.PI * 2);
        this.ctx.fillStyle = this.strokeColor;
        this.ctx.fill();
      }

      this.isDrawing = false;
      this.lastVelocity = 0;
      this.lastWidth = this.strokeWidth;
      this.points = [];
    }

    clear() {
      const rect = this.canvas.parentElement.getBoundingClientRect();
      this.ctx.clearRect(0, 0, rect.width, rect.height);
      this.isEmpty = true;
      this.lastVelocity = 0;
      this.lastWidth = this.strokeWidth;
      this.points = [];

      const placeholder = document.getElementById('canvas-placeholder');
      if (placeholder) placeholder.classList.remove('hidden');
    }

    toDataURL(type = 'image/png') {
      return this.canvas.toDataURL(type, 0.8);
    }
  }

  // Expose globally
  window.SignaturePad = SignaturePad;
})();
