import * as THREE from 'three';
import { TrackState } from './simulation.js';
import { shipLocalToWorld, worldToShipLocal } from './coordinate-system.js';
import { RENDER_STYLE_TOKENS, resolveVisualMode, VISUAL_MODES } from './render-style-tokens.js';

const TERRAIN_ISOLINE_GENERATION_ENABLED = true;
const TERRAIN_ISOLINE_DRAWING_ENABLED = false;
const TERRAIN_VISUALIZATION_MODES = {
    LEGACY: 'legacy-contours',
    SHADER_BANDS: 'shader-bands'
};

function readContourProfilingFlag() {
    if (typeof window === 'undefined') return false;
    try {
        const params = new URLSearchParams(window.location.search || '');
        const fromQuery = params.get('profile2dTerrain');
        if (fromQuery === '1' || fromQuery === 'true') return true;
        if (fromQuery === '0' || fromQuery === 'false') return false;
        return window.localStorage.getItem('silentAbyss.profile2dTerrain') === '1';
    } catch {
        return false;
    }
}

function resolveTerrainVisualizationMode(mode) {
    return mode === TERRAIN_VISUALIZATION_MODES.SHADER_BANDS
        ? TERRAIN_VISUALIZATION_MODES.SHADER_BANDS
        : TERRAIN_VISUALIZATION_MODES.LEGACY;
}

function readTerrainVisualizationMode() {
    if (typeof window === 'undefined') return TERRAIN_VISUALIZATION_MODES.LEGACY;
    try {
        const params = new URLSearchParams(window.location.search || '');
        const fromQuery = params.get('terrain2d');
        if (fromQuery === TERRAIN_VISUALIZATION_MODES.LEGACY || fromQuery === TERRAIN_VISUALIZATION_MODES.SHADER_BANDS) {
            return fromQuery;
        }
        const fromStorage = window.localStorage.getItem('silentAbyss.terrain2dVisualization');
        return resolveTerrainVisualizationMode(fromStorage);
    } catch {
        return TERRAIN_VISUALIZATION_MODES.LEGACY;
    }
}

export class Tactical2DRenderer {
    constructor(getTerrainHeight) {
        this.container = null;
        this.canvas = null;
        this.ctx = null;
        this.scanRadius = 0;
        this.scanActive = false;
        this.getTerrainHeight = typeof getTerrainHeight === 'function' ? getTerrainHeight : (() => 0);
        this.contourCache = new Map();
        this.debugCoordinatesEnabled = false;
        this.enhancedVisualsEnabled = true;
        this.visualMode = VISUAL_MODES.STEALTH;
        this.trackHistory = new Map();
        this.trackGhosts = new Map();
        this.snapToContactEnabled = false;
        this.predictionCompareEnabled = false;
        this.cameraOffsetLocal = { x: 0, z: 0 };
        this.cameraScale = 1.5;
        this.terrainVisualizationMode = readTerrainVisualizationMode();
        this.profileContoursEnabled = readContourProfilingFlag();
        this._contourProfileStats = {
            frameCount: 0,
            cacheHits: 0,
            cacheMisses: 0,
            lookupMs: 0,
            generationMs: 0,
            strokeMs: 0,
            lastLogAt: 0
        };
        this.webgpuModule = null;
        this.terrainLayerScene = null;
        this.terrainLayerCamera = null;
        this.terrainLayerRenderer = null;
        this.terrainLayerMaterial = null;
        this.terrainLayerMesh = null;
        this.terrainLayerUniforms = null;
        this.terrainLayerInitStarted = false;
        this.terrainLayerReady = false;
        this.terrainLayerRenderPending = false;
        this.terrainHeightTexture = null;
        this.terrainHeightTextureData = null;
        this.terrainHeightTextureSize = 192;
        this.terrainHeightTileCenter = { x: Number.NaN, z: Number.NaN };
        this.terrainHeightTileSpan = 0;
        this.terrainHeightTileSnap = 0;
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
        this.ensureTerrainLayerInitialized();
    }

    dispose() {
        if (this.canvas && this.canvas.parentElement) {
            this.canvas.parentElement.removeChild(this.canvas);
        }
        this.container = null;
        this.canvas = null;
        this.ctx = null;
        this.contourCache.clear();
        this.trackHistory.clear();
        this.trackGhosts.clear();
        this.disposeTerrainLayer();
    }

    setVisible(visible) {
        if (!this.canvas) return;
        this.canvas.style.display = visible ? 'block' : 'none';
        if (this.terrainLayerRenderer?.domElement) {
            this.terrainLayerRenderer.domElement.style.display = visible && this.isShaderTerrainModeActive() ? 'block' : 'none';
        }
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
        if (this.terrainLayerRenderer) {
            this.terrainLayerRenderer.setPixelRatio(dpr);
            this.terrainLayerRenderer.setSize(safeWidth, safeHeight, false);
        }
    }

    setScanState(radius, active) {
        this.scanRadius = radius;
        this.scanActive = active;
    }

    setDebugCoordinatesEnabled(enabled) {
        this.debugCoordinatesEnabled = !!enabled;
    }

    setEnhancedVisualsEnabled(enabled) {
        this.enhancedVisualsEnabled = !!enabled;
        this.contourCache.clear();
    }

    setVisualMode(mode) {
        this.visualMode = resolveVisualMode(mode);
        this.contourCache.clear();
    }

    setSnapToContactEnabled(enabled) {
        this.snapToContactEnabled = !!enabled;
    }

    setPredictionCompareEnabled(enabled) {
        this.predictionCompareEnabled = !!enabled;
    }

    setTerrainVisualizationMode(mode) {
        this.terrainVisualizationMode = resolveTerrainVisualizationMode(mode);
        this.contourCache.clear();
        if (this.terrainVisualizationMode === TERRAIN_VISUALIZATION_MODES.SHADER_BANDS) {
            this.ensureTerrainLayerInitialized();
        }
        if (this.terrainLayerRenderer?.domElement) {
            this.terrainLayerRenderer.domElement.style.display = this.isShaderTerrainModeActive() ? 'block' : 'none';
        }
    }

    getTerrainVisualizationMode() {
        return this.terrainVisualizationMode;
    }

    isShaderTerrainModeActive() {
        return this.terrainVisualizationMode === TERRAIN_VISUALIZATION_MODES.SHADER_BANDS && this.terrainLayerReady;
    }

    render(mode, targets, options = {}) {
        if (!this.ctx || !this.container) return;
        if (mode === 'radial') {
            this.renderRadial(targets, options);
        } else if (mode === 'grid') {
            this.renderGrid(targets, options);
        }
    }

    // Coordinate System Note (Global):
    // +Z is North (Course 0)
    // +X is East (Course 90)
    // Course increases clockwise.

    pickTargetAtPoint(mode, x, y, rect, targets, options = {}) {
        if (!Array.isArray(targets)) return null;
        const centerX = rect.width / 2;
        const centerY = rect.height / 2;
        const scale = this.cameraScale || 1.5;
        const ownShipPose = options.ownShipPose || { x: 0, z: 0, course: 0 };
        const headUp = mode === 'radial';

        let hitId = null;
        targets.forEach((t) => {
            if (t.state !== TrackState.TRACKED) return;
            const screen = this.getTargetScreenPosition(t, centerX, centerY, ownShipPose, headUp, scale);
            const dx = screen.x;
            const dy = screen.y;

            const dist = Math.sqrt((x - dx) ** 2 + (y - dy) ** 2);
            if (dist < 25) hitId = t.id;
        });

        return hitId;
    }

    renderRadial(targets, options = {}) {
        this.render2DMode('radial', targets, options);
    }

