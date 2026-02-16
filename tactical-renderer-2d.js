import { TrackState } from './simulation.js';

export class Tactical2DRenderer {
    constructor() {
        this.container = null;
        this.canvas = null;
        this.ctx = null;
        this.scanRadius = 0;
        this.scanActive = false;
    }

    init(container) {
        if (this.canvas || !container) return;
        this.container = container;
        this.canvas = document.createElement('canvas');
        this.canvas.style.position = 'absolute';
        this.canvas.style.top = '0';
        this.canvas.style.left = '0';
        this.canvas.style.width = '100%';
        this.canvas.style.height = '100%';
        this.canvas.style.pointerEvents = 'none';
        this.canvas.style.display = 'none';
        container.appendChild(this.canvas);
        this.ctx = this.canvas.getContext('2d');
    }

    dispose() {
        if (this.canvas && this.canvas.parentElement) {
            this.canvas.parentElement.removeChild(this.canvas);
        }
        this.container = null;
        this.canvas = null;
        this.ctx = null;
    }

    setVisible(visible) {
        if (!this.canvas) return;
        this.canvas.style.display = visible ? 'block' : 'none';
    }

    resize(width, height) {
        if (!this.canvas || !this.ctx) return;
        const dpr = window.devicePixelRatio || 1;
        this.canvas.width = width * dpr;
        this.canvas.height = height * dpr;
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    setScanState(radius, active) {
        this.scanRadius = radius;
        this.scanActive = active;
    }

    render(mode, targets, options = {}) {
        if (!this.ctx || !this.container) return;
        if (mode === 'radial') {
            this.renderRadial(targets, options);
        } else if (mode === 'grid') {
            this.renderGrid(targets, options);
        }
    }

    pickTargetAtPoint(mode, x, y, rect, targets) {
        if (!Array.isArray(targets)) return null;
        const centerX = rect.width / 2;
        const centerY = rect.height / 2;
        const scale = 1.5;
        const angleOffset = -Math.PI / 2;

        let hitId = null;
        targets.forEach((t) => {
            if (t.state !== TrackState.TRACKED) return;

            let dx;
            let dy;

            if (mode === 'radial') {
                const rotX = t.x * Math.cos(angleOffset) - t.z * Math.sin(angleOffset);
                const rotZ = t.x * Math.sin(angleOffset) + t.z * Math.cos(angleOffset);
                dx = centerX + rotX * scale;
                dy = centerY + rotZ * scale;
            } else {
                dx = centerX + t.x * scale;
                dy = centerY + t.z * scale;
            }

            const dist = Math.sqrt((x - dx) ** 2 + (y - dy) ** 2);
            if (dist < 25) hitId = t.id;
        });

        return hitId;
    }

    renderRadial(targets, options = {}) {
        const w = this.container.clientWidth;
        const h = this.container.clientHeight;
        const ctx = this.ctx;
        const centerX = w / 2;
        const centerY = h / 2;
        const scale = 1.5;
        const pulse = options.pulse || 0;
        const selectedTargetId = options.selectedTargetId || null;
        const angleOffset = -Math.PI / 2;

        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, w, h);

        ctx.strokeStyle = '#00ffff';
        ctx.lineWidth = 1;
        for (let r = 50; r <= 200; r += 50) {
            ctx.beginPath();
            ctx.arc(centerX, centerY, r * scale, 0, Math.PI * 2);
            ctx.stroke();
            ctx.fillStyle = '#004444';
            ctx.fillText(`${r}m`, centerX + 5, centerY - r * scale - 5);
        }

        ctx.strokeStyle = '#002222';
        [0, 90, 180, 270].forEach((deg) => {
            const rad = (deg * Math.PI / 180) + angleOffset;
            ctx.beginPath();
            ctx.moveTo(centerX, centerY);
            ctx.lineTo(centerX + Math.cos(rad) * 300, centerY + Math.sin(rad) * 300);
            ctx.stroke();
        });

        ctx.font = '10px monospace';
        if (Array.isArray(targets)) {
            targets.forEach((t) => {
                if (t.state !== TrackState.TRACKED) return;

                const rotX = t.x * Math.cos(angleOffset) - t.z * Math.sin(angleOffset);
                const rotZ = t.x * Math.sin(angleOffset) + t.z * Math.cos(angleOffset);
                const dx = centerX + rotX * scale;
                const dy = centerY + rotZ * scale;
                const isSelected = selectedTargetId === t.id;

                ctx.globalAlpha = isSelected ? 1.0 : 0.7;
                this.drawTrackUncertainty(ctx, dx, dy, t.snr, this.getTypeColor(t.type));

                if (isSelected) {
                    this.drawSelectionHUD(ctx, dx, dy, 12, pulse);
                }

                this.drawTargetGlyph(ctx, t.type, dx, dy, true);

                ctx.fillStyle = '#ffffff';
                ctx.globalAlpha = 1.0;
                ctx.fillText(t.id.replace('target-', 'T'), dx + 10, dy);
            });
        }

        if (this.scanActive) {
            ctx.strokeStyle = '#00ffff';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(centerX, centerY, this.scanRadius * scale, 0, Math.PI * 2);
            ctx.stroke();

            ctx.strokeStyle = 'rgba(0, 255, 255, 0.4)';
            ctx.beginPath();
            ctx.arc(centerX, centerY, (this.scanRadius - 5) * scale, 0, Math.PI * 2);
            ctx.stroke();
        }

        ctx.save();
        ctx.translate(centerX, centerY);
        ctx.beginPath();
        ctx.moveTo(0, -10);
        ctx.lineTo(5, 5);
        ctx.lineTo(-5, 5);
        ctx.closePath();
        ctx.fillStyle = '#00ff00';
        ctx.fill();
        ctx.restore();
    }

