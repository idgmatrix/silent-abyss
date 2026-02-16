export class ScrollingDisplay {
    constructor(canvasId) {
        this.canvas = document.getElementById(canvasId);
        this.ctx = this.canvas ? this.canvas.getContext('2d', { alpha: false }) : null;
        this.decayRate = 0.01; // Default
        this._resizeHandler = () => this.resize();
        this.resize();
        if (this.canvas) {
           window.addEventListener('resize', this._resizeHandler);
        }
    }

    setDecayRate(rate) {
        this.decayRate = rate;
    }

    dispose() {
        if (this.canvas) {
            window.removeEventListener('resize', this._resizeHandler);
        }
        this.ctx = null;
        this.canvas = null;
    }

    resize() {
        if (!this.canvas) return;
        const dpr = window.devicePixelRatio || 1;
        const width = this.canvas.clientWidth;
        const height = this.canvas.clientHeight;

        this.canvas.width = width * dpr;
        this.canvas.height = height * dpr;
    }

    shiftDisplay() {
        if (!this.ctx || !this.canvas) return;
        const dpr = window.devicePixelRatio || 1;
        const w = this.canvas.width;
        const h = this.canvas.height;
        const shift = dpr;

        // Efficient self-copy scrolling
        this.ctx.imageSmoothingEnabled = false;
        this.ctx.drawImage(this.canvas, 0, 0, w, h - shift, 0, shift, w, h - shift);

        // Subtle phosphor decay for history
        if (this.decayRate > 0) {
            this.ctx.save();
            this.ctx.globalCompositeOperation = 'source-over';
            this.ctx.fillStyle = `rgba(0, 0, 0, ${this.decayRate})`;
            this.ctx.fillRect(0, shift, w, h - shift);
            this.ctx.restore();
        }

        // Clear the new scan line area completely at the top
        this.ctx.clearRect(0, 0, w, shift);
    }

    // Helper for drawing a single new line at the top (y=0)
    // The callback receives (ctx, width, height) to do the actual drawing
    drawNextLine(drawCallback) {
        if (!this.ctx || !this.canvas) return;

        this.shiftDisplay();

        // Draw the new line at y=0
        this.ctx.save();
        this.ctx.beginPath(); // Reset path to avoid connecting to previous lines
        drawCallback(this.ctx, this.canvas.width, this.canvas.height);
        this.ctx.restore();
    }
}