    renderGrid(targets, options = {}) {
        this.render2DMode('grid', targets, options);
    }

    render2DMode(mode, targets, options = {}) {
        const w = this.container.clientWidth;
        const h = this.container.clientHeight;
        const ctx = this.ctx;
        const centerX = w / 2;
        const centerY = h / 2;
        const scale = this.cameraScale || 1.5;
        const pulse = options.pulse || 0;
        const selectedTargetId = options.selectedTargetId || null;
        const hoveredTargetId = options.hoveredTargetId || null;
        const ownShipPose = options.ownShipPose || { x: 0, z: 0, course: 0 };
        const pingFlashIntensity = Number.isFinite(options.pingFlashIntensity) ? Math.max(0, options.pingFlashIntensity) : 0;
        const terrainProbes = Array.isArray(options.terrainProbes) ? options.terrainProbes : [];
        const headUp = mode === 'radial';
        const style = this.getModeStyle();
        const dt = Number.isFinite(options.dt) ? Math.max(0.001, options.dt) : 0.016;
        const renderCtx = {
            mode,
            headUp,
            width: w,
            height: h,
            centerX,
            centerY,
            scale,
            pulse,
            selectedTargetId,
            hoveredTargetId,
            ownShipPose,
            terrainProbes,
            pingFlashIntensity,
            dt,
            style
        };

        this.updateTrackHistory(targets, ownShipPose);
        this.updateViewTransform(targets, renderCtx);
        renderCtx.scale = this.cameraScale;
        this.updateTerrainLayer(renderCtx);
        this.drawBackgroundLayer(ctx, renderCtx);
        this.drawReferenceGeometryLayer(ctx, renderCtx);
        this.drawTracksLayer(ctx, targets, renderCtx);
        this.drawScanLayer(ctx, renderCtx);
        this.drawOwnShipLayer(ctx, renderCtx);
        this.drawFxLayer(ctx, renderCtx);
        this.drawHudLayer(ctx, renderCtx);
    }

    getModeStyle() {
        const base = RENDER_STYLE_TOKENS.tactical2d;
        const modeKey = resolveVisualMode(this.visualMode);
        return base.modes[modeKey] || base.modes[VISUAL_MODES.STEALTH];
    }

    drawBackgroundLayer(ctx, renderCtx) {
        if (this.isShaderTerrainModeActive()) {
            ctx.clearRect(0, 0, renderCtx.width, renderCtx.height);
            return;
        }
        const { width, height, style } = renderCtx;
        if (this.enhancedVisualsEnabled) {
            const gradient = ctx.createLinearGradient(0, 0, 0, height);
            gradient.addColorStop(0, style.backgroundTop);
            gradient.addColorStop(1, style.backgroundBottom);
            ctx.fillStyle = gradient;
        } else {
            ctx.fillStyle = '#000000';
        }
        ctx.fillRect(0, 0, width, height);
    }

    drawReferenceGeometryLayer(ctx, renderCtx) {
        const {
            mode,
            width,
            height,
            centerX,
            centerY,
            scale,
            ownShipPose,
            headUp,
            style
        } = renderCtx;
        const labelsColor = this.enhancedVisualsEnabled ? style.labels : '#00ffff';
        const majorGridColor = this.enhancedVisualsEnabled ? style.gridMajor : '#006666';
        const minorGridColor = this.enhancedVisualsEnabled ? style.gridMinor : '#004444';

        if (mode === 'radial') {
            ctx.strokeStyle = labelsColor;
            ctx.fillStyle = labelsColor;
            ctx.font = `10px ${RENDER_STYLE_TOKENS.tactical2d.fontFamily}`;
            ctx.lineWidth = 1;
            for (let r = 50; r <= 200; r += 50) {
                ctx.beginPath();
                ctx.arc(centerX, centerY, r * scale, 0, Math.PI * 2);
                ctx.stroke();
                ctx.globalAlpha = 0.55;
                ctx.fillText(`${r}m`, centerX + 6, centerY - r * scale - 5);
                ctx.globalAlpha = 1;
            }

            ctx.strokeStyle = minorGridColor;
            const angleOffset = -Math.PI / 2;
            [0, 90, 180, 270].forEach((deg) => {
                const rad = (deg * Math.PI) / 180 + angleOffset;
                ctx.beginPath();
                ctx.moveTo(centerX, centerY);
                ctx.lineTo(centerX + Math.cos(rad) * 320, centerY + Math.sin(rad) * 320);
                ctx.stroke();
            });
        } else {
            ctx.strokeStyle = minorGridColor;
            ctx.lineWidth = 1;
            for (let i = -5; i <= 5; i++) {
                ctx.beginPath();
                ctx.moveTo(0, centerY + i * 50);
                ctx.lineTo(width, centerY + i * 50);
                ctx.stroke();

                ctx.beginPath();
                ctx.moveTo(centerX + i * 50, 0);
                ctx.lineTo(centerX + i * 50, height);
                ctx.stroke();
            }

            ctx.strokeStyle = majorGridColor;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(0, centerY);
            ctx.lineTo(width, centerY);
            ctx.stroke();

            ctx.beginPath();
            ctx.moveTo(centerX, 0);
            ctx.lineTo(centerX, height);
            ctx.stroke();
        }

        if (!this.isShaderTerrainModeActive()) {
            this.drawTerrainContours(ctx, width, height, scale, mode === 'radial', ownShipPose, headUp);
        }
    }

    drawTracksLayer(ctx, targets, renderCtx) {
        if (!Array.isArray(targets)) return;
        const { mode, centerX, centerY, scale, ownShipPose, selectedTargetId, hoveredTargetId, pulse } = renderCtx;
        const labelBoxes = [];

        ctx.font = `10px ${RENDER_STYLE_TOKENS.tactical2d.fontFamily}`;
        targets.forEach((t) => {
            const track = this.trackHistory.get(t.id);
            if (this.enhancedVisualsEnabled) {
                this.drawTrackTrail(ctx, track, renderCtx);
                this.drawLastKnownGhost(ctx, t, track, renderCtx);
            }

            if (t.state !== TrackState.TRACKED) return;
            const screen = this.getTargetScreenPosition(t, centerX, centerY, ownShipPose, mode === 'radial', scale);
            const dx = screen.x;
            const dy = screen.y;
            const isSelected = selectedTargetId === t.id;
            const isHovered = hoveredTargetId === t.id;

            ctx.globalAlpha = isSelected ? 1.0 : 0.72;
            this.drawTrackUncertainty(ctx, dx, dy, t.snr, this.getTypeColor(t.type));

            if (this.enhancedVisualsEnabled) {
                this.drawThreatRing(ctx, t, dx, dy, isSelected);
                this.drawPredictedVector(ctx, t, dx, dy, ownShipPose, mode === 'radial', scale);
                if (this.predictionCompareEnabled) {
                    this.drawCourseOnlyVector(ctx, t, dx, dy, ownShipPose, mode === 'radial', scale);
                }
                if (isHovered && !isSelected) {
                    this.drawHoverRing(ctx, dx, dy);
                }
            }

            if (isSelected) {
                this.drawSelectionHUD(ctx, dx, dy, mode === 'radial' ? 12 : 10, pulse);
            }

            this.drawTargetGlyph(ctx, t.type, dx, dy, mode === 'radial');
            this.drawDepthCue(ctx, t, dx, dy);

            ctx.fillStyle = '#ffffff';
            ctx.globalAlpha = 1.0;
            const offset = mode === 'radial' ? 10 : 8;
            const label = t.id.replace('target-', 'T');
            const labelPos = this.resolveLabelPosition(ctx, dx + offset, dy, label, labelBoxes);
            ctx.fillText(label, labelPos.x, labelPos.y);
        });
        ctx.globalAlpha = 1.0;
    }