    renderGrid(targets, options = {}) {
        const w = this.container.clientWidth;
        const h = this.container.clientHeight;
        const ctx = this.ctx;
        const centerX = w / 2;
        const centerY = h / 2;
        const scale = 1.5;
        const pulse = options.pulse || 0;
        const selectedTargetId = options.selectedTargetId || null;

        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, w, h);

        ctx.strokeStyle = '#004444';
        ctx.lineWidth = 1;
        ctx.fillStyle = '#00ffff';
        for (let i = -5; i <= 5; i++) {
            ctx.beginPath();
            ctx.moveTo(0, centerY + i * 50);
            ctx.lineTo(w, centerY + i * 50);
            ctx.stroke();

            ctx.beginPath();
            ctx.moveTo(centerX + i * 50, 0);
            ctx.lineTo(centerX + i * 50, h);
            ctx.stroke();
        }

        ctx.strokeStyle = '#006666';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(0, centerY);
        ctx.lineTo(w, centerY);
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(centerX, 0);
        ctx.lineTo(centerX, h);
        ctx.stroke();

        if (Array.isArray(targets)) {
            targets.forEach((t) => {
                if (t.state !== TrackState.TRACKED) return;

                const dx = centerX + t.x * scale;
                const dy = centerY + t.z * scale;
                const isSelected = selectedTargetId === t.id;

                ctx.globalAlpha = isSelected ? 1.0 : 0.7;
                this.drawTrackUncertainty(ctx, dx, dy, t.snr, this.getTypeColor(t.type));

                if (isSelected) {
                    this.drawSelectionHUD(ctx, dx, dy, 10, pulse);
                }

                this.drawTargetGlyph(ctx, t.type, dx, dy, false);

                ctx.fillStyle = '#ffffff';
                ctx.font = '8px monospace';
                ctx.globalAlpha = 1.0;
                ctx.fillText(t.id.replace('target-', 'T'), dx + 8, dy);
            });
        }

        if (this.scanActive) {
            ctx.strokeStyle = '#00ffff';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(centerX, centerY, this.scanRadius * scale, 0, Math.PI * 2);
            ctx.stroke();
        }

        ctx.fillStyle = '#00ff00';
        ctx.beginPath();
        ctx.moveTo(centerX, centerY - 8);
        ctx.lineTo(centerX + 6, centerY + 6);
        ctx.lineTo(centerX - 6, centerY + 6);
        ctx.fill();
    }

    drawTrackUncertainty(ctx, x, y, snr, color) {
        const safeSnr = Math.max(0, snr || 0);
        const radius = 15 / Math.log(safeSnr + 1.1);
        const rx = Math.max(8, Math.min(80, radius));
        const ry = rx * 0.65;

        ctx.save();
        ctx.strokeStyle = color || '#00ffff';
        ctx.lineWidth = 1;
        ctx.setLineDash([5, 4]);
        ctx.beginPath();
        ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
    }

    drawTargetGlyph(ctx, type, dx, dy, radialMode) {
        ctx.fillStyle = this.getTypeColor(type);
        ctx.strokeStyle = ctx.fillStyle;
        ctx.lineWidth = 1;

        if (type === 'SUBMARINE') {
            const s = radialMode ? 8 : 7;
            ctx.beginPath();
            ctx.moveTo(dx, dy - s);
            ctx.lineTo(dx + s, dy);
            ctx.lineTo(dx, dy + s);
            ctx.lineTo(dx - s, dy);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
            return;
        }

        if (type === 'TORPEDO') {
            const up = radialMode ? 8 : 7;
            const side = radialMode ? 5 : 4;
            ctx.beginPath();
            ctx.moveTo(dx, dy - up);
            ctx.lineTo(dx + side, dy + side);
            ctx.lineTo(dx - side, dy + side);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
            return;
        }

        if (type === 'BIOLOGICAL') {
            ctx.beginPath();
            ctx.arc(dx, dy, 4, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
            return;
        }

        if (type === 'STATIC') {
            const size = radialMode ? 12 : 10;
            ctx.fillRect(dx - size / 2, dy - size / 2, size, size);
            return;
        }

        if (radialMode) {
            ctx.beginPath();
            ctx.arc(dx, dy, 6, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
            return;
        }

        ctx.fillRect(dx - 5, dy - 5, 10, 10);
    }

    getTypeColor(type) {
        switch (type) {
            case 'SUBMARINE': return '#00ffff';
            case 'TORPEDO': return '#ff0000';
            case 'BIOLOGICAL': return '#00ff00';
            case 'STATIC': return '#888888';
            default: return '#ff8800';
        }
    }

    drawSelectionHUD(ctx, x, y, size, pulse) {
        ctx.save();
        ctx.translate(x, y);

        const glowAlpha = 0.2 + Math.sin(pulse * Math.PI * 2) * 0.1;
        ctx.strokeStyle = `rgba(255, 0, 0, ${glowAlpha})`;
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(0, 0, size * (1.1 + Math.sin(pulse * Math.PI * 2) * 0.05), 0, Math.PI * 2);
        ctx.stroke();

        ctx.strokeStyle = '#ff0000';
        ctx.lineWidth = 2;
        const cornerLen = size * 0.4;
        const offset = size * 1.2;

        for (let i = 0; i < 4; i++) {
            ctx.rotate(Math.PI / 2);
            ctx.beginPath();
            ctx.moveTo(offset - cornerLen, -offset);
            ctx.lineTo(offset, -offset);
            ctx.lineTo(offset, -offset + cornerLen);
            ctx.stroke();
        }

        ctx.restore();
    }
}
