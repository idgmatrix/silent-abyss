import { Tactical3DRenderer } from './tactical-renderer-3d.js';
import { Tactical2DRenderer } from './tactical-renderer-2d.js';
import { bearingDegFromDelta, forwardFromCourse, normalizeCourseRadians } from './coordinate-system.js';
import { resolveVisualMode, VISUAL_MODES } from './render-style-tokens.js';

export class TacticalView {
    constructor() {
        this.container = null;

        this.viewMode = '3d'; // '3d', 'radial', 'grid'
        this.terrainRenderStyle = 'default'; // 'default', 'point-cloud'
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
        this._pointerMoveHandler = null;
        this._pointerLeaveHandler = null;
        this._targetSelectedHandler = null;
        this._lastRenderTime = 0;
        this._hoveredTargetId = null;
        this._terrainProbes = [];

        this.debugCoordinatesEnabled = this.readCoordinateDebugFlag();
        this.atmospherePreset = this.readAtmospherePreset();
        this.enhanced2DVisuals = this.readEnhanced2DVisualsFlag();
        this.terrain2DVisualization = this.readTerrain2DVisualizationMode();
        this.visualMode = this.readVisualModePreset();
        this.snapToContactEnabled = this.readSnapToContactFlag();
        this.predictionCompareEnabled = this.readPredictionCompareFlag();
        this._debugHudEl = null;
        this._hoverTooltipEl = null;
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
        this.renderer3D.setDebugCoordinatesEnabled(this.debugCoordinatesEnabled);
        this.renderer3D.setTerrainRenderStyle(this.terrainRenderStyle);
        this.renderer3D.setAtmospherePreset(this.atmospherePreset);
        this.renderer2D.setDebugCoordinatesEnabled(this.debugCoordinatesEnabled);
        this.renderer2D.setEnhancedVisualsEnabled(this.enhanced2DVisuals);
        this.renderer2D.setTerrainVisualizationMode(this.terrain2DVisualization);
        this.renderer2D.setVisualMode(this.visualMode);
        this.renderer2D.setSnapToContactEnabled(this.snapToContactEnabled);
        this.renderer2D.setPredictionCompareEnabled(this.predictionCompareEnabled);

        if (this.debugCoordinatesEnabled) {
            this.createDebugHud();
        }

        this._resizeHandler = () => this.resize();
        this._clickHandler = (e) => this.handleCanvasClick(e);
        this._pointerMoveHandler = (e) => this.handlePointerMove(e);
        this._pointerLeaveHandler = () => this.handlePointerLeave();
        this._targetSelectedHandler = (e) => {
            this.selectedTargetId = e?.detail?.id ?? null;
        };

        this.container.addEventListener('click', this._clickHandler);
        this.container.addEventListener('mousemove', this._pointerMoveHandler);
        this.container.addEventListener('mouseleave', this._pointerLeaveHandler);
        this.container.addEventListener('targetSelected', this._targetSelectedHandler);
        window.addEventListener('resize', this._resizeHandler);

        this.createHoverTooltip();
        this.resize();
    }

    dispose() {
        if (this._resizeHandler) {
            window.removeEventListener('resize', this._resizeHandler);
        }

        if (this.container && this._clickHandler) {
            this.container.removeEventListener('click', this._clickHandler);
        }
        if (this.container && this._pointerMoveHandler) {
            this.container.removeEventListener('mousemove', this._pointerMoveHandler);
        }
        if (this.container && this._pointerLeaveHandler) {
            this.container.removeEventListener('mouseleave', this._pointerLeaveHandler);
        }
        if (this.container && this._targetSelectedHandler) {
            this.container.removeEventListener('targetSelected', this._targetSelectedHandler);
        }

        this.renderer3D.dispose();
        this.renderer2D.dispose();
        this.removeDebugHud();
        this.removeHoverTooltip();

        this.container = null;
        this._lastTargets = [];
        this._resizeHandler = null;
        this._clickHandler = null;
        this._pointerMoveHandler = null;
        this._pointerLeaveHandler = null;
        this._targetSelectedHandler = null;
        this._lastRenderTime = 0;
        this._hoveredTargetId = null;
        this._terrainProbes = [];
    }