    drawScanLayer(ctx, renderCtx) {
        if (!this.scanActive) return;
        const { centerX, centerY, scale, style, mode } = renderCtx;
        const ownCenter = this.getOwnShipScreenCenter(centerX, centerY, scale);
        const scanColor = this.enhancedVisualsEnabled ? style.scan : '#00ffff';
        if (mode === 'radial') {
            const outerRadius = Math.max(0, this.scanRadius * scale);
            const innerRadius = Math.max(0, (this.scanRadius - 5) * scale);
            ctx.strokeStyle = scanColor;
            ctx.lineWidth = 2;
            if (outerRadius > 0) {
                ctx.beginPath();
                ctx.arc(ownCenter.x, ownCenter.y, outerRadius, 0, Math.PI * 2);
                ctx.stroke();
            }
            if (innerRadius > 0) {
                ctx.strokeStyle = this.enhancedVisualsEnabled ? `${scanColor}66` : 'rgba(0, 255, 255, 0.4)';
                ctx.beginPath();
                ctx.arc(ownCenter.x, ownCenter.y, innerRadius, 0, Math.PI * 2);
                ctx.stroke();
            }
            return;
        }

        ctx.strokeStyle = scanColor;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(ownCenter.x, ownCenter.y, this.scanRadius * scale, 0, Math.PI * 2);
        ctx.stroke();
    }

    drawOwnShipLayer(ctx, renderCtx) {
        const { mode, centerX, centerY, ownShipPose, style } = renderCtx;
        const ownShipColor = this.enhancedVisualsEnabled ? style.ownShip : '#00ff00';
        const ownCenter = this.getOwnShipScreenCenter(centerX, centerY, renderCtx.scale);
        ctx.save();
        ctx.translate(ownCenter.x, ownCenter.y);
        if (mode === 'radial') {
            ctx.beginPath();
            ctx.moveTo(0, -10);
            ctx.lineTo(5, 5);
            ctx.lineTo(-5, 5);
            ctx.closePath();
            ctx.fillStyle = ownShipColor;
            ctx.fill();
            ctx.restore();
            return;
        }

        const rotation = ownShipPose.course - Math.PI / 2;
        ctx.rotate(rotation);
        ctx.fillStyle = ownShipColor;
        ctx.beginPath();
        ctx.moveTo(8, 0);
        ctx.lineTo(-6, -6);
        ctx.lineTo(-6, 6);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
    }

    drawFxLayer(ctx, renderCtx) {
        if (!this.enhancedVisualsEnabled) return;
        const { width, height, pingFlashIntensity, style } = renderCtx;
        if (pingFlashIntensity <= 0.0001) return;

        const alpha = Math.min(0.35, pingFlashIntensity * 0.42);
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.fillStyle = style.pingFlash;
        ctx.fillRect(0, 0, width, height);
        ctx.restore();
    }

    drawHudLayer(ctx, renderCtx) {
        const { mode, centerX, centerY, ownShipPose, width, height, scale } = renderCtx;
        const ownShipLocal = { x: -this.cameraOffsetLocal.x, z: -this.cameraOffsetLocal.z };
        const adjustedCenterX = centerX + ownShipLocal.x * scale;
        const adjustedCenterY = centerY + ownShipLocal.z * scale;
        this.drawCoordinateDebugVectors(ctx, adjustedCenterX, adjustedCenterY, ownShipPose, mode);
        this.drawTerrainProbeAnchors(ctx, renderCtx);
        if (mode === 'radial') {
            this.drawRadialCompass(ctx, width, height, ownShipPose);
        }
    }

    drawTerrainProbeAnchors(ctx, renderCtx) {
        if (!this.debugCoordinatesEnabled) return;
        const { centerX, centerY, scale, ownShipPose, headUp, terrainProbes } = renderCtx;
        if (!Array.isArray(terrainProbes) || terrainProbes.length === 0) return;

        const colorById = {
            C: '#f5ff8a',
            N: '#8affff',
            E: '#ffb37d',
            S: '#8dff9c',
            W: '#d2b6ff'
        };

        ctx.save();
        ctx.font = '10px monospace';
        ctx.textBaseline = 'top';
        for (const probe of terrainProbes) {
            if (!probe || !Number.isFinite(probe.x) || !Number.isFinite(probe.z)) continue;
            const local = this.toLocalFrame(probe.x, probe.z, ownShipPose, headUp);
            const px = centerX + (local.x - this.cameraOffsetLocal.x) * scale;
            const py = centerY + (local.z - this.cameraOffsetLocal.z) * scale;
            const color = colorById[probe.id] || '#d9ffff';

            ctx.strokeStyle = color;
            ctx.fillStyle = color;
            ctx.lineWidth = probe.id === 'C' ? 2 : 1.2;
            ctx.beginPath();
            ctx.arc(px, py, probe.id === 'C' ? 6 : 4, 0, Math.PI * 2);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(px - 3, py);
            ctx.lineTo(px + 3, py);
            ctx.moveTo(px, py - 3);
            ctx.lineTo(px, py + 3);
            ctx.stroke();

            if (Number.isFinite(probe.depth)) {
                ctx.fillText(`${probe.id}:${probe.depth.toFixed(1)}`, px + 6, py + 4);
            } else {
                ctx.fillText(`${probe.id}:--`, px + 6, py + 4);
            }
        }
        ctx.restore();
    }

    ensureTerrainLayerInitialized() {
        if (this.terrainLayerReady || this.terrainLayerInitStarted) return;
        if (this.terrainVisualizationMode !== TERRAIN_VISUALIZATION_MODES.SHADER_BANDS) return;
        if (!this.container || typeof navigator === 'undefined' || !navigator.gpu) return;

        this.terrainLayerInitStarted = true;
        this.initTerrainLayer().catch((error) => {
            console.warn('2D terrain shader layer init failed; falling back to legacy contours:', error);
            this.terrainLayerInitStarted = false;
            this.terrainLayerReady = false;
            this.terrainVisualizationMode = TERRAIN_VISUALIZATION_MODES.LEGACY;
        });
    }

    async initTerrainLayer() {
        const webgpuModule = await import('three/webgpu');
        const WebGPURenderer = webgpuModule.WebGPURenderer || webgpuModule.default;
        if (!WebGPURenderer) {
            this.terrainLayerInitStarted = false;
            this.terrainVisualizationMode = TERRAIN_VISUALIZATION_MODES.LEGACY;
            return;
        }
        this.ensureTerrainHeightTexture();

        const renderer = new WebGPURenderer({ antialias: false, alpha: false });
        await renderer.init();
        renderer.autoClear = true;
        renderer.autoClearColor = true;
        renderer.setClearColor(0x000000, 1);
        const dpr = typeof window !== 'undefined' ? (window.devicePixelRatio || 1) : 1;
        const width = Math.max(1, Math.floor(this.container?.clientWidth || 1));
        const height = Math.max(1, Math.floor(this.container?.clientHeight || 1));
        renderer.setPixelRatio(dpr);
        renderer.setSize(width, height, false);

        const dom = renderer.domElement;
        dom.style.position = 'absolute';
        dom.style.top = '0';
        dom.style.left = '0';
        dom.style.width = '100%';
        dom.style.height = '100%';
        dom.style.pointerEvents = 'none';
        dom.style.display = 'none';

        if (this.container && this.canvas && this.canvas.parentElement === this.container) {
            this.container.insertBefore(dom, this.canvas);
        } else if (this.container) {
            this.container.appendChild(dom);
        }

        const scene = new THREE.Scene();
        const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
        camera.position.z = 0.5;

        const material = this.createTerrainBandsMaterial(webgpuModule);
        if (!material) {
            renderer.dispose();
            if (dom.parentElement) dom.parentElement.removeChild(dom);
            this.terrainLayerInitStarted = false;
            this.terrainVisualizationMode = TERRAIN_VISUALIZATION_MODES.LEGACY;
            return;
        }

        const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
        scene.add(mesh);

        this.webgpuModule = webgpuModule;
        this.terrainLayerScene = scene;
        this.terrainLayerCamera = camera;
        this.terrainLayerRenderer = renderer;
        this.terrainLayerMaterial = material;
        this.terrainLayerMesh = mesh;
        this.terrainLayerReady = true;
        this.terrainLayerInitStarted = false;
        dom.style.display = this.canvas?.style.display !== 'none' && this.isShaderTerrainModeActive() ? 'block' : 'none';
    }

