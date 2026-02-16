export class ScrollingDisplay {
    constructor(canvasId) {
        this.canvas = document.getElementById(canvasId);
        this.ctx = this.canvas ? this.canvas.getContext('2d') : null;
        this.tempCanvas = document.createElement('canvas');
        this.tempCtx = this.tempCanvas.getContext('2d');
        this._resizeHandler = () => this.resize();
        this.resize();
        if (this.canvas) {
           window.addEventListener('resize', this._resizeHandler);
        }
    }

    dispose() {
        if (this.canvas) {
            window.removeEventListener('resize', this._resizeHandler);
        }
        this.ctx = null;
        this.tempCtx = null;
        this.canvas = null;
        this.tempCanvas = null;
    }

    resize() {
        if (!this.canvas) return;
        const dpr = window.devicePixelRatio || 1;
        const width = this.canvas.clientWidth;
        const height = this.canvas.clientHeight;

        this.canvas.width = width * dpr;
        this.canvas.height = height * dpr;
        this.tempCanvas.width = width * dpr;
        this.tempCanvas.height = height * dpr;
    }

    shiftDisplay() {
        if (!this.ctx || !this.canvas) return;
        const dpr = window.devicePixelRatio || 1;

        // Copy current canvas to temp
        this.tempCtx.clearRect(0, 0, this.tempCanvas.width, this.tempCanvas.height);
        this.tempCtx.drawImage(this.canvas, 0, 0);

        // Clear and draw back shifted by 1 pixel down (scaled by dpr)
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        this.ctx.drawImage(this.tempCanvas, 0, dpr);
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