    readCoordinateDebugFlag() {
        if (typeof window === 'undefined') return false;
        if (!(typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.DEV)) return false;

        try {
            const params = new URLSearchParams(window.location.search || '');
            if (params.get('debugCoords') === '1') return true;
            return window.localStorage.getItem('silentAbyss.debugCoords') === '1';
        } catch {
            return false;
        }
    }

    readAtmospherePreset() {
        if (typeof window === 'undefined') return 'balanced';

        try {
            const params = new URLSearchParams(window.location.search || '');
            const fromQuery = params.get('atmo');
            if (fromQuery === 'subtle' || fromQuery === 'balanced' || fromQuery === 'cinematic') {
                return fromQuery;
            }

            const fromStorage = window.localStorage.getItem('silentAbyss.atmospherePreset');
            if (fromStorage === 'subtle' || fromStorage === 'balanced' || fromStorage === 'cinematic') {
                return fromStorage;
            }
        } catch {
            // Ignore storage/query access issues and fallback to default preset.
        }

        return 'balanced';
    }

    readEnhanced2DVisualsFlag() {
        if (typeof window === 'undefined') return true;
        try {
            const params = new URLSearchParams(window.location.search || '');
            const fromQuery = params.get('enhanced2d');
            if (fromQuery === '0') return false;
            if (fromQuery === '1') return true;

            const fromStorage = window.localStorage.getItem('silentAbyss.enhanced2DVisuals');
            if (fromStorage === '0') return false;
            if (fromStorage === '1') return true;
        } catch {
            // Ignore query/storage access failures.
        }
        return true;
    }

    readTerrain2DVisualizationMode() {
        if (typeof window === 'undefined') return 'legacy-contours';
        try {
            const params = new URLSearchParams(window.location.search || '');
            const fromQuery = params.get('terrain2d');
            if (fromQuery === 'legacy-contours' || fromQuery === 'shader-bands') return fromQuery;
            const fromStorage = window.localStorage.getItem('silentAbyss.terrain2dVisualization');
            if (fromStorage === 'legacy-contours' || fromStorage === 'shader-bands') return fromStorage;
        } catch {
            // Ignore query/storage access failures.
        }
        return 'legacy-contours';
    }

    readVisualModePreset() {
        if (typeof window === 'undefined') return VISUAL_MODES.STEALTH;
        try {
            const params = new URLSearchParams(window.location.search || '');
            const queryValue = params.get('visualMode');
            if (queryValue === VISUAL_MODES.STEALTH || queryValue === VISUAL_MODES.ENGAGEMENT || queryValue === VISUAL_MODES.ALARM) {
                return resolveVisualMode(queryValue);
            }

            const storageValue = window.localStorage.getItem('silentAbyss.visualMode');
            if (storageValue === VISUAL_MODES.STEALTH || storageValue === VISUAL_MODES.ENGAGEMENT || storageValue === VISUAL_MODES.ALARM) {
                return resolveVisualMode(storageValue);
            }
        } catch {
            // Ignore query/storage access failures.
        }
        return VISUAL_MODES.STEALTH;
    }

    readSnapToContactFlag() {
        if (typeof window === 'undefined') return false;
        try {
            const params = new URLSearchParams(window.location.search || '');
            const fromQuery = params.get('snap2d');
            if (fromQuery === '1') return true;
            if (fromQuery === '0') return false;
            return window.localStorage.getItem('silentAbyss.snapToContact2d') === '1';
        } catch {
            return false;
        }
    }

    readPredictionCompareFlag() {
        if (typeof window === 'undefined') return false;
        try {
            const params = new URLSearchParams(window.location.search || '');
            const fromQuery = params.get('comparePred');
            if (fromQuery === '1') return true;
            if (fromQuery === '0') return false;
            return window.localStorage.getItem('silentAbyss.comparePrediction2d') === '1';
        } catch {
            return false;
        }
    }