    createTerrainBandsMaterial(webgpuModule) {
        const MeshBasicNodeMaterial = webgpuModule?.MeshBasicNodeMaterial;
        const TSL = webgpuModule?.TSL;
        if (!MeshBasicNodeMaterial || !TSL) return null;
        this.ensureTerrainHeightTexture();
        if (!this.terrainHeightTexture) return null;

        const material = new MeshBasicNodeMaterial();
        const uOwnX = TSL.uniform(0);
        const uOwnZ = TSL.uniform(0);
        const uCourse = TSL.uniform(0);
        const uHeadUp = TSL.uniform(0);
        const uOffsetX = TSL.uniform(0);
        const uOffsetZ = TSL.uniform(0);
        const uViewWorldWidth = TSL.uniform(1);
        const uViewWorldHeight = TSL.uniform(1);
        const uTileCenterX = TSL.uniform(0);
        const uTileCenterZ = TSL.uniform(0);
        const uTileSpan = TSL.uniform(256);
        const uMatchDebug = TSL.uniform(0);

        const uv = TSL.uv();
        const centeredX = uv.x.mul(2).sub(1);
        const centeredY = TSL.float(1).sub(uv.y.mul(2));
        const localX = centeredX.mul(uViewWorldWidth.mul(0.5)).add(uOffsetX);
        const localY = centeredY.mul(uViewWorldHeight.mul(0.5)).add(uOffsetZ);

        const sinCourse = TSL.sin(uCourse);
        const cosCourse = TSL.cos(uCourse);
        const rightX = cosCourse;
        const rightZ = sinCourse.negate();
        const forwardX = sinCourse;
        const forwardZ = cosCourse;

        const worldXNorth = uOwnX.add(localX);
        const worldZNorth = uOwnZ.sub(localY);
        const worldXHeadUp = uOwnX.add(rightX.mul(localX)).add(forwardX.mul(localY.negate()));
        const worldZHeadUp = uOwnZ.add(rightZ.mul(localX)).add(forwardZ.mul(localY.negate()));
        const worldX = TSL.mix(worldXNorth, worldXHeadUp, uHeadUp);
        const worldZ = TSL.mix(worldZNorth, worldZHeadUp, uHeadUp);

        const texU = worldX.sub(uTileCenterX).div(uTileSpan).add(0.5);
        const texV = uTileCenterZ.sub(worldZ).div(uTileSpan).add(0.5);
        const texUV = TSL.clamp(TSL.vec2(texU, texV), TSL.vec2(0), TSL.vec2(1));

        const heightSample = TSL.texture(this.terrainHeightTexture, texUV);
        const height = heightSample.r;
        const depth = TSL.max(TSL.float(1), height.negate().sub(2));
        const depthNorm = TSL.clamp(depth.div(220), 0, 1);

        const shallow = TSL.vec3(0.06, 0.28, 0.34);
        const deep = TSL.vec3(0.01, 0.05, 0.1);
        let color = TSL.mix(shallow, deep, depthNorm);

        const minorPhase = TSL.fract(height.add(80).div(4));
        const majorPhase = TSL.fract(height.add(80).div(8));
        const minorDist = TSL.min(minorPhase, TSL.float(1).sub(minorPhase));
        const majorDist = TSL.min(majorPhase, TSL.float(1).sub(majorPhase));
        const minorLine = TSL.float(1).sub(TSL.smoothstep(0.0, 0.018, minorDist));
        const majorLine = TSL.float(1).sub(TSL.smoothstep(0.0, 0.026, majorDist));
        color = TSL.mix(color, TSL.vec3(0.12, 0.5, 0.56), minorLine.mul(0.28));
        color = TSL.mix(color, TSL.vec3(0.2, 0.72, 0.79), majorLine.mul(0.6));

        // High-contrast terrain matching mode for visual verification.
        const band8 = TSL.fract(height.add(80).div(8));
        const band4 = TSL.fract(height.add(80).div(4));
        const parity = TSL.smoothstep(0.48, 0.52, band8);
        let debugColor = TSL.mix(TSL.vec3(0.08, 0.24, 0.36), TSL.vec3(0.42, 0.68, 0.84), parity);
        const debugMinor = TSL.float(1).sub(TSL.smoothstep(0.0, 0.03, TSL.min(band4, TSL.float(1).sub(band4))));
        const debugMajor = TSL.float(1).sub(TSL.smoothstep(0.0, 0.045, TSL.min(band8, TSL.float(1).sub(band8))));
        debugColor = TSL.mix(debugColor, TSL.vec3(0.92, 0.98, 1.0), debugMinor.mul(0.45));
        debugColor = TSL.mix(debugColor, TSL.vec3(1.0, 1.0, 0.86), debugMajor.mul(0.92));
        color = TSL.mix(color, debugColor, uMatchDebug);

        material.colorNode = color;
        this.terrainLayerUniforms = {
            ownX: uOwnX,
            ownZ: uOwnZ,
            course: uCourse,
            headUp: uHeadUp,
            offsetX: uOffsetX,
            offsetZ: uOffsetZ,
            viewWorldWidth: uViewWorldWidth,
            viewWorldHeight: uViewWorldHeight,
            tileCenterX: uTileCenterX,
            tileCenterZ: uTileCenterZ,
            tileSpan: uTileSpan,
            matchDebug: uMatchDebug
        };
        return material;
    }

    updateTerrainLayer(renderCtx) {
        if (this.terrainVisualizationMode === TERRAIN_VISUALIZATION_MODES.SHADER_BANDS && !this.terrainLayerReady) {
            this.ensureTerrainLayerInitialized();
        }

        if (!this.terrainLayerRenderer?.domElement) return;

        if (!this.isShaderTerrainModeActive()) {
            this.terrainLayerRenderer.domElement.style.display = 'none';
            return;
        }

        this.terrainLayerRenderer.domElement.style.display = this.canvas?.style.display === 'none' ? 'none' : 'block';
        const uniforms = this.terrainLayerUniforms;
        if (!uniforms) return;
        this.updateTerrainHeightTexture(renderCtx);
        const safeScale = Math.max(0.01, Number.isFinite(renderCtx.scale) ? renderCtx.scale : 1.5);
        uniforms.ownX.value = Number.isFinite(renderCtx.ownShipPose?.x) ? renderCtx.ownShipPose.x : 0;
        uniforms.ownZ.value = Number.isFinite(renderCtx.ownShipPose?.z) ? renderCtx.ownShipPose.z : 0;
        uniforms.course.value = Number.isFinite(renderCtx.ownShipPose?.course) ? renderCtx.ownShipPose.course : 0;
        uniforms.headUp.value = renderCtx.headUp ? 1 : 0;
        uniforms.offsetX.value = Number.isFinite(this.cameraOffsetLocal.x) ? this.cameraOffsetLocal.x : 0;
        uniforms.offsetZ.value = Number.isFinite(this.cameraOffsetLocal.z) ? this.cameraOffsetLocal.z : 0;
        uniforms.viewWorldWidth.value = renderCtx.width / safeScale;
        uniforms.viewWorldHeight.value = renderCtx.height / safeScale;
        uniforms.tileCenterX.value = Number.isFinite(this.terrainHeightTileCenter.x) ? this.terrainHeightTileCenter.x : 0;
        uniforms.tileCenterZ.value = Number.isFinite(this.terrainHeightTileCenter.z) ? this.terrainHeightTileCenter.z : 0;
        uniforms.tileSpan.value = Number.isFinite(this.terrainHeightTileSpan) ? Math.max(1, this.terrainHeightTileSpan) : 1;
        uniforms.matchDebug.value = this.debugCoordinatesEnabled ? 1 : 0;
        this.renderTerrainLayer();
    }

