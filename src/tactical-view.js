import { Tactical3DRenderer } from './tactical-renderer-3d.js';
import { Tactical2DRenderer } from './tactical-renderer-2d.js';

export class TacticalView {
    constructor() {
        this.container = null;

        this.viewMode = '3d'; // '3d', 'radial', 'grid'
        this.selectedTargetId = null;
        this.scanRadius = 0;
        this.scanActive = false;
        this.pulse = 0;

        this.renderer3D = new Tactical3DRenderer((x, z) => this.getTerrainHeight(x, z));
        this.renderer2D = new Tactical2DRenderer((x, z) => this.getTerrainHeight(x, z));

        this._lastTargets = [];
        this._ownShipPose = { x: 0, z: 0, course: 0, speed: 0 };
        this._ownShipDisplayCourse = 0;
        this._resizeHandler = null;
        this._clickHandler = null;
        this._targetSelectedHandler = null;
        this._lastRenderTime = 0;
    }

    // --- Terrain Noise Functions (Static) ---
    static _noise(x, y) {
        const n = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
        return n - Math.floor(n);
    }

    static _smoothNoise(x, y) {
        const corners = (this._noise(x - 1, y - 1) + this._noise(x + 1, y - 1) + this._noise(x - 1, y + 1) + this._noise(x + 1, y + 1)) / 16;
        const sides = (this._noise(x - 1, y) + this._noise(x + 1, y) + this._noise(x, y - 1) + this._noise(x, y + 1)) / 8;
        const center = this._noise(x, y) / 4;
        return corners + sides + center;
    }

    static _interpolatedNoise(x, y) {
        const integerX = Math.floor(x);
        const fractionalX = x - integerX;
        const integerY = Math.floor(y);
        const fractionalY = y - integerY;

        const v1 = this._smoothNoise(integerX, integerY);
        const v2 = this._smoothNoise(integerX + 1, integerY);
        const v3 = this._smoothNoise(integerX, integerY + 1);
        const v4 = this._smoothNoise(integerX + 1, integerY + 1);

        const i1 = v1 * (1 - fractionalX) + v2 * fractionalX;
        const i2 = v3 * (1 - fractionalX) + v4 * fractionalX;

        return i1 * (1 - fractionalY) + i2 * fractionalY;
    }

    static terrainNoise(x, y) {
        let total = 0;
        const persistence = 0.5;
        const octaves = 3;
        for (let i = 0; i < octaves; i++) {
            const frequency = Math.pow(2, i);
            const amplitude = Math.pow(persistence, i);
            total += this._interpolatedNoise(x * frequency * 0.05, y * frequency * 0.05) * amplitude;
        }
        return total;
    }

    getTerrainHeight(x, z) {
        return TacticalView.terrainNoise(x, z) * 15 - 10;
    }

    async init(containerId) {
        if (this.container) return;

        this.container = document.getElementById(containerId);
        if (!this.container) return;

        await this.renderer3D.init(this.container);
        this.renderer2D.init(this.container);
        this.renderer2D.setScanState(this.scanRadius, this.scanActive);

        this._resizeHandler = () => this.resize();
        this._clickHandler = (e) => this.handleCanvasClick(e);
        this._targetSelectedHandler = (e) => {
            this.selectedTargetId = e?.detail?.id ?? null;
        };

        this.container.addEventListener('click', this._clickHandler);
        this.container.addEventListener('targetSelected', this._targetSelectedHandler);
        window.addEventListener('resize', this._resizeHandler);

        this.resize();
    }

    dispose() {
        if (this._resizeHandler) {
            window.removeEventListener('resize', this._resizeHandler);
        }

        if (this.container && this._clickHandler) {
            this.container.removeEventListener('click', this._clickHandler);
        }
        if (this.container && this._targetSelectedHandler) {
            this.container.removeEventListener('targetSelected', this._targetSelectedHandler);
        }

        this.renderer3D.dispose();
        this.renderer2D.dispose();

        this.container = null;
        this._lastTargets = [];
        this._resizeHandler = null;
        this._clickHandler = null;
        this._targetSelectedHandler = null;
        this._lastRenderTime = 0;
    }