    createDebugHud() {
        if (!this.container || this._debugHudEl) return;

        const hud = document.createElement('div');
        hud.style.position = 'absolute';
        hud.style.top = '8px';
        hud.style.left = '8px';
        hud.style.padding = '8px 10px';
        hud.style.border = '1px solid rgba(0, 255, 255, 0.45)';
        hud.style.background = 'rgba(0, 0, 0, 0.55)';
        hud.style.color = '#b5ffff';
        hud.style.font = '11px/1.4 monospace';
        hud.style.whiteSpace = 'pre';
        hud.style.pointerEvents = 'none';
        hud.style.zIndex = '20';
        this.container.appendChild(hud);
        this._debugHudEl = hud;
    }

    removeDebugHud() {
        if (this._debugHudEl && this._debugHudEl.parentElement) {
            this._debugHudEl.parentElement.removeChild(this._debugHudEl);
        }
        this._debugHudEl = null;
    }

    createHoverTooltip() {
        if (!this.container || this._hoverTooltipEl) return;
        const el = document.createElement('div');
        el.style.position = 'absolute';
        el.style.minWidth = '160px';
        el.style.padding = '7px 9px';
        el.style.border = '1px solid rgba(170, 235, 255, 0.5)';
        el.style.background = 'rgba(4, 10, 16, 0.85)';
        el.style.color = '#d9f6ff';
        el.style.font = '11px/1.35 "Share Tech Mono", monospace';
        el.style.whiteSpace = 'pre';
        el.style.pointerEvents = 'none';
        el.style.zIndex = '22';
        el.style.display = 'none';
        this.container.appendChild(el);
        this._hoverTooltipEl = el;
    }