    ensureTerrainHeightTexture() {
        if (this.terrainHeightTexture && this.terrainHeightTextureData) return;
        const side = this.terrainHeightTextureSize;
        this.terrainHeightTextureData = new Float32Array(side * side * 4);
        const texture = new THREE.DataTexture(
            this.terrainHeightTextureData,
            side,
            side,
            THREE.RGBAFormat,
            THREE.FloatType
        );
        texture.generateMipmaps = false;
        texture.minFilter = THREE.LinearFilter;
        texture.magFilter = THREE.LinearFilter;
        texture.wrapS = THREE.ClampToEdgeWrapping;
        texture.wrapT = THREE.ClampToEdgeWrapping;
        texture.needsUpdate = true;
        this.terrainHeightTexture = texture;
    }

    updateTerrainHeightTexture(renderCtx) {
        if (!this.terrainHeightTexture || !this.terrainHeightTextureData) return;
        const { ownShipPose } = renderCtx;
        const ownX = Number.isFinite(ownShipPose?.x) ? ownShipPose.x : 0;
        const ownZ = Number.isFinite(ownShipPose?.z) ? ownShipPose.z : 0;

        const safeScale = Math.max(0.01, Number.isFinite(renderCtx.scale) ? renderCtx.scale : 1.5);
        const viewWorldWidth = renderCtx.width / safeScale;
        const viewWorldHeight = renderCtx.height / safeScale;
        const desiredSpan = Math.max(viewWorldWidth, viewWorldHeight) * 1.35;
        const quantizedSpan = Math.max(192, Math.ceil(desiredSpan / 32) * 32);
        const snap = Math.max(8, quantizedSpan / 14);

        let nextCenterX = this.terrainHeightTileCenter.x;
        let nextCenterZ = this.terrainHeightTileCenter.z;
        let rebuild = false;

        if (!Number.isFinite(nextCenterX) || !Number.isFinite(nextCenterZ) || this.terrainHeightTileSpan !== quantizedSpan) {
            nextCenterX = Math.round(ownX / snap) * snap;
            nextCenterZ = Math.round(ownZ / snap) * snap;
            rebuild = true;
        } else {
            while (ownX - nextCenterX > snap) {
                nextCenterX += snap;
                rebuild = true;
            }
            while (ownX - nextCenterX < -snap) {
                nextCenterX -= snap;
                rebuild = true;
            }
            while (ownZ - nextCenterZ > snap) {
                nextCenterZ += snap;
                rebuild = true;
            }
            while (ownZ - nextCenterZ < -snap) {
                nextCenterZ -= snap;
                rebuild = true;
            }
        }

        if (!rebuild) return;
        this.rebuildTerrainHeightTexture(nextCenterX, nextCenterZ, quantizedSpan, snap);
    }

    rebuildTerrainHeightTexture(centerX, centerZ, span, snap) {
        if (!this.terrainHeightTexture || !this.terrainHeightTextureData) return;
        const side = this.terrainHeightTextureSize;
        const data = this.terrainHeightTextureData;

        for (let y = 0; y < side; y++) {
            const v = side > 1 ? y / (side - 1) : 0;
            const worldZ = centerZ + ((0.5 - v) * span);
            for (let x = 0; x < side; x++) {
                const u = side > 1 ? x / (side - 1) : 0;
                const worldX = centerX + ((u - 0.5) * span);
                const height = this.getTerrainHeight(worldX, worldZ);
                const idx = (y * side + x) * 4;
                data[idx] = height;
                data[idx + 1] = 0;
                data[idx + 2] = 0;
                data[idx + 3] = 1;
            }
        }

        this.terrainHeightTileCenter.x = centerX;
        this.terrainHeightTileCenter.z = centerZ;
        this.terrainHeightTileSpan = span;
        this.terrainHeightTileSnap = snap;
        this.terrainHeightTexture.needsUpdate = true;
    }

    renderTerrainLayer() {
        if (!this.terrainLayerRenderer || !this.terrainLayerScene || !this.terrainLayerCamera) return;
        if (typeof this.terrainLayerRenderer.renderAsync === 'function') {
            if (this.terrainLayerRenderPending) return;
            this.terrainLayerRenderPending = true;
            this.terrainLayerRenderer.renderAsync(this.terrainLayerScene, this.terrainLayerCamera)
                .catch((error) => {
                    console.warn('2D terrain shader render failed:', error);
                })
                .finally(() => {
                    this.terrainLayerRenderPending = false;
                });
            return;
        }
        this.terrainLayerRenderer.render(this.terrainLayerScene, this.terrainLayerCamera);
    }

    disposeTerrainLayer() {
        if (this.terrainLayerMesh?.geometry) this.terrainLayerMesh.geometry.dispose();
        if (this.terrainLayerMaterial?.dispose) this.terrainLayerMaterial.dispose();
        if (this.terrainLayerRenderer?.domElement?.parentElement) {
            this.terrainLayerRenderer.domElement.parentElement.removeChild(this.terrainLayerRenderer.domElement);
        }
        if (this.terrainLayerRenderer) this.terrainLayerRenderer.dispose();
        this.webgpuModule = null;
        this.terrainLayerScene = null;
        this.terrainLayerCamera = null;
        this.terrainLayerRenderer = null;
        this.terrainLayerMaterial = null;
        this.terrainLayerMesh = null;
        this.terrainLayerUniforms = null;
        this.terrainLayerInitStarted = false;
        this.terrainLayerReady = false;
        this.terrainLayerRenderPending = false;
        if (this.terrainHeightTexture) this.terrainHeightTexture.dispose();
        this.terrainHeightTexture = null;
        this.terrainHeightTextureData = null;
        this.terrainHeightTileCenter.x = Number.NaN;
        this.terrainHeightTileCenter.z = Number.NaN;
        this.terrainHeightTileSpan = 0;
        this.terrainHeightTileSnap = 0;
    }

    updateViewTransform(targets, renderCtx) {
        const { mode, ownShipPose, selectedTargetId, dt } = renderCtx;
        const defaultScale = 1.5;

        let targetOffsetX = 0;
        let targetOffsetZ = 0;
        let desiredScale = defaultScale;

        if (mode === 'grid' && this.snapToContactEnabled && selectedTargetId && Array.isArray(targets)) {
            const selected = targets.find((t) => t.id === selectedTargetId && t.state === TrackState.TRACKED);
            if (selected) {
                const local = this.toLocalFrame(selected.x, selected.z, ownShipPose, false);
                targetOffsetX = local.x;
                targetOffsetZ = local.z;
                const range = Math.hypot(local.x, local.z);
                desiredScale = 1.2 + (1 - Math.min(220, range) / 220) * 1.0;
                desiredScale = Math.max(1.2, Math.min(2.2, desiredScale));
            }
        }

        if (mode !== 'grid') {
            this.cameraOffsetLocal.x = 0;
            this.cameraOffsetLocal.z = 0;
            this.cameraScale = defaultScale;
            return;
        }

        const easing = Math.max(0.03, Math.min(0.25, dt * 6.5));
        this.cameraOffsetLocal.x += (targetOffsetX - this.cameraOffsetLocal.x) * easing;
        this.cameraOffsetLocal.z += (targetOffsetZ - this.cameraOffsetLocal.z) * easing;
        this.cameraScale += (desiredScale - this.cameraScale) * easing;
    }

