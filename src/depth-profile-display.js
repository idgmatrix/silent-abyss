function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

export class DepthProfileDisplay {
    constructor(environment) {
        this.environment = environment;
        this.canvas = null;
        this.ctx = null;
        this.depthStep = 25;
    }

    init(canvasId) {
        this.canvas = document.getElementById(canvasId);
        if (!this.canvas) return;
        this.ctx = this.canvas.getContext('2d');
        this.resize();
    }

    resize() {
        if (!this.canvas || !this.ctx) return;
        const rect = this.canvas.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        this.canvas.width = Math.max(1, Math.floor(rect.width * dpr));
        this.canvas.height = Math.max(1, Math.floor(rect.height * dpr));
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    render(options = {}) {
        if (!this.ctx || !this.canvas || !this.environment) return;
        const dpr = window.devicePixelRatio || 1;
        const expectedWidth = Math.max(1, Math.floor(this.canvas.clientWidth * dpr));
        const expectedHeight = Math.max(1, Math.floor(this.canvas.clientHeight * dpr));
        if (this.canvas.width !== expectedWidth || this.canvas.height !== expectedHeight) {
            this.resize();
        }

        const width = this.canvas.clientWidth;
        const height = this.canvas.clientHeight;
        const ctx = this.ctx;

        ctx.clearRect(0, 0, width, height);
        ctx.fillStyle = '#00101a';
        ctx.fillRect(0, 0, width, height);

        const maxDepth = options.maxDepth || 250;
        const samples = this.environment.sampleWaterColumn(this.depthStep, maxDepth);
        const tempMin = Math.min(...samples.map((s) => s.temperature));
        const tempMax = Math.max(...samples.map((s) => s.temperature));
        const speedMin = Math.min(...samples.map((s) => s.soundSpeed));
        const speedMax = Math.max(...samples.map((s) => s.soundSpeed));

        const toY = (depth) => clamp((depth / maxDepth) * height, 0, height);
        const normalize = (value, min, max) => {
            if (max === min) return 0.5;
            return clamp((value - min) / (max - min), 0, 1);
        };

        const ductDepth = this.environment.currentProfile.surfaceDuctDepth;
        const thermocline = this.environment.currentProfile.thermoclineDepth;

        ctx.fillStyle = 'rgba(0, 140, 170, 0.16)';
        ctx.fillRect(0, 0, width, toY(ductDepth));

        ctx.strokeStyle = 'rgba(255, 160, 70, 0.7)';
        ctx.setLineDash([3, 2]);
        ctx.beginPath();
        ctx.moveTo(0, toY(thermocline));
        ctx.lineTo(width, toY(thermocline));
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.lineWidth = 1.2;
        ctx.strokeStyle = '#ffcc66';
        ctx.beginPath();
        samples.forEach((sample, index) => {
            const x = 4 + normalize(sample.temperature, tempMin, tempMax) * ((width * 0.46) - 8);
            const y = toY(sample.depth);
            if (index === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        });
        ctx.stroke();

        ctx.strokeStyle = '#66e3ff';
        ctx.beginPath();
        samples.forEach((sample, index) => {
            const x = width * 0.52 + normalize(sample.soundSpeed, speedMin, speedMax) * ((width * 0.46) - 8);
            const y = toY(sample.depth);
            if (index === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        });
        ctx.stroke();

        ctx.fillStyle = '#5ca9b8';
        ctx.font = '8px monospace';
        for (let d = 0; d <= maxDepth; d += 50) {
            const y = toY(d);
            ctx.fillText(String(d), 1, Math.max(8, y - 1));
        }

        const ownDepth = options.ownDepth;
        const targetDepth = options.targetDepth;
        if (Number.isFinite(ownDepth)) {
            const y = toY(ownDepth);
            ctx.strokeStyle = '#00ff99';
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(width, y);
            ctx.stroke();
        }

        if (Number.isFinite(targetDepth)) {
            const y = toY(targetDepth);
            ctx.strokeStyle = '#ff5566';
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(width, y);
            ctx.stroke();
        }

        const modifiers = options.modifiers;
        if (modifiers) {
            const note = `${modifiers.ductActive ? 'DUCT ' : ''}${modifiers.convergenceBand ? `CZ${modifiers.convergenceBand} ` : ''}${modifiers.snrModifierDb >= 0 ? '+' : ''}${modifiers.snrModifierDb.toFixed(1)}dB`;
            ctx.fillStyle = '#8ee9ff';
            ctx.fillText(note.trim(), 2, height - 4);
        }

        ctx.fillStyle = '#7fb9c4';
        ctx.fillText('T', Math.floor(width * 0.2), 8);
        ctx.fillStyle = '#66e3ff';
        ctx.fillText('C', Math.floor(width * 0.73), 8);
    }
}
