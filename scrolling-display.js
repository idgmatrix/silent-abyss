export class ScrollingDisplay {
    constructor(canvasId) {
        this.canvas = document.getElementById(canvasId);
        this.ctx = this.canvas ? this.canvas.getContext('2d') : null;
        this.tempCanvas = document.createElement('canvas');
        this.tempCtx = this.tempCanvas.getContext('2d');
        this.resize();
        if (this.canvas) {
           window.addEventListener('resize', () => this.resize());
        }
    }

    resize() {
        if (!this.canvas) return;
        const dpr = window.devicePixelRatio || 1;
        this.canvas.width = this.canvas.clientWidth * dpr;
        this.canvas.height = this.canvas.clientHeight * dpr;
        this.tempCanvas.width = this.canvas.width;
        this.tempCanvas.height = this.canvas.height;
    }

    shiftDisplay() {
        if (!this.ctx || !this.canvas) return;

        // Copy current canvas to temp
        this.tempCtx.clearRect(0, 0, this.tempCanvas.width, this.tempCanvas.height);
        this.tempCtx.drawImage(this.canvas, 0, 0);

        // Clear and draw back shifted by 1 pixel down
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        this.ctx.drawImage(this.tempCanvas, 0, 1);
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