    getOwnShipScreenCenter(centerX, centerY, scale) {
        return {
            x: centerX - this.cameraOffsetLocal.x * scale,
            y: centerY - this.cameraOffsetLocal.z * scale
        };
    }

    getTargetScreenPosition(target, centerX, centerY, ownShipPose, headUp, scale) {
        const local = this.toLocalFrame(target.x, target.z, ownShipPose, headUp);
        return {
            x: centerX + (local.x - this.cameraOffsetLocal.x) * scale,
            y: centerY + (local.z - this.cameraOffsetLocal.z) * scale
        };
    }

    resolveLabelPosition(ctx, x, y, text, usedBoxes) {
        const width = ctx.measureText(text).width;
        const height = 10;
        const candidates = [
            { x, y },
            { x, y: y - 12 },
            { x: x + 10, y: y + 10 },
            { x: x - width - 8, y: y - 3 },
            { x: x + 12, y: y - 12 }
        ];

        for (const pos of candidates) {
            const box = { x: pos.x - 1, y: pos.y - height + 1, w: width + 2, h: height + 2 };
            const overlaps = usedBoxes.some((u) => this.boxesOverlap(box, u));
            if (!overlaps) {
                usedBoxes.push(box);
                return pos;
            }
        }

        const fallback = candidates[0];
        usedBoxes.push({ x: fallback.x - 1, y: fallback.y - height + 1, w: width + 2, h: height + 2 });
        return fallback;
    }

    boxesOverlap(a, b) {
        return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
    }

    drawHoverRing(ctx, x, y) {
        ctx.save();
        ctx.strokeStyle = 'rgba(220, 245, 255, 0.75)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(x, y, 11, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
    }

    updateTrackHistory(targets, ownShipPose) {
        const now = performance.now();
        const ttlMs = RENDER_STYLE_TOKENS.tactical2d.track.trailMs;
        const maxPoints = RENDER_STYLE_TOKENS.tactical2d.track.maxTrailPoints;

        for (const [id, history] of this.trackHistory.entries()) {
            const filtered = history.filter((p) => now - p.ts <= ttlMs);
            if (filtered.length === 0) {
                this.trackHistory.delete(id);
                continue;
            }
            this.trackHistory.set(id, filtered);
        }

        if (!Array.isArray(targets)) return;
        targets.forEach((t) => {
            const local = this.toLocalFrame(t.x, t.z, ownShipPose, false);
            if (t.state === TrackState.TRACKED) {
                const history = this.trackHistory.get(t.id) || [];
                history.push({ x: t.x, z: t.z, localX: local.x, localZ: local.z, ts: now, snr: t.snr || 0 });
                while (history.length > maxPoints) history.shift();
                this.trackHistory.set(t.id, history);
                this.trackGhosts.set(t.id, { x: t.x, z: t.z, ts: now });
            } else if (!this.trackGhosts.has(t.id)) {
                this.trackGhosts.set(t.id, { x: t.x, z: t.z, ts: now });
            }
        });
    }

    drawTrackTrail(ctx, history, renderCtx) {
        if (!history || history.length < 2) return;
        const now = performance.now();
        const ttlMs = RENDER_STYLE_TOKENS.tactical2d.track.trailMs;
        const { centerX, centerY, scale, ownShipPose, mode } = renderCtx;
        const headUp = mode === 'radial';
        const color = this.getModeStyle().labels;

        ctx.save();
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.beginPath();
        let moved = false;
        history.forEach((pt) => {
            const age = now - pt.ts;
            if (age > ttlMs) return;
            const alpha = Math.max(0.08, 1 - age / ttlMs);
            const local = this.toLocalFrame(pt.x, pt.z, ownShipPose, headUp);
            const x = centerX + local.x * scale;
            const y = centerY + local.z * scale;
            if (!moved) {
                ctx.moveTo(x, y);
                moved = true;
            } else {
                ctx.globalAlpha = alpha * 0.5;
                ctx.lineTo(x, y);
            }
        });
        ctx.stroke();
        ctx.restore();
    }

    drawLastKnownGhost(ctx, target, history, renderCtx) {
        if (!target || target.state === TrackState.TRACKED) return;
        const ghost = this.trackGhosts.get(target.id);
        if (!ghost) return;
        const ageMs = performance.now() - ghost.ts;
        if (ageMs > 30000) return;

        const { centerX, centerY, scale, ownShipPose, mode } = renderCtx;
        const local = this.toLocalFrame(ghost.x, ghost.z, ownShipPose, mode === 'radial');
        const x = centerX + local.x * scale;
        const y = centerY + local.z * scale;

        ctx.save();
        ctx.strokeStyle = 'rgba(255, 218, 120, 0.5)';
        ctx.setLineDash([3, 3]);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(x, y, 8, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();

        if (history?.length) {
            const last = history[history.length - 1];
            const bearing = Math.atan2(last.localX, -last.localZ);
            const label = `${Math.round((ageMs / 1000) * 10) / 10}s`;
            ctx.save();
            ctx.fillStyle = 'rgba(255, 220, 160, 0.8)';
            ctx.font = `9px ${RENDER_STYLE_TOKENS.tactical2d.fontFamily}`;
            ctx.fillText(label, x + Math.cos(bearing) * 10, y + Math.sin(bearing) * 10);
            ctx.restore();
        }
    }

    drawPredictedVector(ctx, target, dx, dy, ownShipPose, headUp, scale) {
        if (!Number.isFinite(target.speed) || target.speed < 0.001) return;

        const predictionMeters = Math.max(
            RENDER_STYLE_TOKENS.tactical2d.track.minPredictionMeters,
            Math.min(RENDER_STYLE_TOKENS.tactical2d.track.maxPredictionMeters, target.speed * 70)
        );
        let dirX = 0;
        let dirZ = 0;

        // Use observed motion first so prediction aligns with actual movement on screen.
        const history = this.trackHistory.get(target.id);
        if (history && history.length >= 2) {
            const a = history[history.length - 2];
            const b = history[history.length - 1];
            const dxHist = b.x - a.x;
            const dzHist = b.z - a.z;
            const magHist = Math.hypot(dxHist, dzHist);
            if (magHist > 1e-6) {
                dirX = dxHist / magHist;
                dirZ = dzHist / magHist;
            }
        }

        // Fallback to simulation course convention when motion history is not yet available.
        if (Math.hypot(dirX, dirZ) < 1e-6) {
            if (Number.isFinite(target.course)) {
                dirX = Math.cos(target.course);
                dirZ = Math.sin(target.course);
            } else if (Number.isFinite(target.bearing)) {
                const bearingRad = (target.bearing * Math.PI) / 180;
                dirX = Math.sin(bearingRad);
                dirZ = Math.cos(bearingRad);
            }
        }

        const dirMag = Math.hypot(dirX, dirZ);
        if (dirMag < 1e-6) return;
        dirX /= dirMag;
        dirZ /= dirMag;

        const targetLocal = this.toLocalFrame(target.x, target.z, ownShipPose, headUp);
        const predWorldX = target.x + dirX * predictionMeters;
        const predWorldZ = target.z + dirZ * predictionMeters;
        const predLocal = this.toLocalFrame(predWorldX, predWorldZ, ownShipPose, headUp);
        const px = dx + (predLocal.x - targetLocal.x) * scale;
        const py = dy + (predLocal.z - targetLocal.z) * scale;

        ctx.save();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.38)';
        ctx.setLineDash([4, 4]);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(dx, dy);
        ctx.lineTo(px, py);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
    }

