import { TrackState } from './simulation.js';

export class Tactical2DRenderer {
    constructor(getTerrainHeight) {
        this.container = null;
        this.canvas = null;
        this.ctx = null;
        this.scanRadius = 0;
        this.scanActive = false;
        this.getTerrainHeight = typeof getTerrainHeight === 'function' ? getTerrainHeight : (() => 0);
        this.contourCache = new Map();
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
        this.contourCache.clear();
    }

    setVisible(visible) {
        if (!this.canvas) return;
        this.canvas.style.display = visible ? 'block' : 'none';
    }

    resize(width, height) {
        if (!this.canvas || !this.ctx) return;
        const safeWidth = Math.max(1, Math.floor(width || 0));
        const safeHeight = Math.max(1, Math.floor(height || 0));
        const dpr = window.devicePixelRatio || 1;
        this.canvas.width = safeWidth * dpr;
        this.canvas.height = safeHeight * dpr;
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        this.contourCache.clear();
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

        this.drawTerrainContours(ctx, w, h, scale, angleOffset, true);

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
                this.drawDepthCue(ctx, t, dx, dy);

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

        this.drawTerrainContours(ctx, w, h, scale, 0, false);

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
                this.drawDepthCue(ctx, t, dx, dy);

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

    drawDepthCue(ctx, target, dx, dy) {
        if (!target) return;

        const terrainY = this.getTerrainHeight(target.x, target.z);
        const depth = Math.max(1, -terrainY - 2);
        const normalized = Math.max(0, Math.min(1, depth / 200));
        const hue = 190 + normalized * 40;
        const lightness = 60 - normalized * 20;

        ctx.save();
        ctx.strokeStyle = `hsl(${hue}, 100%, ${lightness}%)`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(dx + 8, dy - 8);
        ctx.lineTo(dx + 8, dy + 8);
        ctx.stroke();
        ctx.restore();
    }

    drawTerrainContours(ctx, width, height, scale, angleOffset, radialMode) {
        const layers = this.getContourLayers(width, height, scale, angleOffset, radialMode);
        for (const layer of layers) {
            ctx.strokeStyle = layer.strokeStyle;
            ctx.lineWidth = layer.lineWidth;
            ctx.stroke(layer.path);
        }
    }

    getContourLayers(width, height, scale, angleOffset, radialMode) {
        const key = `${radialMode ? 'radial' : 'grid'}:${width}:${height}:${scale}:${angleOffset}`;
        const cached = this.contourCache.get(key);
        if (cached) return cached;

        const centerX = width / 2;
        const centerY = height / 2;
        const worldSpan = Math.min(width, height) / scale;
        const maxWorld = worldSpan / 2;
        const contourLevels = [-18, -14, -10, -6, -2, 2, 6];
        const gridStep = 8;
        const layers = [];

        contourLevels.forEach((level, levelIndex) => {
            const major = levelIndex % 2 === 0;
            const path = new Path2D();

            for (let wx = -maxWorld; wx < maxWorld; wx += gridStep) {
                for (let wz = -maxWorld; wz < maxWorld; wz += gridStep) {
                    const p00 = { x: wx, y: wz, h: this.getTerrainHeight(wx, wz) };
                    const p10 = { x: wx + gridStep, y: wz, h: this.getTerrainHeight(wx + gridStep, wz) };
                    const p11 = { x: wx + gridStep, y: wz + gridStep, h: this.getTerrainHeight(wx + gridStep, wz + gridStep) };
                    const p01 = { x: wx, y: wz + gridStep, h: this.getTerrainHeight(wx, wz + gridStep) };

                    const caseCode =
                        (p00.h >= level ? 1 : 0) |
                        (p10.h >= level ? 2 : 0) |
                        (p11.h >= level ? 4 : 0) |
                        (p01.h >= level ? 8 : 0);

                    if (caseCode === 0 || caseCode === 15) continue;

                    const e0 = this.interpolateEdgePoint(p00, p10, level);
                    const e1 = this.interpolateEdgePoint(p10, p11, level);
                    const e2 = this.interpolateEdgePoint(p11, p01, level);
                    const e3 = this.interpolateEdgePoint(p01, p00, level);

                    const segments = this.getContourSegments(caseCode, e0, e1, e2, e3);
                    segments.forEach(([a, b]) => {
                        const sa = this.mapWorldToScreen(a.x, a.y, centerX, centerY, scale, angleOffset, radialMode);
                        const sb = this.mapWorldToScreen(b.x, b.y, centerX, centerY, scale, angleOffset, radialMode);
                        path.moveTo(sa.x, sa.y);
                        path.lineTo(sb.x, sb.y);
                    });
                }
            }

            layers.push({
                path,
                strokeStyle: major ? 'rgba(0, 120, 130, 0.34)' : 'rgba(0, 95, 105, 0.22)',
                lineWidth: major ? 1 : 0.6
            });
        });

        this.contourCache.set(key, layers);
        return layers;
    }

    interpolateEdgePoint(a, b, level) {
        const da = level - a.h;
        const db = b.h - a.h;
        let t = db === 0 ? 0.5 : da / db;
        if (!Number.isFinite(t)) t = 0.5;
        t = Math.max(0, Math.min(1, t));
        return {
            x: a.x + (b.x - a.x) * t,
            y: a.y + (b.y - a.y) * t
        };
    }

    getContourSegments(caseCode, e0, e1, e2, e3) {
        switch (caseCode) {
            case 1:
            case 14:
                return [[e3, e0]];
            case 2:
            case 13:
                return [[e0, e1]];
            case 3:
            case 12:
                return [[e3, e1]];
            case 4:
            case 11:
                return [[e1, e2]];
            case 5:
                return [[e3, e2], [e0, e1]];
            case 6:
            case 9:
                return [[e0, e2]];
            case 7:
            case 8:
                return [[e3, e2]];
            case 10:
                return [[e0, e3], [e1, e2]];
            default:
                return [];
        }
    }

    mapWorldToScreen(wx, wz, centerX, centerY, scale, angleOffset, radialMode) {
        if (radialMode) {
            const rotX = wx * Math.cos(angleOffset) - wz * Math.sin(angleOffset);
            const rotZ = wx * Math.sin(angleOffset) + wz * Math.cos(angleOffset);
            return {
                x: centerX + rotX * scale,
                y: centerY + rotZ * scale
            };
        }

        return {
            x: centerX + wx * scale,
            y: centerY + wz * scale
        };
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