    addTarget(target) {
        this.renderer3D.addTarget(target);
    }

    updateTargetPosition(targetId, x, z, passive = false, speed = 0) {
        this.renderer3D.updateTargetPosition(targetId, x, z, passive, speed);
    }

    updateTargetOpacities(decayFactor = 0.98) {
        this.renderer3D.updateTargetOpacities(decayFactor);
    }

    setScanExUniforms(radius, active) {
        this.scanRadius = radius;
        this.scanActive = active;

        this.renderer3D.setScanExUniforms(radius, active);
        this.renderer2D.setScanState(radius, active);
    }

    render(targets, ownShipCourse, ownShipForwardSpeed = 0, ownShipPosition = null) {
        if (!this.container) return;

        const now = performance.now();
        const dt = this._lastRenderTime > 0 ? (now - this._lastRenderTime) / 1000 : 0.016;
        this._lastRenderTime = now;
        this.pulse = (Date.now() % 2000) / 2000;
        this._lastTargets = Array.isArray(targets) ? targets : [];
        this.updateOwnShipPose(ownShipCourse, ownShipForwardSpeed, dt, ownShipPosition);

        if (this.viewMode === '3d') {
            this.renderer3D.setVisible(true);
            this.renderer2D.setVisible(false);
            this.renderer3D.render(this._ownShipPose, this.selectedTargetId, this.pulse, this._lastTargets, dt);
            return;
        }

        this.renderer3D.setVisible(false);
        this.renderer2D.setVisible(true);
        this.renderer2D.render(this.viewMode, targets, {
            selectedTargetId: this.selectedTargetId,
            pulse: this.pulse,
            ownShipPose: this._ownShipPose
        });
    }

    updateOwnShipPose(ownShipCourse, ownShipForwardSpeed, dt, ownShipPosition = null) {
        const rawCourse = Number.isFinite(ownShipCourse) ? ownShipCourse : this._ownShipDisplayCourse;
        const speed = Number.isFinite(ownShipForwardSpeed) ? ownShipForwardSpeed : 0;

        // Shared visual heading smoothing for all views (3D/radial/grid).
        let diff = rawCourse - this._ownShipDisplayCourse;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        const maxTurnRate = 0.25; // rad/s
        const maxStep = Math.max(0.001, maxTurnRate * Math.max(0.001, dt));
        const turnStep = Math.max(-maxStep, Math.min(maxStep, diff));
        this._ownShipDisplayCourse += turnStep;

        this._ownShipPose.course = this._ownShipDisplayCourse;
        this._ownShipPose.speed = speed;

        if (ownShipPosition && Number.isFinite(ownShipPosition.x) && Number.isFinite(ownShipPosition.z)) {
            // Use external position if provided
            this._ownShipPose.x = ownShipPosition.x;
            this._ownShipPose.z = ownShipPosition.z;
        } else {
            // Fallback to internal integration (legacy or if position missing)
            this._ownShipPose.x += Math.cos(rawCourse) * speed * dt;
            this._ownShipPose.z += Math.sin(rawCourse) * speed * dt;
        }
    }

    setViewMode(mode) {
        this.viewMode = mode;
    }

    handleCanvasClick(e) {
        if (!this.container) return;

        const rect = this.container.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        let hitId = null;

        if (this.viewMode === '3d') {
            hitId = this.renderer3D.pickTargetAtPoint(x, y, rect);
        } else if (this.viewMode === 'radial' || this.viewMode === 'grid') {
            hitId = this.renderer2D.pickTargetAtPoint(
                this.viewMode,
                x,
                y,
                rect,
                this._lastTargets,
                { ownShipPose: this._ownShipPose }
            );
        }

        this.selectedTargetId = hitId;
        this.container.dispatchEvent(new CustomEvent('targetSelected', { detail: { id: hitId } }));
    }

    resize() {
        if (!this.container) return;

        const width = Math.max(1, Math.floor(this.container.clientWidth || 0));
        const height = Math.max(1, Math.floor(this.container.clientHeight || 0));

        this.renderer3D.resize(width, height);
        this.renderer2D.resize(width, height);
    }
}