    drawCourseOnlyVector(ctx, target, dx, dy, ownShipPose, headUp, scale) {
        if (!Number.isFinite(target.course) || !Number.isFinite(target.speed) || target.speed < 0.001) return;

        const predictionMeters = Math.max(
            RENDER_STYLE_TOKENS.tactical2d.track.minPredictionMeters,
            Math.min(RENDER_STYLE_TOKENS.tactical2d.track.maxPredictionMeters, target.speed * 70)
        );
        const dirX = Math.cos(target.course);
        const dirZ = Math.sin(target.course);
        const predWorldX = target.x + dirX * predictionMeters;
        const predWorldZ = target.z + dirZ * predictionMeters;
        const targetLocal = this.toLocalFrame(target.x, target.z, ownShipPose, headUp);
        const predLocal = this.toLocalFrame(predWorldX, predWorldZ, ownShipPose, headUp);
        const px = dx + (predLocal.x - targetLocal.x) * scale;
        const py = dy + (predLocal.z - targetLocal.z) * scale;

        ctx.save();
        ctx.strokeStyle = 'rgba(255, 170, 90, 0.78)';
        ctx.setLineDash([2, 3]);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(dx, dy);
        ctx.lineTo(px, py);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
    }

    drawThreatRing(ctx, target, dx, dy, isSelected) {
        const isThreat = target.type === 'TORPEDO' || (target.type === 'SUBMARINE' && (target.snr || 0) > 2.6);
        if (!isThreat) return;

        const base = target.type === 'TORPEDO' ? '255, 90, 90' : '255, 182, 94';
        const alpha = isSelected ? 0.4 : RENDER_STYLE_TOKENS.tactical2d.track.threatRingAlpha;
        const radius = target.type === 'TORPEDO' ? 20 : 14;
        ctx.save();
        ctx.strokeStyle = `rgba(${base}, ${alpha})`;
        ctx.lineWidth = isSelected ? 2 : 1;
        ctx.beginPath();
        ctx.arc(dx, dy, radius, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
    }

    drawCoordinateDebugVectors(ctx, centerX, centerY, ownShipPose, mode) {
        if (!this.debugCoordinatesEnabled) return;

        const ownX = ownShipPose?.x || 0;
        const ownZ = ownShipPose?.z || 0;
        const headUp = mode === 'radial';
        const dirWorldDistance = 28;

        const northLocal = this.toLocalFrame(ownX, ownZ + dirWorldDistance, ownShipPose, headUp);
        const eastLocal = this.toLocalFrame(ownX + dirWorldDistance, ownZ, ownShipPose, headUp);

        const aheadWorld = shipLocalToWorld(
            { x: 0, y: 0, z: dirWorldDistance },
            { x: ownX, y: 0, z: ownZ },
            ownShipPose?.course || 0
        );
        const forwardLocal = this.toLocalFrame(aheadWorld.x, aheadWorld.z, ownShipPose, headUp);

        this.drawDirectionArrow(ctx, centerX, centerY, northLocal.x, northLocal.z, '#00ffff', 'N');
        this.drawDirectionArrow(ctx, centerX, centerY, eastLocal.x, eastLocal.z, '#ff55ff', 'E');
        this.drawDirectionArrow(ctx, centerX, centerY, forwardLocal.x, forwardLocal.z, '#00ff00', 'F');
    }

    drawDirectionArrow(ctx, centerX, centerY, localX, localZ, color, label) {
        const len = Math.hypot(localX, localZ);
        if (!Number.isFinite(len) || len < 0.001) return;

        const scale = 36 / len;
        const dx = localX * scale;
        const dy = localZ * scale;

        ctx.save();
        ctx.strokeStyle = color;
        ctx.fillStyle = color;
        ctx.lineWidth = 2;

        ctx.beginPath();
        ctx.moveTo(centerX, centerY);
        ctx.lineTo(centerX + dx, centerY + dy);
        ctx.stroke();

        const angle = Math.atan2(dy, dx);
        const head = 7;
        ctx.beginPath();
        ctx.moveTo(centerX + dx, centerY + dy);
        ctx.lineTo(centerX + dx - Math.cos(angle - Math.PI / 6) * head, centerY + dy - Math.sin(angle - Math.PI / 6) * head);
        ctx.lineTo(centerX + dx - Math.cos(angle + Math.PI / 6) * head, centerY + dy - Math.sin(angle + Math.PI / 6) * head);
        ctx.closePath();
        ctx.fill();

        ctx.font = '10px monospace';
        ctx.fillText(label, centerX + dx + 4, centerY + dy - 4);
        ctx.restore();
    }

    drawRadialCompass(ctx, width, _height, ownShipPose = { course: 0 }) {
        const radius = 34;
        const cx = width - radius - 12;
        const cy = radius + 12;
        const course = Number.isFinite(ownShipPose?.course) ? ownShipPose.course : 0;

        ctx.save();

        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(0, 255, 255, 0.45)';
        ctx.lineWidth = 1;
        ctx.stroke();

        // In head-up radial view, screen up is ship-forward.
        // North direction in screen space rotates by -course from up.
        const nx = -Math.sin(course);
        const ny = -Math.cos(course);
        const len = radius - 8;
        const tipX = cx + nx * len;
        const tipY = cy + ny * len;

        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(tipX, tipY);
        ctx.strokeStyle = 'rgba(255, 80, 80, 0.95)';
        ctx.lineWidth = 2;
        ctx.stroke();

        const angle = Math.atan2(ny, nx);
        const head = 7;
        ctx.beginPath();
        ctx.moveTo(tipX, tipY);
        ctx.lineTo(tipX - Math.cos(angle - Math.PI / 6) * head, tipY - Math.sin(angle - Math.PI / 6) * head);
        ctx.lineTo(tipX - Math.cos(angle + Math.PI / 6) * head, tipY - Math.sin(angle + Math.PI / 6) * head);
        ctx.closePath();
        ctx.fillStyle = 'rgba(255, 80, 80, 0.95)';
        ctx.fill();

        const labelRadius = radius - 7;
        const labelX = cx + nx * labelRadius;
        const labelY = cy + ny * labelRadius;
        const labelAngle = Math.atan2(ny, nx) + Math.PI / 2;
        ctx.save();
        ctx.translate(labelX, labelY);
        ctx.rotate(labelAngle);
        ctx.fillStyle = '#9bffff';
        ctx.font = '10px monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('N', 0, 0);
        ctx.restore();

        ctx.beginPath();
        ctx.arc(cx, cy, 3, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(200, 255, 255, 0.85)';
        ctx.fill();

        ctx.restore();
    }

    drawTrackUncertainty(ctx, x, y, snr, color) {
        const safeSnr = Math.max(0, snr || 0);
        const radius = 15 / Math.log(safeSnr + 1.1);
        const rx = Math.max(8, Math.min(80, radius));
        const ry = rx * 0.65;
        const confidence = Math.max(0, Math.min(1, safeSnr / 3.5));
        const alpha = this.enhancedVisualsEnabled ? 0.15 + (1 - confidence) * 0.6 : 1;

        ctx.save();
        ctx.strokeStyle = color || '#00ffff';
        ctx.lineWidth = 1;
        ctx.globalAlpha = alpha;
        ctx.setLineDash(this.enhancedVisualsEnabled ? [3 + (1 - confidence) * 5, 3] : [5, 4]);
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

    drawTerrainContours(ctx, width, height, scale, radialMode, ownShipPose, headUp) {
        if (!TERRAIN_ISOLINE_GENERATION_ENABLED && !TERRAIN_ISOLINE_DRAWING_ENABLED) return;
        const profileEnabled = this.profileContoursEnabled && typeof performance !== 'undefined';
        const lookupStart = profileEnabled ? performance.now() : 0;
        const layers = this.getContourLayers(width, height, scale, radialMode, ownShipPose, headUp);
        const lookupEnd = profileEnabled ? performance.now() : 0;
        if (profileEnabled) {
            this._contourProfileStats.frameCount += 1;
            this._contourProfileStats.lookupMs += (lookupEnd - lookupStart);
        }

        const strokeStart = profileEnabled ? performance.now() : 0;
        if (TERRAIN_ISOLINE_DRAWING_ENABLED) {
            for (const layer of layers) {
                ctx.strokeStyle = layer.strokeStyle;
                ctx.lineWidth = layer.lineWidth;
                ctx.stroke(layer.path);
            }
        }
        if (!profileEnabled) return;

        const now = performance.now();
        this._contourProfileStats.strokeMs += (now - strokeStart);
        if (this._contourProfileStats.lastLogAt === 0) {
            this._contourProfileStats.lastLogAt = now;
            return;
        }

        if (now - this._contourProfileStats.lastLogAt < 2000 || this._contourProfileStats.frameCount < 30) return;

        const stats = this._contourProfileStats;
        const totalLookups = stats.cacheHits + stats.cacheMisses;
        const missRate = totalLookups > 0 ? (stats.cacheMisses / totalLookups) * 100 : 0;
        const avgLookupMs = stats.frameCount > 0 ? stats.lookupMs / stats.frameCount : 0;
        const avgStrokeMs = stats.frameCount > 0 ? stats.strokeMs / stats.frameCount : 0;
        const avgGenerationMs = stats.cacheMisses > 0 ? stats.generationMs / stats.cacheMisses : 0;
        console.info(
            `[perf][2d-contours] frames=${stats.frameCount} misses=${stats.cacheMisses}/${totalLookups} (${missRate.toFixed(1)}%) ` +
            `avgLookup=${avgLookupMs.toFixed(2)}ms avgGenMiss=${avgGenerationMs.toFixed(2)}ms avgStroke=${avgStrokeMs.toFixed(2)}ms ` +
            `cacheSize=${this.contourCache.size}`
        );

        stats.frameCount = 0;
        stats.cacheHits = 0;
        stats.cacheMisses = 0;
        stats.lookupMs = 0;
        stats.generationMs = 0;
        stats.strokeMs = 0;
        stats.lastLogAt = now;
    }

    getContourLayers(width, height, scale, radialMode, ownShipPose = { x: 0, z: 0, course: 0 }, headUp = false) {
        if (!TERRAIN_ISOLINE_GENERATION_ENABLED) return [];
        const profileEnabled = this.profileContoursEnabled && typeof performance !== 'undefined';
        const px = Math.round((ownShipPose.x || 0) * 2) / 2;
        const pz = Math.round((ownShipPose.z || 0) * 2) / 2;
        const pc = Math.round((ownShipPose.course || 0) * 20) / 20;
        const ox = Math.round((this.cameraOffsetLocal.x || 0) / 4) * 4;
        const oz = Math.round((this.cameraOffsetLocal.z || 0) / 4) * 4;
        const key = `${radialMode ? 'radial' : 'grid'}:${width}:${height}:${scale}:${px}:${pz}:${pc}:${headUp ? 1 : 0}:${ox}:${oz}`;
        const cached = this.contourCache.get(key);
        if (cached) {
            if (profileEnabled) this._contourProfileStats.cacheHits += 1;
            return cached;
        }
        if (profileEnabled) this._contourProfileStats.cacheMisses += 1;
        const generationStart = profileEnabled ? performance.now() : 0;

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
                    const s00 = this.localToWorld(wx, wz, ownShipPose, headUp);
                    const s10 = this.localToWorld(wx + gridStep, wz, ownShipPose, headUp);
                    const s11 = this.localToWorld(wx + gridStep, wz + gridStep, ownShipPose, headUp);
                    const s01 = this.localToWorld(wx, wz + gridStep, ownShipPose, headUp);

                    const p00 = { x: wx, y: wz, h: this.getTerrainHeight(s00.x, s00.z) };
                    const p10 = { x: wx + gridStep, y: wz, h: this.getTerrainHeight(s10.x, s10.z) };
                    const p11 = { x: wx + gridStep, y: wz + gridStep, h: this.getTerrainHeight(s11.x, s11.z) };
                    const p01 = { x: wx, y: wz + gridStep, h: this.getTerrainHeight(s01.x, s01.z) };

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
                        const sa = this.mapWorldToScreen(a.x, a.y, centerX, centerY, scale, radialMode, headUp);
                        const sb = this.mapWorldToScreen(b.x, b.y, centerX, centerY, scale, radialMode, headUp);
                        path.moveTo(sa.x, sa.y);
                        path.lineTo(sb.x, sb.y);
                    });
                }
            }