    removeHoverTooltip() {
        if (this._hoverTooltipEl && this._hoverTooltipEl.parentElement) {
            this._hoverTooltipEl.parentElement.removeChild(this._hoverTooltipEl);
        }
        this._hoverTooltipEl = null;
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

    render(targets, ownShipCourse, ownShipForwardSpeed = 0, ownShipPosition = null, pingFlashIntensity = 0) {
        if (!this.container) return;

        const now = performance.now();
        const dt = this._lastRenderTime > 0 ? (now - this._lastRenderTime) / 1000 : 0.016;
        this._lastRenderTime = now;
        this.pulse = (Date.now() % 2000) / 2000;
        this._lastTargets = Array.isArray(targets) ? targets : [];
        this.updateOwnShipPose(ownShipCourse, ownShipForwardSpeed, dt, ownShipPosition);
        this._terrainProbes = this.buildTerrainProbes();
        this.updateDebugHud();

        if (this.viewMode === '3d') {
            this.renderer3D.setVisible(true);
            this.renderer2D.setVisible(false);
            this.renderer3D.render(this._ownShipPose, this.selectedTargetId, this.pulse, this._lastTargets, dt, this._terrainProbes);
            return;
        }

        this.renderer3D.setVisible(false);
        this.renderer2D.setVisible(true);
        // Keep 3D state/camera warm while hidden so switching views does not cause jumpy catch-up.
        this.renderer3D.render(this._ownShipPose, this.selectedTargetId, this.pulse, this._lastTargets, dt, this._terrainProbes);
        this.renderer2D.render(this.viewMode, targets, {
            selectedTargetId: this.selectedTargetId,
            hoveredTargetId: this._hoveredTargetId,
            pulse: this.pulse,
            ownShipPose: this._ownShipPose,
            terrainProbes: this._terrainProbes,
            pingFlashIntensity,
            dt
        });
    }

    buildTerrainProbes() {
        const ownX = Number.isFinite(this._ownShipPose?.x) ? this._ownShipPose.x : 0;
        const ownZ = Number.isFinite(this._ownShipPose?.z) ? this._ownShipPose.z : 0;
        const d = 40;
        const points = [
            { id: 'C', x: ownX, z: ownZ },
            { id: 'N', x: ownX, z: ownZ + d },
            { id: 'E', x: ownX + d, z: ownZ },
            { id: 'S', x: ownX, z: ownZ - d },
            { id: 'W', x: ownX - d, z: ownZ }
        ];
        return points.map((p) => {
            const terrainY = this.getTerrainHeight(p.x, p.z);
            return {
                id: p.id,
                x: p.x,
                z: p.z,
                terrainY,
                depth: Math.max(1, -terrainY - 2)
            };
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
            const forward = forwardFromCourse(rawCourse);
            this._ownShipPose.x += forward.x * speed * dt;
            this._ownShipPose.z += forward.z * speed * dt;
        }
    }

    setViewMode(mode) {
        this.viewMode = mode;
        if (mode !== 'radial' && mode !== 'grid') {
            this.handlePointerLeave();
        }
    }

    setTerrainRenderStyle(style) {
        this.terrainRenderStyle = style === 'point-cloud' ? 'point-cloud' : 'default';
        this.renderer3D.setTerrainRenderStyle(this.terrainRenderStyle);
    }

    setAtmospherePreset(preset) {
        const normalized = preset === 'subtle' || preset === 'cinematic' ? preset : 'balanced';
        this.atmospherePreset = normalized;
        this.renderer3D.setAtmospherePreset(this.atmospherePreset);
        if (typeof window !== 'undefined') {
            try {
                window.localStorage.setItem('silentAbyss.atmospherePreset', this.atmospherePreset);
            } catch {
                // Ignore local storage failures.
            }
        }
    }

    getAtmospherePreset() {
        return this.atmospherePreset;
    }

    setEnhanced2DVisualsEnabled(enabled) {
        this.enhanced2DVisuals = !!enabled;
        this.renderer2D.setEnhancedVisualsEnabled(this.enhanced2DVisuals);
        if (typeof window !== 'undefined') {
            try {
                window.localStorage.setItem('silentAbyss.enhanced2DVisuals', this.enhanced2DVisuals ? '1' : '0');
            } catch {
                // Ignore local storage failures.
            }
        }
    }

    setTerrain2DVisualizationMode(mode) {
        this.terrain2DVisualization = mode === 'shader-bands' ? 'shader-bands' : 'legacy-contours';
        this.renderer2D.setTerrainVisualizationMode(this.terrain2DVisualization);
        if (typeof window !== 'undefined') {
            try {
                window.localStorage.setItem('silentAbyss.terrain2dVisualization', this.terrain2DVisualization);
            } catch {
                // Ignore local storage failures.
            }
        }
    }

    setVisualMode(mode) {
        this.visualMode = resolveVisualMode(mode);
        this.renderer2D.setVisualMode(this.visualMode);
        if (typeof window !== 'undefined') {
            try {
                window.localStorage.setItem('silentAbyss.visualMode', this.visualMode);
            } catch {
                // Ignore local storage failures.
            }
        }
    }

    setSnapToContactEnabled(enabled) {
        this.snapToContactEnabled = !!enabled;
        this.renderer2D.setSnapToContactEnabled(this.snapToContactEnabled);
        if (typeof window !== 'undefined') {
            try {
                window.localStorage.setItem('silentAbyss.snapToContact2d', this.snapToContactEnabled ? '1' : '0');
            } catch {
                // Ignore local storage failures.
            }
        }
    }

    setPredictionCompareEnabled(enabled) {
        this.predictionCompareEnabled = !!enabled;
        this.renderer2D.setPredictionCompareEnabled(this.predictionCompareEnabled);
        if (typeof window !== 'undefined') {
            try {
                window.localStorage.setItem('silentAbyss.comparePrediction2d', this.predictionCompareEnabled ? '1' : '0');
            } catch {
                // Ignore local storage failures.
            }
        }
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

    handlePointerMove(e) {
        if (!this.container) return;
        if (this.viewMode !== 'radial' && this.viewMode !== 'grid') {
            this.handlePointerLeave();
            return;
        }

        const rect = this.container.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const hoveredId = this.renderer2D.pickTargetAtPoint(
            this.viewMode,
            x,
            y,
            rect,
            this._lastTargets,
            { ownShipPose: this._ownShipPose }
        );
        this._hoveredTargetId = hoveredId;

        if (!hoveredId) {
            this.hideHoverTooltip();
            return;
        }

        const target = this._lastTargets.find((t) => t.id === hoveredId) || null;
        if (!target) {
            this.hideHoverTooltip();
            return;
        }
        this.showHoverTooltip(target, x, y, rect.width, rect.height);
    }

    handlePointerLeave() {
        this._hoveredTargetId = null;
        this.hideHoverTooltip();
    }

    showHoverTooltip(target, x, y, width, height) {
        if (!this._hoverTooltipEl) return;

        const dx = target.x - this._ownShipPose.x;
        const dz = target.z - this._ownShipPose.z;
        const bearing = Number.isFinite(target.bearing) ? target.bearing : bearingDegFromDelta(dx, dz);
        const range = Math.hypot(dx, dz) * 50;
        const speed = Number.isFinite(target.speed) ? target.speed : 0;
        const terrainY = this.getTerrainHeight(target.x, target.z);
        const depthMeters = Math.max(1, -terrainY - 2);
        const confidence = Math.max(0, Math.min(100, ((target.snr || 0) / 3.5) * 100));

        this._hoverTooltipEl.textContent = [
            `${target.id.replace('target-', 'T')}  ${target.type || 'UNKNOWN'}`,
            `BRG  ${bearing.toFixed(1)} deg`,
            `RNG  ${range.toFixed(0)} m`,
            `SPD  ${speed.toFixed(1)} kts`,
            `DPT  ${depthMeters.toFixed(0)} m`,
            `CFN  ${confidence.toFixed(0)}%`
        ].join('\n');

        const margin = 12;
        const left = Math.min(width - 170, x + margin);
        const top = Math.min(height - 104, y + margin);
        this._hoverTooltipEl.style.left = `${Math.max(8, left)}px`;
        this._hoverTooltipEl.style.top = `${Math.max(8, top)}px`;
        this._hoverTooltipEl.style.display = 'block';
    }

    hideHoverTooltip() {
        if (this._hoverTooltipEl) {
            this._hoverTooltipEl.style.display = 'none';
        }
    }

    resize() {
        if (!this.container) return;

        const width = Math.max(1, Math.floor(this.container.clientWidth || 0));
        const height = Math.max(1, Math.floor(this.container.clientHeight || 0));

        this.renderer3D.resize(width, height);
        this.renderer2D.resize(width, height);
    }

    updateDebugHud() {
        if (!this._debugHudEl) return;

        const courseDeg = (normalizeCourseRadians(this._ownShipPose.course) * 180) / Math.PI;
        const speed = Number.isFinite(this._ownShipPose.speed) ? this._ownShipPose.speed : 0;
        const ownX = Number.isFinite(this._ownShipPose.x) ? this._ownShipPose.x : 0;
        const ownZ = Number.isFinite(this._ownShipPose.z) ? this._ownShipPose.z : 0;
        const forward = forwardFromCourse(this._ownShipPose.course);

        const selectedTarget = this.selectedTargetId
            ? this._lastTargets.find((t) => t.id === this.selectedTargetId) || null
            : null;

        let bearingLine = 'sel bearing: ---';
        let rangeLine = 'sel range: ---';
        if (selectedTarget) {
            const dx = selectedTarget.x - ownX;
            const dz = selectedTarget.z - ownZ;
            const bearing = Number.isFinite(selectedTarget.bearing)
                ? selectedTarget.bearing
                : bearingDegFromDelta(dx, dz);
            const range = Math.hypot(dx, dz);
            bearingLine = `sel bearing: ${bearing.toFixed(1)} deg`;
            rangeLine = `sel range: ${range.toFixed(1)} u`;
        }

        this._debugHudEl.textContent = [
            `coord debug (${this.viewMode.toUpperCase()})`,
            `course: ${courseDeg.toFixed(1)} deg`,
            `speed: ${speed.toFixed(2)} u/s`,
            `own pos: (${ownX.toFixed(1)}, ${ownZ.toFixed(1)})`,
            `fwd vec: (${forward.x.toFixed(3)}, ${forward.z.toFixed(3)})`,
            bearingLine,
            rangeLine,
            `terrain probes: ${this.formatTerrainProbeFingerprint()}`
        ].join('\n');
    }

    formatTerrainProbeFingerprint() {
        if (!Array.isArray(this._terrainProbes) || this._terrainProbes.length === 0) return '---';
        const order = ['C', 'N', 'E', 'S', 'W'];
        return order.map((id) => {
            const probe = this._terrainProbes.find((p) => p.id === id);
            if (!probe) return `${id}:--`;
            return `${id}:${probe.depth.toFixed(1)}`;
        }).join(' ');
    }
}