            layers.push({
                path,
                strokeStyle: major ? this.getModeStyle().contourMajor : this.getModeStyle().contourMinor,
                lineWidth: major ? 1 : 0.6
            });
        });

        this.contourCache.set(key, layers);
        if (this.contourCache.size > 28) {
            const oldestKey = this.contourCache.keys().next().value;
            if (oldestKey) this.contourCache.delete(oldestKey);
        }
        if (profileEnabled) {
            this._contourProfileStats.generationMs += (performance.now() - generationStart);
        }
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

    mapWorldToScreen(wx, wz, centerX, centerY, scale, radialMode, headUp) {
        const offsetX = this.cameraOffsetLocal.x;
        const offsetZ = this.cameraOffsetLocal.z;
        if (radialMode || headUp) {
            return {
                x: centerX + (wx - offsetX) * scale,
                y: centerY + (wz - offsetZ) * scale
            };
        }

        return {
            x: centerX + (wx - offsetX) * scale,
            y: centerY + (wz - offsetZ) * scale
        };
    }

    toLocalFrame(worldX, worldZ, ownShipPose = { x: 0, z: 0, course: 0 }, headUp = false) {
        const local = worldToShipLocal(
            { x: worldX, y: 0, z: worldZ },
            { x: ownShipPose.x || 0, y: 0, z: ownShipPose.z || 0 },
            ownShipPose.course || 0
        );

        if (!headUp) {
            // North-up display in world frame.
            return {
                x: (worldX - (ownShipPose.x || 0)),
                z: -(worldZ - (ownShipPose.z || 0))
            };
        }

        return {
            x: local.x,
            z: -local.z
        };
    }

    localToWorld(screenOffsetX, screenOffsetY, ownShipPose = { x: 0, z: 0, course: 0 }, headUp = false) {
        if (!headUp) {
            return {
                x: (ownShipPose.x || 0) + screenOffsetX,
                z: (ownShipPose.z || 0) - screenOffsetY
            };
        }

        const world = shipLocalToWorld(
            { x: screenOffsetX, y: 0, z: -screenOffsetY },
            { x: ownShipPose.x || 0, y: 0, z: ownShipPose.z || 0 },
            ownShipPose.course || 0
        );

        return {
            x: world.x,
            z: world.z
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
