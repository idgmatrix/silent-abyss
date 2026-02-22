import * as THREE from 'three';
import { CavitationParticles } from './effects/cavitation-particles.js';
import { shipLocalToWorld } from './coordinate-system.js';

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function expSmoothingAlpha(responsiveness, dt) {
    const safeDt = Number.isFinite(dt) ? Math.max(0, dt) : 0;
    const safeResp = Number.isFinite(responsiveness) ? Math.max(0, responsiveness) : 0;
    return 1 - Math.exp(-safeResp * safeDt);
}

function readRendererPreference() {
    if (typeof window === 'undefined') return 'webgpu';
    try {
        const params = new URLSearchParams(window.location.search || '');
        const queryRenderer = params.get('renderer');
        if (queryRenderer === 'webgpu' || queryRenderer === 'webgl') {
            return queryRenderer;
        }
        const stored = window.localStorage.getItem('silentAbyss.renderer');
        if (stored === 'webgpu' || stored === 'webgl') {
            return stored;
        }
    } catch {
        // Fallback to WebGPU by default; query/localStorage can override.
    }
    return 'webgpu';
}

export class Tactical3DRenderer {
    constructor(getTerrainHeight) {
        this.getTerrainHeight = typeof getTerrainHeight === 'function' ? getTerrainHeight : () => 0;

        this.container = null;
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.rendererBackend = 'webgl';
        this.rendererPreference = readRendererPreference();
        this.webgpuModule = null;
        this.compassRoot = null;
        this.compassNeedle = null;
        this.compassNorthLabel = null;
        this.underwaterLightRig = null;
        this.primarySunLight = null;
        this.ambientUnderwaterLight = null;
        this.fillUnderwaterLight = null;
        this.postFxOverlay = null;

        this.terrain = null;
        this.terrainPointCloud = null;
        this.terrainGridLines = null;
        this.waterSurface = null;
        this.webgpuTerrainMaterial = null;
        this.webgpuWaterMaterial = null;
        this.webgpuTerrainNodes = null;
        this.webgpuWaterNodes = null;
        this.causticTexture = null;
        this.causticCanvas = null;
        this.causticCtx = null;
        this.scanRingFx = null;
        this.terrainContours = null;
        this.terrainContoursMajor = null;
        this.terrainContoursMinor = null;

        this.ownShipRoot = null;
        this.ownShipMesh = null;
        this.verticalGuideLine = null;
        this.shipAxisGizmos = null;
        this.worldAxisGizmos = null;
        this.worldNorthArrow = null;
        this.worldEastArrow = null;

        this.selectionRing = null;
        this.marineSnow = null;
        this.marineSnowLayers = [];
        this.ownWakeParticles = null;
        this._ownWakeParticleState = null;
        this.targetMeshes = new Map();

        this.cavitationParticles = new CavitationParticles();
        this._cavitationPending = false;
        this._renderPending = false;

        this._lastTerrainGridCenter = { x: Number.NaN, z: Number.NaN };
        this._terrainSnapStep = 5.0;
        this._terrainSize = 300;
        this._terrainSegments = 60;
        this._contourLevels = [-18, -14, -10, -6, -2, 2, 6];

        this.followCameraOffsetLocal = new THREE.Vector3(0, 16, -42);
        this.followLookAtOffsetLocal = new THREE.Vector3(0, 6, 45);
        this.cameraPositionResponsiveness = 7.5;
        this.cameraLookResponsiveness = 10.0;
        this.cameraSwayBaseAmplitude = 0.18;
        this.cameraSwaySpeedAmplitude = 0.32;
        this.cameraSwayFrequency = 0.85;

        this._currentLookAt = new THREE.Vector3();
        this._cameraReady = false;
        this._tmpVec3A = new THREE.Vector3();
        this._tmpVec3B = new THREE.Vector3();
        this._tmpWorldPos = new THREE.Vector3();
        this._tmpCamForward = new THREE.Vector3();
        this._elapsedTime = 0;

        this.baseFogDensity = 0.0052;
        this.depthFogDensityFactor = 0.00048;
        this.minFogDensity = 0.0044;
        this.maxFogDensity = 0.024;
        this.fogColorShallow = new THREE.Color(0x0b2730);
        this.fogColorDeep = new THREE.Color(0x031017);
        this.underwaterColorGrade = {
            enabled: true,
            cssFilter: 'saturate(0.78) hue-rotate(-12deg) contrast(0.9) brightness(0.9)',
            exposure: 0.82
        };
        this.atmospherePreset = 'balanced';
        this._atmosphereProfiles = {
            subtle: {
                fog: {
                    baseDensity: 0.0042,
                    depthFactor: 0.00036,
                    minDensity: 0.0036,
                    maxDensity: 0.0195,
                    shallowColor: 0x12303a,
                    deepColor: 0x06171f
                },
                colorGrade: {
                    enabled: true,
                    cssFilter: 'saturate(0.9) hue-rotate(-6deg) contrast(0.96) brightness(0.96)',
                    exposure: 0.88
                },
                lighting: {
                    ambientColor: 0x163842,
                    ambientIntensity: 0.64,
                    fillSkyColor: 0x5fa4b6,
                    fillGroundColor: 0x08151c,
                    fillIntensity: 0.28,
                    sunColor: 0x9fcbd8,
                    sunIntensity: 0.78,
                    sunFadeByDepth: 0.28
                },
                polish: {
                    causticIntensity: 0.12,
                    causticScale: 0.05,
                    causticSpeed: 1.0,
                    desatNear: 72,
                    desatFar: 290,
                    vignetteOpacity: 0.22,
                    grainOpacity: 0.03
                }
            },
            balanced: {
                fog: {
                    baseDensity: 0.0052,
                    depthFactor: 0.00048,
                    minDensity: 0.0044,
                    maxDensity: 0.024,
                    shallowColor: 0x0b2730,
                    deepColor: 0x031017
                },
                colorGrade: {
                    enabled: true,
                    cssFilter: 'saturate(0.78) hue-rotate(-12deg) contrast(0.9) brightness(0.9)',
                    exposure: 0.82
                },
                lighting: {
                    ambientColor: 0x11333d,
                    ambientIntensity: 0.75,
                    fillSkyColor: 0x4d95a8,
                    fillGroundColor: 0x041015,
                    fillIntensity: 0.35,
                    sunColor: 0x7fb3c4,
                    sunIntensity: 0.9,
                    sunFadeByDepth: 0.42
                },
                polish: {
                    causticIntensity: 0.18,
                    causticScale: 0.06,
                    causticSpeed: 1.3,
                    desatNear: 52,
                    desatFar: 230,
                    vignetteOpacity: 0.3,
                    grainOpacity: 0.045
                }
            },
            cinematic: {
                fog: {
                    baseDensity: 0.0078,
                    depthFactor: 0.00064,
                    minDensity: 0.0064,
                    maxDensity: 0.03,
                    shallowColor: 0x081d26,
                    deepColor: 0x02090f
                },
                colorGrade: {
                    enabled: true,
                    cssFilter: 'saturate(0.68) hue-rotate(-18deg) contrast(0.84) brightness(0.82)',
                    exposure: 0.74
                },
                lighting: {
                    ambientColor: 0x0c2831,
                    ambientIntensity: 0.82,
                    fillSkyColor: 0x3f7886,
                    fillGroundColor: 0x020b10,
                    fillIntensity: 0.26,
                    sunColor: 0x6ca2b3,
                    sunIntensity: 0.68,
                    sunFadeByDepth: 0.55
                },
                polish: {
                    causticIntensity: 0.23,
                    causticScale: 0.07,
                    causticSpeed: 1.5,
                    desatNear: 36,
                    desatFar: 180,
                    vignetteOpacity: 0.4,
                    grainOpacity: 0.07
                }
            }
        };
        this._activeLightingProfile = this._atmosphereProfiles.balanced.lighting;
        this._activePolishProfile = this._atmosphereProfiles.balanced.polish;

        this.debugCoordinatesEnabled = false;
        this.terrainRenderStyle = 'default';
        this._scanRadius = 0;
        this._scanActive = false;
    }

    async init(container) {
        if (this.renderer || !container) return;

        this.container = container;
        this.scene = new THREE.Scene();
        this.scene.background = this.fogColorShallow.clone();
        this.scene.fog = new THREE.FogExp2(this.fogColorShallow.clone(), this.baseFogDensity);

        const initWidth = Math.max(1, Math.floor(container.clientWidth || 0));
        const initHeight = Math.max(1, Math.floor(container.clientHeight || 0));

        this.camera = new THREE.PerspectiveCamera(60, initWidth / initHeight, 0.1, 1400);
        this.camera.position.set(0, 40, 100);
        this.camera.lookAt(0, 0, 0);

        this.renderer = await this._createRenderer();
        this.renderer.setPixelRatio(window.devicePixelRatio || 1);
        this.renderer.setSize(initWidth, initHeight);
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = this.underwaterColorGrade.exposure;
        this.renderer.domElement.style.position = 'absolute';
        this.renderer.domElement.style.top = '0';
        this.renderer.domElement.style.left = '0';
        this.renderer.domElement.style.width = '100%';
        this.renderer.domElement.style.height = '100%';
        this.applyRendererColorGrade();
        container.appendChild(this.renderer.domElement);
        this.setupPostFxOverlay(container);
        this.setupCompassOverlay(container);
        this.setupUnderwaterLighting();

        this.setupTerrain();
        this.setupWaterSurface();
        this.setupOwnShip();
        this.setupSelectionRing();
        this.setupMarineSnow();
        this.setupOwnWakeParticles();
        this.applyAtmospherePreset();

        await this.cavitationParticles.init(this.scene);
    }

    async _createRenderer() {
        if (this.rendererPreference === 'webgpu') {
            const webgpuAvailable = typeof navigator !== 'undefined' && !!navigator.gpu;

            if (webgpuAvailable) {
                try {
                    const webgpuModule = await import('three/webgpu');
                    const WebGPURenderer = webgpuModule.WebGPURenderer || webgpuModule.default;
                    if (WebGPURenderer) {
                        const renderer = new WebGPURenderer({ antialias: true, alpha: true });
                        if (typeof renderer.init === 'function') {
                            await renderer.init();
                        }
                        this.webgpuModule = webgpuModule;
                        this.rendererBackend = 'webgpu';
                        return renderer;
                    }
                } catch (error) {
                    console.warn('Failed to create WebGPU renderer, using WebGL fallback:', error);
                }
            }
        }

        this.rendererBackend = 'webgl';
        this.webgpuModule = null;
        return new THREE.WebGLRenderer({ antialias: true, alpha: true });
    }

    dispose() {
        this.cavitationParticles.dispose();

        if (this.scene) {
            this.scene.traverse((object) => {
                if (object.geometry) object.geometry.dispose();
                if (object.material) {
                    if (Array.isArray(object.material)) {
                        object.material.forEach((mat) => mat.dispose());
                    } else {
                        object.material.dispose();
                    }
                }
            });
        }

        if (this.renderer) {
            this.renderer.dispose();
            if (this.renderer.domElement && this.renderer.domElement.parentElement) {
                this.renderer.domElement.parentElement.removeChild(this.renderer.domElement);
            }
        }

        this.container = null;
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.rendererBackend = 'webgl';
        if (this.compassRoot && this.compassRoot.parentElement) {
            this.compassRoot.parentElement.removeChild(this.compassRoot);
        }
        this.compassRoot = null;
        this.compassNeedle = null;
        this.compassNorthLabel = null;
        if (this.postFxOverlay && this.postFxOverlay.parentElement) {
            this.postFxOverlay.parentElement.removeChild(this.postFxOverlay);
        }
        this.postFxOverlay = null;
        this.underwaterLightRig = null;
        this.primarySunLight = null;
        this.ambientUnderwaterLight = null;
        this.fillUnderwaterLight = null;
        if (this.causticTexture) {
            this.causticTexture.dispose();
        }
        this.causticTexture = null;
        this.causticCanvas = null;
        this.causticCtx = null;

        this.terrain = null;
        this.terrainPointCloud = null;
        this.terrainGridLines = null;
        this.waterSurface = null;
        this.webgpuTerrainMaterial = null;
        this.webgpuWaterMaterial = null;
        this.webgpuTerrainNodes = null;
        this.webgpuWaterNodes = null;
        this.causticTexture = null;
        this.causticCanvas = null;
        this.causticCtx = null;
        this.scanRingFx = null;
        this.terrainContours = null;
        this.terrainContoursMajor = null;
        this.terrainContoursMinor = null;
        this.ownShipRoot = null;
        this.ownShipMesh = null;
        this.verticalGuideLine = null;
        this.shipAxisGizmos = null;
        this.worldAxisGizmos = null;
        this.worldNorthArrow = null;
        this.worldEastArrow = null;
        this.selectionRing = null;
        this.marineSnow = null;
        this.marineSnowLayers = [];
        this.ownWakeParticles = null;
        this._ownWakeParticleState = null;

        this.targetMeshes.clear();

        this._cavitationPending = false;
        this._renderPending = false;
        this._lastTerrainGridCenter = { x: Number.NaN, z: Number.NaN };
        this._cameraReady = false;
    }

    setVisible(visible) {
        if (!this.renderer) return;
        this.renderer.domElement.style.display = visible ? 'block' : 'none';
        if (this.postFxOverlay) {
            this.postFxOverlay.style.display = visible ? 'block' : 'none';
        }
        if (this.compassRoot) {
            this.compassRoot.style.display = visible ? 'block' : 'none';
        }
    }

    setDebugCoordinatesEnabled(enabled) {
        this.debugCoordinatesEnabled = !!enabled;
        if (this.shipAxisGizmos) {
            this.shipAxisGizmos.visible = this.debugCoordinatesEnabled;
        }
        if (this.worldAxisGizmos) {
            this.worldAxisGizmos.visible = this.debugCoordinatesEnabled;
        }
    }

    setTerrainRenderStyle(style) {
        this.terrainRenderStyle = style === 'point-cloud' ? 'point-cloud' : 'default';
        this.applyTerrainRenderStyle();
    }

    setAtmospherePreset(presetName) {
        const preset = typeof presetName === 'string' ? presetName.toLowerCase() : '';
        this.atmospherePreset = this._atmosphereProfiles[preset] ? preset : 'balanced';
        this.applyAtmospherePreset();
    }

    getAtmospherePreset() {
        return this.atmospherePreset;
    }

    applyTerrainRenderStyle() {
        const usePointCloud = this.terrainRenderStyle === 'point-cloud';

        if (this.terrain) this.terrain.visible = !usePointCloud;
        if (this.terrainGridLines) this.terrainGridLines.visible = !usePointCloud;
        if (this.terrainContours) this.terrainContours.visible = !usePointCloud;
        if (this.waterSurface) this.waterSurface.visible = !usePointCloud;
        if (this.terrainPointCloud) this.terrainPointCloud.visible = usePointCloud;
        if (this.scanRingFx) {
            this.scanRingFx.visible = this._scanActive && !usePointCloud;
        }
    }

    modelToScenePosition(x, z) {
        return { x, z: -z };
    }

    sceneCourseFromModelCourse(course) {
        return Math.PI - course;
    }

    getTerrainHeightAtScene(sceneX, sceneZ) {
        return this.getTerrainHeight(sceneX, -sceneZ);
    }

    resize(width, height) {
        if (!this.renderer || !this.camera) return;
        const safeWidth = Math.max(1, Math.floor(width || 0));
        const safeHeight = Math.max(1, Math.floor(height || 0));

        this.renderer.setSize(safeWidth, safeHeight);
        this.camera.aspect = safeWidth / safeHeight;
        this.camera.updateProjectionMatrix();
    }

    getRendererCapabilities() {
        return {
            backend: this.rendererBackend,
            cavitation: this.cavitationParticles.getCapabilities()
        };
    }

    addTarget(target) {
        const targetId = target.id;
        if (!targetId || this.targetMeshes.has(targetId) || !this.scene) return;

        const type = target.type || 'SHIP';
        let geometry;
        let color;

        switch (type) {
            case 'SUBMARINE':
                geometry = new THREE.OctahedronGeometry(1.5, 0);
                color = 0x00ffff;
                break;
            case 'TORPEDO':
                geometry = new THREE.ConeGeometry(0.8, 4, 8);
                geometry.rotateX(Math.PI / 2);
                color = 0xff0000;
                break;
            case 'BIOLOGICAL':
                geometry = new THREE.SphereGeometry(0.8, 8, 8);
                color = 0x00ff00;
                break;
            case 'STATIC':
                geometry = new THREE.BoxGeometry(2, 2, 2);
                color = 0x888888;
                break;
            case 'SHIP':
            default:
                geometry = new THREE.SphereGeometry(1.5, 8, 8);
                color = 0xff8800;
                break;
        }

        const mesh = new THREE.Mesh(
            geometry,
            new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0 })
        );
        mesh.userData = { type, speed: target.speed ?? 0 };
        this.scene.add(mesh);
        this.targetMeshes.set(targetId, mesh);
    }

    updateTargetPosition(targetId, x, z, passive = false, speed = 0) {
        const mesh = this.targetMeshes.get(targetId);
        if (!mesh) return;

        const y = this.getTerrainHeight(x, z) + 2.0;
        const scenePos = this.modelToScenePosition(x, z);
        mesh.position.set(scenePos.x, y, scenePos.z);
        mesh.userData.speed = speed;

        if (passive) {
            mesh.material.opacity = Math.max(mesh.material.opacity, 0.3);
        } else {
            mesh.material.opacity = 1;
        }
    }

    updateTargetOpacities(decayFactor = 0.98) {
        this.targetMeshes.forEach((mesh) => {
            if (mesh.material.opacity > 0) {
                mesh.material.opacity *= decayFactor;
            }
        });
    }

    setScanExUniforms(radius, active) {
        this._scanRadius = radius;
        this._scanActive = !!active;
        if (this.terrain && this.terrain.material.uniforms) {
            this.terrain.material.uniforms.uScanRadius.value = radius;
            this.terrain.material.uniforms.uActive.value = active ? 1.0 : 0.0;
        }

        if (this.scanRingFx) {
            this.scanRingFx.visible = !!active && this.terrainRenderStyle !== 'point-cloud';
            const ringRadius = Math.max(1, radius);
            this.scanRingFx.scale.set(ringRadius, ringRadius, ringRadius);
        }
    }

    render(ownShipPose, selectedTargetId, pulse, targets = [], dt = 0.016) {
        if (!this.renderer || !this.scene || !this.camera) return;
        this._elapsedTime += Math.max(0, Number.isFinite(dt) ? dt : 0.016);

        const ownX = Number.isFinite(ownShipPose?.x) ? ownShipPose.x : 0;
        const ownZ = Number.isFinite(ownShipPose?.z) ? ownShipPose.z : 0;
        const ownCourse = Number.isFinite(ownShipPose?.course) ? ownShipPose.course : 0;
        const ownSpeed = Number.isFinite(ownShipPose?.speed) ? ownShipPose.speed : 0;

        this.updateTerrainAroundShip(ownX, ownZ);
        this.updateOwnShipAndCamera(ownX, ownZ, ownCourse, ownSpeed, dt);
        this.updateUnderwaterEffects();
        this.updateCompassHeading();

        if (this.selectionRing) {
            if (selectedTargetId && this.targetMeshes.has(selectedTargetId)) {
                const targetMesh = this.targetMeshes.get(selectedTargetId);
                this.selectionRing.position.copy(targetMesh.position);
                this.selectionRing.visible = targetMesh.material.opacity > 0.1;
                const s = 1.0 + Math.sin(pulse * Math.PI * 2) * 0.1;
                this.selectionRing.scale.set(s, s, s);
            } else {
                this.selectionRing.visible = false;
            }
        }

        this.updateMarineSnow(dt, ownX, ownZ);
        this.updateOwnWakeParticles(ownX, ownZ, ownCourse, ownSpeed, dt);
        this.updateCavitation(targets, dt);

        if (typeof this.renderer.renderAsync === 'function') {
            if (this._renderPending) return;
            this._renderPending = true;
            this.renderer.renderAsync(this.scene, this.camera)
                .catch((error) => {
                    console.warn('WebGPU render failed:', error);
                })
                .finally(() => {
                    this._renderPending = false;
                });
            return;
        }

        this.renderer.render(this.scene, this.camera);
    }

    updateOwnShipAndCamera(ownX, ownZ, ownCourse, ownSpeed, dt) {
        if (!this.camera || !this.ownShipRoot) return;

        const scenePos = this.modelToScenePosition(ownX, ownZ);
        const sceneCourse = this.sceneCourseFromModelCourse(ownCourse);
        const terrainY = this.getTerrainHeight(ownX, ownZ);
        const ownY = terrainY + 5.0;

        this.ownShipRoot.position.set(scenePos.x, ownY, scenePos.z);
        this.ownShipRoot.rotation.set(0, sceneCourse, 0);

        if (this.worldAxisGizmos) {
            this.worldAxisGizmos.position.set(scenePos.x, ownY + 1.5, scenePos.z);
        }

        if (this.verticalGuideLine) {
            const length = Math.max(1, ownY - terrainY);
            this.verticalGuideLine.scale.set(1, length, 1);
        }

        const shipPosition = { x: scenePos.x, y: ownY, z: scenePos.z };

        const idealCameraPos = shipLocalToWorld(this.followCameraOffsetLocal, shipPosition, sceneCourse);
        const idealLookAt = shipLocalToWorld(this.followLookAtOffsetLocal, shipPosition, sceneCourse);

        const speedFactor = clamp(Math.abs(ownSpeed) / 18, 0, 1);
        const swayAmp = this.cameraSwayBaseAmplitude + (this.cameraSwaySpeedAmplitude * speedFactor);
        const swayT = this._elapsedTime * this.cameraSwayFrequency;
        const swaySide = Math.sin(swayT) * swayAmp;
        const swayHeave = Math.cos(swayT * 0.84) * swayAmp * 0.42;
        const courseRightX = Math.cos(sceneCourse);
        const courseRightZ = -Math.sin(sceneCourse);
        idealCameraPos.x += courseRightX * swaySide;
        idealCameraPos.y += swayHeave;
        idealCameraPos.z += courseRightZ * swaySide;
        idealLookAt.y += swayHeave * 0.28;

        this._tmpVec3A.set(idealCameraPos.x, idealCameraPos.y, idealCameraPos.z);
        this._tmpVec3B.set(idealLookAt.x, idealLookAt.y, idealLookAt.z);

        if (!this._cameraReady) {
            this.camera.position.copy(this._tmpVec3A);
            this._currentLookAt.copy(this._tmpVec3B);
            this._cameraReady = true;
        } else {
            const posAlpha = expSmoothingAlpha(this.cameraPositionResponsiveness, dt);
            const lookAlpha = expSmoothingAlpha(this.cameraLookResponsiveness, dt);
            this.camera.position.lerp(this._tmpVec3A, posAlpha);
            this._currentLookAt.lerp(this._tmpVec3B, lookAlpha);
        }

        this.camera.lookAt(this._currentLookAt);
    }

    updateCavitation(targets, dt) {
        if (this._cavitationPending) return;

        const emitters = [];
        for (const target of targets) {
            if (!target || !target.id) continue;

            const mesh = this.targetMeshes.get(target.id);
            if (!mesh || mesh.material.opacity < 0.2) continue;

            const type = target.type || mesh.userData.type;
            if (type === 'BIOLOGICAL' || type === 'STATIC') continue;

            const speed = target.speed ?? mesh.userData.speed ?? 0;
            if (speed < this.cavitationParticles.speedThreshold) continue;

            emitters.push({
                x: mesh.position.x,
                y: mesh.position.y,
                z: mesh.position.z,
                intensity: clamp(speed / 2.5, 0.4, 2.0)
            });
        }

        this._cavitationPending = true;
        this.cavitationParticles.update(emitters, dt)
            .catch((error) => {
                console.warn('Cavitation particle update failed:', error);
            })
            .finally(() => {
                this._cavitationPending = false;
            });
    }

    updateUnderwaterEffects() {
        if (!this.scene || !this.camera || !this.scene.fog) return;

        const camDepth = Math.max(0, -this.camera.position.y);
        const depthNorm = clamp(camDepth / 60, 0, 1);
        const fogDensity = clamp(
            this.baseFogDensity + camDepth * this.depthFogDensityFactor,
            this.minFogDensity,
            this.maxFogDensity
        );

        this.scene.fog.density = fogDensity;
        this.scene.fog.color.copy(this.fogColorShallow).lerp(this.fogColorDeep, depthNorm);
        if (this.scene.background && this.scene.background.isColor) {
            this.scene.background.copy(this.scene.fog.color);
        }

        if (this.terrain?.material?.uniforms?.uFogDensity) {
            this.terrain.material.uniforms.uFogDensity.value = fogDensity;
        }
        if (this.terrain?.material?.uniforms?.uFogColor) {
            this.terrain.material.uniforms.uFogColor.value.copy(this.scene.fog.color);
        }
        if (this.terrain?.material?.uniforms?.uTime) {
            this.terrain.material.uniforms.uTime.value = this._elapsedTime;
        }

        if (this.waterSurface?.material?.uniforms?.uFogDensity) {
            this.waterSurface.material.uniforms.uFogDensity.value = fogDensity;
        }
        if (this.waterSurface?.material?.uniforms?.uFogColor) {
            this.waterSurface.material.uniforms.uFogColor.value.copy(this.scene.fog.color);
        }
        if (this.waterSurface?.material?.uniforms?.uTime) {
            this.waterSurface.material.uniforms.uTime.value = this._elapsedTime;
        }

        if (this.primarySunLight) {
            // Fade top-down light with depth so deeper water feels murkier and less direct-lit.
            const base = this._activeLightingProfile?.sunIntensity ?? 0.9;
            const fade = this._activeLightingProfile?.sunFadeByDepth ?? 0.42;
            this.primarySunLight.intensity = Math.max(0.1, base - (depthNorm * fade));
        }
        if (this.postFxOverlay) {
            const grainOffsetX = Math.floor((this._elapsedTime * 23) % 320);
            const grainOffsetY = Math.floor((this._elapsedTime * 17) % 240);
            this.postFxOverlay.style.backgroundPosition = `center center, ${grainOffsetX}px ${grainOffsetY}px`;
        }

        if (this.rendererBackend === 'webgpu') {
            if (this.webgpuTerrainNodes) {
                this.webgpuTerrainNodes.time.value = this._elapsedTime;
                this.webgpuTerrainNodes.opacity.value = 0.52 - (depthNorm * 0.12);
            } else {
                this.updateCausticTexture(this._elapsedTime * (this._activePolishProfile?.causticSpeed ?? 1));
                if (this.webgpuTerrainMaterial && this.webgpuTerrainMaterial.isMeshStandardMaterial) {
                    const terrainNear = new THREE.Color(0x1f6f76);
                    const terrainDeep = new THREE.Color(0x24363f);
                    this.webgpuTerrainMaterial.color.copy(terrainNear).lerp(terrainDeep, depthNorm * 0.75);
                    this.webgpuTerrainMaterial.opacity = 0.52 - (depthNorm * 0.12);
                    this.webgpuTerrainMaterial.emissiveIntensity = (this._activePolishProfile?.causticIntensity ?? 0.16) * (1.1 - depthNorm * 0.35);
                    if (this.causticTexture) {
                        const drift = this._elapsedTime * 0.018;
                        this.causticTexture.offset.set(drift % 1, (drift * 0.72) % 1);
                    }
                }
            }
            if (this.webgpuWaterNodes) {
                this.webgpuWaterNodes.time.value = this._elapsedTime;
                this.webgpuWaterNodes.opacityScale.value = clamp(1.0 - (depthNorm * 0.25), 0.72, 1.1);
            } else if (this.webgpuWaterMaterial && this.webgpuWaterMaterial.isMeshBasicMaterial) {
                const waterNear = new THREE.Color(0x13434b);
                const waterDeep = new THREE.Color(0x1b2f37);
                this.webgpuWaterMaterial.color.copy(waterNear).lerp(waterDeep, depthNorm * 0.85);
                const wave = Math.sin(this._elapsedTime * 1.12) * 0.02;
                this.webgpuWaterMaterial.opacity = clamp(0.15 + wave - depthNorm * 0.04, 0.08, 0.2);
            }
        }
    }

    applyRendererColorGrade() {
        if (!this.renderer || !this.renderer.domElement) return;
        this.renderer.toneMappingExposure = this.underwaterColorGrade.exposure;
        this.renderer.domElement.style.filter = this.underwaterColorGrade.enabled
            ? this.underwaterColorGrade.cssFilter
            : 'none';
    }

    applyAtmospherePreset() {
        const profile = this._atmosphereProfiles[this.atmospherePreset] || this._atmosphereProfiles.balanced;

        this.baseFogDensity = profile.fog.baseDensity;
        this.depthFogDensityFactor = profile.fog.depthFactor;
        this.minFogDensity = profile.fog.minDensity;
        this.maxFogDensity = profile.fog.maxDensity;
        this.fogColorShallow.setHex(profile.fog.shallowColor);
        this.fogColorDeep.setHex(profile.fog.deepColor);

        this.underwaterColorGrade.enabled = !!profile.colorGrade.enabled;
        this.underwaterColorGrade.cssFilter = profile.colorGrade.cssFilter;
        this.underwaterColorGrade.exposure = profile.colorGrade.exposure;
        this._activeLightingProfile = profile.lighting;
        this._activePolishProfile = profile.polish;
        this.applyRendererColorGrade();

        if (this.scene?.fog) {
            this.scene.fog.density = this.baseFogDensity;
            this.scene.fog.color.copy(this.fogColorShallow);
        }
        if (this.scene?.background?.isColor) {
            this.scene.background.copy(this.fogColorShallow);
        }

        if (this.terrain?.material?.uniforms?.uFogColor) {
            this.terrain.material.uniforms.uFogColor.value.copy(this.fogColorShallow);
        }
        if (this.terrain?.material?.uniforms?.uFogDensity) {
            this.terrain.material.uniforms.uFogDensity.value = this.baseFogDensity;
        }
        if (this.terrain?.material?.uniforms?.uCausticIntensity) {
            this.terrain.material.uniforms.uCausticIntensity.value = this._activePolishProfile.causticIntensity;
        }
        if (this.terrain?.material?.uniforms?.uCausticScale) {
            this.terrain.material.uniforms.uCausticScale.value = this._activePolishProfile.causticScale;
        }
        if (this.terrain?.material?.uniforms?.uCausticSpeed) {
            this.terrain.material.uniforms.uCausticSpeed.value = this._activePolishProfile.causticSpeed;
        }
        if (this.terrain?.material?.uniforms?.uDesatNear) {
            this.terrain.material.uniforms.uDesatNear.value = this._activePolishProfile.desatNear;
        }
        if (this.terrain?.material?.uniforms?.uDesatFar) {
            this.terrain.material.uniforms.uDesatFar.value = this._activePolishProfile.desatFar;
        }
        if (this.waterSurface?.material?.uniforms?.uFogColor) {
            this.waterSurface.material.uniforms.uFogColor.value.copy(this.fogColorShallow);
        }
        if (this.waterSurface?.material?.uniforms?.uFogDensity) {
            this.waterSurface.material.uniforms.uFogDensity.value = this.baseFogDensity;
        }
        if (this.waterSurface?.material?.uniforms?.uDesatNear) {
            this.waterSurface.material.uniforms.uDesatNear.value = this._activePolishProfile.desatNear;
        }
        if (this.waterSurface?.material?.uniforms?.uDesatFar) {
            this.waterSurface.material.uniforms.uDesatFar.value = this._activePolishProfile.desatFar;
        }

        if (this.ambientUnderwaterLight) {
            this.ambientUnderwaterLight.color.setHex(profile.lighting.ambientColor);
            this.ambientUnderwaterLight.intensity = profile.lighting.ambientIntensity;
        }
        if (this.fillUnderwaterLight) {
            this.fillUnderwaterLight.color.setHex(profile.lighting.fillSkyColor);
            this.fillUnderwaterLight.groundColor.setHex(profile.lighting.fillGroundColor);
            this.fillUnderwaterLight.intensity = profile.lighting.fillIntensity;
        }
        if (this.primarySunLight) {
            this.primarySunLight.color.setHex(profile.lighting.sunColor);
            this.primarySunLight.intensity = profile.lighting.sunIntensity;
        }
        if (this.postFxOverlay) {
            this.postFxOverlay.style.opacity = `${this._activePolishProfile.vignetteOpacity}`;
            const grainAlpha = clamp(this._activePolishProfile.grainOpacity, 0.0, 0.2);
            this.postFxOverlay.style.backgroundImage = [
                'radial-gradient(circle at 50% 55%, rgba(140, 190, 205, 0.10) 0%, rgba(18, 35, 44, 0.06) 54%, rgba(2, 9, 14, 0.75) 100%)',
                `repeating-linear-gradient(0deg, rgba(255, 255, 255, ${grainAlpha.toFixed(3)}) 0px, rgba(255, 255, 255, 0.0) 2px, rgba(255, 255, 255, 0.0) 4px)`
            ].join(',');
        }
        if (this.webgpuTerrainNodes) {
            this.webgpuTerrainNodes.causticIntensity.value = this._activePolishProfile.causticIntensity;
            this.webgpuTerrainNodes.causticScale.value = this._activePolishProfile.causticScale;
            this.webgpuTerrainNodes.causticSpeed.value = this._activePolishProfile.causticSpeed;
            this.webgpuTerrainNodes.desatNear.value = this._activePolishProfile.desatNear;
            this.webgpuTerrainNodes.desatFar.value = this._activePolishProfile.desatFar;
        } else if (this.webgpuTerrainMaterial && this.webgpuTerrainMaterial.isMeshStandardMaterial) {
            this.webgpuTerrainMaterial.emissiveIntensity = this._activePolishProfile.causticIntensity;
        }
        if (this.webgpuWaterNodes) {
            this.webgpuWaterNodes.desatNear.value = this._activePolishProfile.desatNear;
            this.webgpuWaterNodes.desatFar.value = this._activePolishProfile.desatFar;
        }
    }

    setupPostFxOverlay(container) {
        if (!container || this.postFxOverlay) return;

        const overlay = document.createElement('div');
        overlay.style.position = 'absolute';
        overlay.style.inset = '0';
        overlay.style.pointerEvents = 'none';
        overlay.style.zIndex = '13';
        overlay.style.mixBlendMode = 'screen';
        overlay.style.backgroundImage = [
            'radial-gradient(circle at 50% 55%, rgba(140, 190, 205, 0.10) 0%, rgba(18, 35, 44, 0.06) 54%, rgba(2, 9, 14, 0.75) 100%)',
            'repeating-linear-gradient(0deg, rgba(255, 255, 255, 0.028) 0px, rgba(255, 255, 255, 0.0) 2px, rgba(255, 255, 255, 0.0) 4px)'
        ].join(',');
        overlay.style.backgroundSize = '100% 100%, 100% 4px';
        overlay.style.backgroundPosition = 'center center, 0 0';
        overlay.style.opacity = '0.28';
        container.appendChild(overlay);
        this.postFxOverlay = overlay;
    }

    createCausticTexture() {
        const canvas = document.createElement('canvas');
        canvas.width = 192;
        canvas.height = 192;
        this.causticCanvas = canvas;
        this.causticCtx = canvas.getContext('2d');

        const texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        texture.repeat.set(2.2, 2.2);
        this.updateCausticTexture(0);
        return texture;
    }

    updateCausticTexture(timeSec) {
        if (!this.causticCtx || !this.causticCanvas || !this.causticTexture) return;

        const ctx = this.causticCtx;
        const w = this.causticCanvas.width;
        const h = this.causticCanvas.height;
        ctx.clearRect(0, 0, w, h);
        ctx.fillStyle = '#00060a';
        ctx.fillRect(0, 0, w, h);
        ctx.globalCompositeOperation = 'lighter';

        for (let i = 0; i < 9; i++) {
            const t = timeSec * (0.4 + (i * 0.07));
            const cx = (Math.sin(t + (i * 0.83)) * 0.38 + 0.5) * w;
            const cy = (Math.cos(t * 0.92 + (i * 1.31)) * 0.38 + 0.5) * h;
            const radius = 12 + ((i % 4) * 7);
            const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius * 2.4);
            grad.addColorStop(0.0, 'rgba(165, 255, 255, 0.30)');
            grad.addColorStop(0.35, 'rgba(130, 230, 255, 0.14)');
            grad.addColorStop(1.0, 'rgba(0, 0, 0, 0.0)');
            ctx.fillStyle = grad;
            ctx.beginPath();
            ctx.arc(cx, cy, radius * 2.4, 0, Math.PI * 2);
            ctx.fill();
        }

        ctx.globalCompositeOperation = 'source-over';
        this.causticTexture.needsUpdate = true;
    }

    setupCompassOverlay(container) {
        if (!container || this.compassRoot) return;

        const root = document.createElement('div');
        root.style.position = 'absolute';
        root.style.top = '10px';
        root.style.right = '10px';
        root.style.width = '78px';
        root.style.height = '78px';
        root.style.border = '1px solid rgba(118, 189, 204, 0.4)';
        root.style.borderRadius = '50%';
        root.style.background = 'rgba(3, 14, 18, 0.5)';
        root.style.backdropFilter = 'blur(1px)';
        root.style.pointerEvents = 'none';
        root.style.zIndex = '14';

        const northLabel = document.createElement('div');
        northLabel.textContent = 'N';
        northLabel.style.position = 'absolute';
        northLabel.style.left = '50%';
        northLabel.style.top = '50%';
        northLabel.style.transform = 'translate(-50%, -50%)';
        northLabel.style.font = '10px monospace';
        northLabel.style.color = '#a3d3de';
        northLabel.style.textShadow = '0 0 4px rgba(107, 186, 203, 0.34)';
        northLabel.style.transformOrigin = '50% 50%';
        root.appendChild(northLabel);

        const needle = document.createElement('div');
        needle.style.position = 'absolute';
        needle.style.top = '50%';
        needle.style.left = '50%';
        needle.style.width = '2px';
        needle.style.height = '28px';
        needle.style.background = 'linear-gradient(to top, rgba(171, 213, 224, 0.22), rgba(223, 183, 112, 0.88))';
        needle.style.transformOrigin = '50% calc(100% - 2px)';
        needle.style.transform = 'translate(-50%, -100%) rotate(0deg)';
        needle.style.borderRadius = '1px';
        root.appendChild(needle);

        const centerDot = document.createElement('div');
        centerDot.style.position = 'absolute';
        centerDot.style.top = '50%';
        centerDot.style.left = '50%';
        centerDot.style.width = '6px';
        centerDot.style.height = '6px';
        centerDot.style.transform = 'translate(-50%, -50%)';
        centerDot.style.borderRadius = '50%';
        centerDot.style.background = 'rgba(179, 224, 231, 0.85)';
        root.appendChild(centerDot);

        container.appendChild(root);
        this.compassRoot = root;
        this.compassNeedle = needle;
        this.compassNorthLabel = northLabel;
    }

    updateCompassHeading() {
        if (!this.camera || !this.compassNeedle) return;

        this.camera.getWorldDirection(this._tmpCamForward);
        this._tmpCamForward.y = 0;
        const len = this._tmpCamForward.length();
        if (len < 1e-5) return;
        this._tmpCamForward.multiplyScalar(1 / len);

        // Scene north is -Z because model north (+Z) is mirrored to scene space.
        const northX = 0;
        const northZ = -1;
        const fwdX = this._tmpCamForward.x;
        const fwdZ = this._tmpCamForward.z;

        const dot = clamp((fwdX * northX) + (fwdZ * northZ), -1, 1);
        const crossY = (fwdX * northZ) - (fwdZ * northX);
        const angleDeg = Math.atan2(crossY, dot) * 180 / Math.PI;

        this.compassNeedle.style.transform = `translate(-50%, -100%) rotate(${angleDeg.toFixed(2)}deg)`;
        if (this.compassNorthLabel) {
            const angleRad = angleDeg * Math.PI / 180;
            const labelRadius = 30;
            const lx = Math.sin(angleRad) * labelRadius;
            const ly = -Math.cos(angleRad) * labelRadius;
            this.compassNorthLabel.style.transform =
                `translate(calc(-50% + ${lx.toFixed(2)}px), calc(-50% + ${ly.toFixed(2)}px)) rotate(${angleDeg.toFixed(2)}deg)`;
        }
    }

    updateMarineSnow(dt, ownX, ownZ) {
        if (!Array.isArray(this.marineSnowLayers) || this.marineSnowLayers.length === 0) return;
        const safeDt = Number.isFinite(dt) ? Math.max(0.001, dt) : 0.016;
        const fallFactor = clamp(safeDt * 60, 0.1, 2.5);
        const currentPhase = this._elapsedTime * 0.2;

        for (const layer of this.marineSnowLayers) {
            const positions = layer.geometry.attributes.position.array;
            const speeds = layer.geometry.userData.speeds;
            const yMin = layer.geometry.userData.yMin;
            const yMax = layer.geometry.userData.yMax;
            const span = layer.geometry.userData.span;
            const halfSpan = span * 0.5;
            const driftScale = layer.geometry.userData.driftScale;
            const driftX = (Math.sin(currentPhase + driftScale) * 0.024 + (0.01 * driftScale)) * safeDt * 60;
            const driftZ = (Math.cos(currentPhase * 0.83 + driftScale * 0.7) * 0.019) * safeDt * 60;
            for (let i = 0; i < speeds.length; i++) {
                const xIndex = i * 3;
                const yIndex = xIndex + 1;
                const zIndex = xIndex + 2;
                positions[xIndex] += driftX;
                if (positions[xIndex] > halfSpan) positions[xIndex] -= span;
                if (positions[xIndex] < -halfSpan) positions[xIndex] += span;
                positions[i * 3 + 1] -= speeds[i] * fallFactor;
                if (positions[yIndex] < yMin) positions[yIndex] = yMax;
                positions[zIndex] += driftZ;
                if (positions[zIndex] > halfSpan) positions[zIndex] -= span;
                if (positions[zIndex] < -halfSpan) positions[zIndex] += span;
            }
            layer.geometry.attributes.position.needsUpdate = true;
        }

        const scenePos = this.modelToScenePosition(ownX, ownZ);
        const baseY = this.getTerrainHeight(ownX, ownZ) + 10;
        for (const layer of this.marineSnowLayers) {
            layer.position.set(scenePos.x, baseY, scenePos.z);
        }
    }

    pickTargetAtPoint(x, y, rect) {
        if (!this.camera) return null;

        let hitId = null;
        this.targetMeshes.forEach((mesh, id) => {
            if (mesh.material.opacity <= 0.2) return;

            mesh.getWorldPosition(this._tmpWorldPos);
            const projected = this._tmpWorldPos.clone().project(this.camera);

            const screenX = (projected.x * 0.5 + 0.5) * rect.width;
            const screenY = (-(projected.y * 0.5) + 0.5) * rect.height;
            const dist = Math.sqrt((x - screenX) ** 2 + (y - screenY) ** 2);
            if (dist < 20) hitId = id;
        });

        return hitId;
    }

    updateTerrainAroundShip(ownX, ownZ) {
        const sceneOwnPos = this.modelToScenePosition(ownX, ownZ);
        const snap = this._terrainSnapStep;
        const gridX = Math.round(sceneOwnPos.x / snap) * snap;
        const gridZ = Math.round(sceneOwnPos.z / snap) * snap;

        const moved = gridX !== this._lastTerrainGridCenter.x || gridZ !== this._lastTerrainGridCenter.z;
        if (moved) {
            this._lastTerrainGridCenter.x = gridX;
            this._lastTerrainGridCenter.z = gridZ;

            if (this.terrain) {
                this.terrain.position.set(gridX, 0, gridZ);
                const pos = this.terrain.geometry.attributes.position;

                for (let i = 0; i < pos.count; i++) {
                    const sceneX = gridX + pos.getX(i);
                    const sceneZ = gridZ + pos.getZ(i);
                    pos.setY(i, this.getTerrainHeightAtScene(sceneX, sceneZ));
                }

                pos.needsUpdate = true;
                this.terrain.geometry.computeVertexNormals();
            }

            if (this.terrainPointCloud) {
                this.terrainPointCloud.position.set(gridX, 0, gridZ);
                const pos = this.terrainPointCloud.geometry.attributes.position;
                const colors = this.terrainPointCloud.geometry.attributes.color;

                for (let i = 0; i < pos.count; i++) {
                    const sceneX = gridX + pos.getX(i);
                    const sceneZ = gridZ + pos.getZ(i);
                    const terrainHeight = this.getTerrainHeightAtScene(sceneX, sceneZ);
                    pos.setY(i, terrainHeight);

                    const t = clamp((terrainHeight + 24.0) / 40.0, 0, 1);
                    colors.setXYZ(i, 0.18 + (0.82 * t), 0.85 + (0.15 * t), 0.88 + (0.12 * t));
                }

                pos.needsUpdate = true;
                colors.needsUpdate = true;
            }

            this.updateTerrainGridLines(gridX, gridZ);

            if (this.waterSurface) {
                this.waterSurface.position.set(gridX, 0, gridZ);
            }

            this.updateTerrainContours(gridX, gridZ);
        }

        if (this.scanRingFx) {
            const y = this.getTerrainHeight(ownX, ownZ) + 0.1;
            this.scanRingFx.position.set(sceneOwnPos.x, y, sceneOwnPos.z);
        }
    }

    updateTerrainContours(gridX, gridZ) {
        if (!this.terrainContours) return;

        const half = this._terrainSize / 2;
        const step = this._terrainSize / this._terrainSegments;
        const majorLines = [];
        const minorLines = [];

        const interpolate = (a, b, level) => {
            const da = level - a.h;
            const db = b.h - a.h;
            let t = db === 0 ? 0.5 : da / db;
            if (!Number.isFinite(t)) t = 0.5;
            t = Math.max(0, Math.min(1, t));
            return {
                x: a.x + (b.x - a.x) * t,
                z: a.z + (b.z - a.z) * t
            };
        };

        for (let levelIndex = 0; levelIndex < this._contourLevels.length; levelIndex++) {
            const level = this._contourLevels[levelIndex];
            const dest = levelIndex % 2 === 0 ? majorLines : minorLines;
            for (let lx = -half; lx < half; lx += step) {
                for (let lz = -half; lz < half; lz += step) {
                    const p00 = { x: lx, z: lz };
                    const p10 = { x: lx + step, z: lz };
                    const p11 = { x: lx + step, z: lz + step };
                    const p01 = { x: lx, z: lz + step };

                    p00.h = this.getTerrainHeightAtScene(gridX + p00.x, gridZ + p00.z);
                    p10.h = this.getTerrainHeightAtScene(gridX + p10.x, gridZ + p10.z);
                    p11.h = this.getTerrainHeightAtScene(gridX + p11.x, gridZ + p11.z);
                    p01.h = this.getTerrainHeightAtScene(gridX + p01.x, gridZ + p01.z);

                    const caseCode =
                        (p00.h >= level ? 1 : 0) |
                        (p10.h >= level ? 2 : 0) |
                        (p11.h >= level ? 4 : 0) |
                        (p01.h >= level ? 8 : 0);

                    if (caseCode === 0 || caseCode === 15) continue;

                    const e0 = interpolate(p00, p10, level);
                    const e1 = interpolate(p10, p11, level);
                    const e2 = interpolate(p11, p01, level);
                    const e3 = interpolate(p01, p00, level);

                    const segments = this.getContourSegments(caseCode, e0, e1, e2, e3);
                    for (const [a, b] of segments) {
                        dest.push(
                            gridX + a.x, level + 0.2, gridZ + a.z,
                            gridX + b.x, level + 0.2, gridZ + b.z
                        );
                    }
                }
            }
        }

        const majorGeometry = new THREE.BufferGeometry();
        majorGeometry.setAttribute('position', new THREE.Float32BufferAttribute(majorLines, 3));
        const minorGeometry = new THREE.BufferGeometry();
        minorGeometry.setAttribute('position', new THREE.Float32BufferAttribute(minorLines, 3));

        this.terrainContoursMajor.geometry.dispose();
        this.terrainContoursMajor.geometry = majorGeometry;
        this.terrainContoursMinor.geometry.dispose();
        this.terrainContoursMinor.geometry = minorGeometry;
    }

    updateTerrainGridLines(gridX, gridZ) {
        if (!this.terrainGridLines) return;

        const half = this._terrainSize / 2;
        const step = this._terrainSize / this._terrainSegments;
        const lines = [];

        for (let i = 0; i <= this._terrainSegments; i++) {
            const localZ = -half + (i * step);
            for (let j = 0; j < this._terrainSegments; j++) {
                const localX0 = -half + (j * step);
                const localX1 = localX0 + step;
                const y0 = this.getTerrainHeightAtScene(gridX + localX0, gridZ + localZ);
                const y1 = this.getTerrainHeightAtScene(gridX + localX1, gridZ + localZ);
                lines.push(
                    gridX + localX0, y0 + 0.05, gridZ + localZ,
                    gridX + localX1, y1 + 0.05, gridZ + localZ
                );
            }
        }

        for (let i = 0; i <= this._terrainSegments; i++) {
            const localX = -half + (i * step);
            for (let j = 0; j < this._terrainSegments; j++) {
                const localZ0 = -half + (j * step);
                const localZ1 = localZ0 + step;
                const y0 = this.getTerrainHeightAtScene(gridX + localX, gridZ + localZ0);
                const y1 = this.getTerrainHeightAtScene(gridX + localX, gridZ + localZ1);
                lines.push(
                    gridX + localX, y0 + 0.05, gridZ + localZ0,
                    gridX + localX, y1 + 0.05, gridZ + localZ1
                );
            }
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(lines, 3));
        this.terrainGridLines.geometry.dispose();
        this.terrainGridLines.geometry = geometry;
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

    createWebGPUTerrainNodeMaterial() {
        const MeshStandardNodeMaterial = this.webgpuModule?.MeshStandardNodeMaterial;
        const TSL = this.webgpuModule?.TSL;
        if (!MeshStandardNodeMaterial || !TSL) return null;

        const material = new MeshStandardNodeMaterial();
        material.transparent = true;
        material.roughness = 0.9;
        material.metalness = 0.02;

        const uTime = TSL.uniform(0);
        const uCausticIntensity = TSL.uniform(this._activePolishProfile?.causticIntensity ?? 0.18);
        const uCausticScale = TSL.uniform(this._activePolishProfile?.causticScale ?? 0.06);
        const uCausticSpeed = TSL.uniform(this._activePolishProfile?.causticSpeed ?? 1.3);
        const uDesatNear = TSL.uniform(this._activePolishProfile?.desatNear ?? 52);
        const uDesatFar = TSL.uniform(this._activePolishProfile?.desatFar ?? 230);
        const uOpacity = TSL.uniform(0.44);

        const worldPos = TSL.positionWorld;
        const viewDepth = TSL.positionView.z.negate();

        const cA = TSL.sin(worldPos.x.mul(uCausticScale).add(uTime.mul(uCausticSpeed)));
        const cB = TSL.sin(worldPos.z.mul(uCausticScale.mul(1.18)).sub(uTime.mul(uCausticSpeed.mul(0.8))));
        const cC = TSL.sin(worldPos.x.add(worldPos.z).mul(uCausticScale.mul(0.72)).add(uTime.mul(uCausticSpeed.mul(0.56))));
        const causticPattern = TSL.max(TSL.float(0), cA.add(cB).add(cC).mul(1 / 3));
        const caustic = TSL.pow(causticPattern, 2.2).mul(uCausticIntensity);

        const baseColor = TSL.color(0x1c656d);
        const depthDesat = TSL.smoothstep(uDesatNear, uDesatFar, viewDepth).mul(0.58);
        const baseLuma = TSL.luminance(baseColor);
        const depthColor = TSL.mix(baseColor, TSL.vec3(baseLuma), depthDesat);
        const causticColor = TSL.vec3(0.16, 0.4, 0.45).mul(caustic);

        material.colorNode = depthColor;
        material.emissiveNode = causticColor;
        material.opacityNode = uOpacity;

        this.webgpuTerrainNodes = {
            time: uTime,
            causticIntensity: uCausticIntensity,
            causticScale: uCausticScale,
            causticSpeed: uCausticSpeed,
            desatNear: uDesatNear,
            desatFar: uDesatFar,
            opacity: uOpacity
        };

        return material;
    }

    createWebGPUWaterNodeMaterial() {
        const MeshBasicNodeMaterial = this.webgpuModule?.MeshBasicNodeMaterial;
        const TSL = this.webgpuModule?.TSL;
        if (!MeshBasicNodeMaterial || !TSL) return null;

        const material = new MeshBasicNodeMaterial();
        material.transparent = true;
        material.depthWrite = false;

        const uTime = TSL.uniform(0);
        const uDesatNear = TSL.uniform(this._activePolishProfile?.desatNear ?? 52);
        const uDesatFar = TSL.uniform(this._activePolishProfile?.desatFar ?? 230);
        const uOpacityScale = TSL.uniform(1);

        const worldPos = TSL.positionWorld;
        const viewDepth = TSL.positionView.z.negate();

        const waveA = TSL.sin(worldPos.x.mul(0.09).add(uTime.mul(1.2)));
        const waveB = TSL.sin(worldPos.z.mul(0.07).sub(uTime.mul(1.4)));
        const waveC = TSL.sin(worldPos.x.add(worldPos.z).mul(0.05).add(uTime.mul(0.8)));
        const shimmer = waveA.add(waveB).add(waveC).mul(1 / 3);
        const mixFactor = shimmer.mul(0.5).add(0.5);

        const waterColor = TSL.mix(TSL.vec3(0.03, 0.14, 0.18), TSL.vec3(0.07, 0.3, 0.38), mixFactor);
        const desat = TSL.smoothstep(uDesatNear, uDesatFar, viewDepth).mul(0.65);
        const waterLuma = TSL.luminance(waterColor);
        const finalColor = TSL.mix(waterColor, TSL.vec3(waterLuma), desat);
        const opacity = TSL.clamp(TSL.float(0.11).add(shimmer.mul(0.02)).mul(uOpacityScale), 0.06, 0.16);

        material.colorNode = finalColor;
        material.opacityNode = opacity;

        this.webgpuWaterNodes = {
            time: uTime,
            desatNear: uDesatNear,
            desatFar: uDesatFar,
            opacityScale: uOpacityScale
        };

        return material;
    }

    setupTerrain() {
        const geometry = new THREE.PlaneGeometry(300, 300, 60, 60);
        geometry.rotateX(-Math.PI / 2);

        const pos = geometry.attributes.position;
        for (let i = 0; i < pos.count; i++) {
            const sceneX = pos.getX(i);
            const sceneZ = pos.getZ(i);
            pos.setY(i, this.getTerrainHeightAtScene(sceneX, sceneZ));
        }
        geometry.computeVertexNormals();

        const useShader = this.rendererBackend !== 'webgpu';
        const material = useShader
            ? new THREE.ShaderMaterial({
                uniforms: {
                    uScanRadius: { value: 0 },
                    uColor: { value: new THREE.Color(0x0d5f66) },
                    uActive: { value: 0.0 },
                    uTime: { value: 0 },
                    uFogColor: { value: this.fogColorShallow.clone() },
                    uFogDensity: { value: this.baseFogDensity },
                    uLightDirection: { value: new THREE.Vector3(-0.34, -1.0, 0.28).normalize() },
                    uLightColor: { value: new THREE.Color(0x85becd) },
                    uAmbientColor: { value: new THREE.Color(0x0b2f3a) },
                    uCausticIntensity: { value: 0.18 },
                    uCausticScale: { value: 0.06 },
                    uCausticSpeed: { value: 1.3 },
                    uDesatNear: { value: 52.0 },
                    uDesatFar: { value: 230.0 }
                },
                vertexShader: `
                varying float vDist;
                varying float vHeight;
                varying float vViewDepth;
                varying vec3 vNormalVS;
                varying vec2 vWorldXZ;
                void main() {
                    vDist = length(position.xz);
                    vHeight = position.y;
                    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                    vViewDepth = -mvPosition.z;
                    vNormalVS = normalize(normalMatrix * normal);
                    vec4 worldPos = modelMatrix * vec4(position, 1.0);
                    vWorldXZ = worldPos.xz;
                    gl_Position = projectionMatrix * mvPosition;
                }`,
                fragmentShader: `
                uniform float uScanRadius;
                uniform vec3 uColor;
                uniform float uActive;
                uniform float uTime;
                uniform vec3 uFogColor;
                uniform float uFogDensity;
                uniform vec3 uLightDirection;
                uniform vec3 uLightColor;
                uniform vec3 uAmbientColor;
                uniform float uCausticIntensity;
                uniform float uCausticScale;
                uniform float uCausticSpeed;
                uniform float uDesatNear;
                uniform float uDesatFar;
                varying float vDist;
                varying float vHeight;
                varying float vViewDepth;
                varying vec3 vNormalVS;
                varying vec2 vWorldXZ;
                void main() {
                    float ring = smoothstep(uScanRadius - 12.0, uScanRadius, vDist) * (1.0 - smoothstep(uScanRadius, uScanRadius + 1.0, vDist));
                    vec3 baseColor = uColor * (0.2 + (vHeight + 15.0) / 30.0);
                    float lambert = clamp(dot(normalize(vNormalVS), normalize(-uLightDirection)), 0.0, 1.0);
                    vec3 litColor = baseColor * (uAmbientColor + (uLightColor * (0.25 + lambert * 0.75)));
                    float cA = sin((vWorldXZ.x * uCausticScale) + (uTime * uCausticSpeed));
                    float cB = sin((vWorldXZ.y * (uCausticScale * 1.18)) - (uTime * uCausticSpeed * 0.8));
                    float cC = sin(((vWorldXZ.x + vWorldXZ.y) * (uCausticScale * 0.72)) + (uTime * uCausticSpeed * 0.56));
                    float causticPattern = max(0.0, (cA + cB + cC) / 3.0);
                    float caustic = pow(causticPattern, 2.2) * uCausticIntensity;
                    litColor += vec3(0.16, 0.40, 0.45) * caustic;
                    vec4 terrainColor;
                    if (uActive > 0.5) {
                        terrainColor = vec4(litColor + vec3(0.2, 0.9, 1.0) * ring * 0.48, 0.62 + ring * 0.28);
                    } else {
                        terrainColor = vec4(litColor, 0.44);
                    }
                    float desat = smoothstep(uDesatNear, uDesatFar, vViewDepth);
                    float luma = dot(terrainColor.rgb, vec3(0.2126, 0.7152, 0.0722));
                    terrainColor.rgb = mix(terrainColor.rgb, vec3(luma), desat * 0.58);
                    float fogFactor = 1.0 - exp(-uFogDensity * uFogDensity * vViewDepth * vViewDepth);
                    terrainColor.rgb = mix(terrainColor.rgb, uFogColor, clamp(fogFactor, 0.0, 1.0));
                    gl_FragColor = terrainColor;
                }`,
                transparent: true,
                wireframe: false
            })
            : this.createWebGPUTerrainNodeMaterial() || new THREE.MeshStandardMaterial({
                color: 0x1c656d,
                emissive: 0x2d8f96,
                emissiveIntensity: 0.22,
                transparent: true,
                opacity: 0.5,
                roughness: 0.9,
                metalness: 0.02
            });

        if (!useShader && material.isMeshStandardMaterial && !material.isNodeMaterial) {
            this.causticTexture = this.createCausticTexture();
            material.emissiveMap = this.causticTexture;
            material.emissiveMap.wrapS = THREE.RepeatWrapping;
            material.emissiveMap.wrapT = THREE.RepeatWrapping;
            material.emissiveMap.repeat.set(2.2, 2.2);
        }
        if (!useShader) {
            this.webgpuTerrainMaterial = material;
        }

        this.terrain = new THREE.Mesh(geometry, material);
        this.scene.add(this.terrain);

        const pointGeometry = new THREE.PlaneGeometry(300, 300, 60, 60);
        pointGeometry.rotateX(-Math.PI / 2);
        const pointPos = pointGeometry.attributes.position;
        const pointColors = new Float32Array(pointPos.count * 3);
        for (let i = 0; i < pointPos.count; i++) {
            const sceneX = pointPos.getX(i);
            const sceneZ = pointPos.getZ(i);
            const terrainHeight = this.getTerrainHeightAtScene(sceneX, sceneZ);
            pointPos.setY(i, terrainHeight);

            const t = clamp((terrainHeight + 24.0) / 40.0, 0, 1);
            pointColors[i * 3] = 0.18 + (0.82 * t);
            pointColors[i * 3 + 1] = 0.85 + (0.15 * t);
            pointColors[i * 3 + 2] = 0.88 + (0.12 * t);
        }
        pointGeometry.setAttribute('color', new THREE.Float32BufferAttribute(pointColors, 3));
        const pointMaterial = new THREE.PointsMaterial({
            size: 0.95,
            sizeAttenuation: true,
            vertexColors: true,
            transparent: true,
            opacity: 0.9,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });
        this.terrainPointCloud = new THREE.Points(pointGeometry, pointMaterial);
        this.terrainPointCloud.visible = false;
        this.scene.add(this.terrainPointCloud);

        const gridMaterial = new THREE.LineBasicMaterial({
            color: 0x0f5f5f,
            transparent: true,
            opacity: 0.55
        });
        this.terrainGridLines = new THREE.LineSegments(new THREE.BufferGeometry(), gridMaterial);
        this.terrainGridLines.frustumCulled = false;
        this.scene.add(this.terrainGridLines);
        this.updateTerrainGridLines(0, 0);

        const contourMajorMaterial = new THREE.LineBasicMaterial({
            color: 0x00b4be,
            transparent: true,
            opacity: 0.7
        });
        const contourMinorMaterial = new THREE.LineBasicMaterial({
            color: 0x0096a0,
            transparent: true,
            opacity: 0.5
        });
        this.terrainContours = new THREE.Group();
        this.terrainContoursMajor = new THREE.LineSegments(new THREE.BufferGeometry(), contourMajorMaterial);
        this.terrainContoursMinor = new THREE.LineSegments(new THREE.BufferGeometry(), contourMinorMaterial);
        this.terrainContoursMajor.frustumCulled = false;
        this.terrainContoursMinor.frustumCulled = false;
        this.terrainContours.add(this.terrainContoursMajor);
        this.terrainContours.add(this.terrainContoursMinor);
        this.scene.add(this.terrainContours);
        this.updateTerrainContours(0, 0);

        if (!useShader) {
            const ringGeometry = new THREE.RingGeometry(0.96, 1.0, 96);
            const ringMaterial = new THREE.MeshBasicMaterial({
                color: 0x00ffff,
                transparent: true,
                opacity: 0.35,
                side: THREE.DoubleSide,
                depthWrite: false
            });
            this.scanRingFx = new THREE.Mesh(ringGeometry, ringMaterial);
            this.scanRingFx.rotation.x = -Math.PI / 2;
            this.scanRingFx.visible = false;
            this.scene.add(this.scanRingFx);
        }

        this.applyTerrainRenderStyle();
    }

    setupWaterSurface() {
        const geometry = new THREE.PlaneGeometry(300, 300, 1, 1);
        geometry.rotateX(-Math.PI / 2);

        const useShader = this.rendererBackend !== 'webgpu';
        const material = useShader
            ? new THREE.ShaderMaterial({
                uniforms: {
                    uTime: { value: 0 },
                    uFogColor: { value: this.fogColorShallow.clone() },
                    uFogDensity: { value: this.baseFogDensity },
                    uDesatNear: { value: 52.0 },
                    uDesatFar: { value: 230.0 }
                },
                vertexShader: `
                varying vec3 vWorldPos;
                varying float vViewDepth;
                void main() {
                    vec4 worldPos = modelMatrix * vec4(position, 1.0);
                    vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
                    vWorldPos = worldPos.xyz;
                    vViewDepth = -mvPos.z;
                    gl_Position = projectionMatrix * mvPos;
                }`,
                fragmentShader: `
                uniform float uTime;
                uniform vec3 uFogColor;
                uniform float uFogDensity;
                uniform float uDesatNear;
                uniform float uDesatFar;
                varying vec3 vWorldPos;
                varying float vViewDepth;
                void main() {
                    float waveA = sin((vWorldPos.x * 0.09) + uTime * 1.2);
                    float waveB = sin((vWorldPos.z * 0.07) - uTime * 1.4);
                    float waveC = sin((vWorldPos.x + vWorldPos.z) * 0.05 + uTime * 0.8);
                    float shimmer = (waveA + waveB + waveC) / 3.0;
                    vec3 waterColor = mix(vec3(0.03, 0.14, 0.18), vec3(0.07, 0.30, 0.38), shimmer * 0.5 + 0.5);
                    float alpha = 0.11 + shimmer * 0.02;
                    float desat = smoothstep(uDesatNear, uDesatFar, vViewDepth);
                    float luma = dot(waterColor, vec3(0.2126, 0.7152, 0.0722));
                    waterColor = mix(waterColor, vec3(luma), desat * 0.65);
                    float fogFactor = 1.0 - exp(-uFogDensity * uFogDensity * vViewDepth * vViewDepth);
                    vec3 outColor = mix(waterColor, uFogColor, clamp(fogFactor, 0.0, 1.0));
                    gl_FragColor = vec4(outColor, clamp(alpha, 0.06, 0.16));
                }`,
                transparent: true,
                depthWrite: false
            })
            : this.createWebGPUWaterNodeMaterial() || new THREE.MeshBasicMaterial({
                color: 0x114444,
                transparent: true,
                opacity: 0.14,
                depthWrite: false
            });

        if (!useShader) {
            this.webgpuWaterMaterial = material;
        }

        this.waterSurface = new THREE.Mesh(geometry, material);
        this.waterSurface.position.y = 0;
        this.scene.add(this.waterSurface);
    }

    setupUnderwaterLighting() {
        if (!this.scene) return;

        this.underwaterLightRig = new THREE.Group();

        this.ambientUnderwaterLight = new THREE.AmbientLight(0x11333d, 0.75);
        this.underwaterLightRig.add(this.ambientUnderwaterLight);

        this.fillUnderwaterLight = new THREE.HemisphereLight(0x4d95a8, 0x041015, 0.35);
        this.underwaterLightRig.add(this.fillUnderwaterLight);

        this.primarySunLight = new THREE.DirectionalLight(0x7fb3c4, 0.9);
        this.primarySunLight.position.set(36, 90, -24);
        this.underwaterLightRig.add(this.primarySunLight);

        this.scene.add(this.underwaterLightRig);
    }

    createOwnShipSubmarineMesh() {
        const root = new THREE.Group();

        const hullMaterial = new THREE.MeshStandardMaterial({
            color: 0x8fc0c7,
            emissive: 0x08292f,
            roughness: 0.84,
            metalness: 0.08
        });
        const sailMaterial = new THREE.MeshStandardMaterial({
            color: 0x79aeb6,
            emissive: 0x082126,
            roughness: 0.8,
            metalness: 0.1
        });
        const detailMaterial = new THREE.MeshStandardMaterial({
            color: 0x5d8f98,
            emissive: 0x05181c,
            roughness: 0.76,
            metalness: 0.12
        });

        // Low-poly cylindrical hull aligned with +Z as forward.
        const hull = new THREE.Mesh(new THREE.CylinderGeometry(1.35, 1.35, 8.8, 10, 1, false), hullMaterial);
        hull.rotation.x = Math.PI / 2;
        root.add(hull);

        const bow = new THREE.Mesh(new THREE.SphereGeometry(1.35, 10, 8), hullMaterial);
        bow.scale.set(1, 1, 0.72);
        bow.position.z = 4.45;
        root.add(bow);

        const stern = new THREE.Mesh(new THREE.ConeGeometry(1.2, 2.2, 10), hullMaterial);
        stern.rotation.x = -Math.PI / 2;
        stern.position.z = -5.2;
        root.add(stern);

        const sail = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.3, 2.0, 1, 1, 1), sailMaterial);
        sail.position.set(0, 1.35, 0.55);
        root.add(sail);

        const sailCap = new THREE.Mesh(new THREE.SphereGeometry(0.58, 8, 6), sailMaterial);
        sailCap.scale.set(1.05, 0.55, 1);
        sailCap.position.set(0, 2.02, 0.55);
        root.add(sailCap);

        const sternPlaneGeo = new THREE.BoxGeometry(0.1, 0.95, 2.2, 1, 1, 1);
        const topFin = new THREE.Mesh(sternPlaneGeo, detailMaterial);
        topFin.position.set(0, 0.55, -4.9);
        root.add(topFin);
        const bottomFin = topFin.clone();
        bottomFin.position.y = -0.55;
        root.add(bottomFin);

        const sidePlaneGeo = new THREE.BoxGeometry(2.2, 0.1, 0.95, 1, 1, 1);
        const portFin = new THREE.Mesh(sidePlaneGeo, detailMaterial);
        portFin.position.set(-1.1, 0, -4.95);
        root.add(portFin);
        const starboardFin = portFin.clone();
        starboardFin.position.x = 1.1;
        root.add(starboardFin);

        const rudder = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.45, 0.8, 1, 1, 1), detailMaterial);
        rudder.position.set(0, 0.62, -5.55);
        root.add(rudder);

        const propHub = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.35, 8), detailMaterial);
        propHub.rotation.x = Math.PI / 2;
        propHub.position.z = -6.0;
        root.add(propHub);

        const bladeGeo = new THREE.BoxGeometry(0.06, 0.55, 0.16, 1, 1, 1);
        for (let i = 0; i < 4; i++) {
            const blade = new THREE.Mesh(bladeGeo, detailMaterial);
            const angle = (i / 4) * Math.PI * 2;
            blade.position.set(Math.cos(angle) * 0.34, Math.sin(angle) * 0.34, -6.03);
            blade.rotation.z = angle;
            root.add(blade);
        }

        return root;
    }

    setupOwnShip() {
        this.ownShipRoot = new THREE.Object3D();

        this.ownShipMesh = this.createOwnShipSubmarineMesh();
        this.ownShipRoot.add(this.ownShipMesh);

        const lineGeometry = new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(0, 0, 0),
            new THREE.Vector3(0, -1, 0)
        ]);
        const lineMaterial = new THREE.LineBasicMaterial({ color: 0x00ffff, transparent: true, opacity: 0.45 });
        this.verticalGuideLine = new THREE.Line(lineGeometry, lineMaterial);
        this.ownShipRoot.add(this.verticalGuideLine);

        this.setupDebugGizmos();

        const y = this.getTerrainHeight(0, 0) + 5.0;
        const scenePos = this.modelToScenePosition(0, 0);
        this.ownShipRoot.position.set(scenePos.x, y, scenePos.z);
        this.scene.add(this.ownShipRoot);
    }

    setupDebugGizmos() {
        const origin = new THREE.Vector3(0, 1.5, 0);
        this.shipAxisGizmos = new THREE.Group();
        this.shipAxisGizmos.visible = this.debugCoordinatesEnabled;

        const shipForwardArrow = new THREE.ArrowHelper(
            new THREE.Vector3(0, 0, 1),
            origin,
            12,
            0x00ff00,
            2.0,
            1.2
        );
        const shipRightArrow = new THREE.ArrowHelper(
            new THREE.Vector3(1, 0, 0),
            origin,
            10,
            0xffaa00,
            1.6,
            1.0
        );
        this.shipAxisGizmos.add(shipForwardArrow);
        this.shipAxisGizmos.add(shipRightArrow);
        this.ownShipRoot.add(this.shipAxisGizmos);

        this.worldAxisGizmos = new THREE.Group();
        this.worldAxisGizmos.visible = this.debugCoordinatesEnabled;

        this.worldNorthArrow = new THREE.ArrowHelper(
            new THREE.Vector3(0, 0, -1),
            new THREE.Vector3(0, 0, 0),
            14,
            0x00ffff,
            2.2,
            1.3
        );
        this.worldEastArrow = new THREE.ArrowHelper(
            new THREE.Vector3(1, 0, 0),
            new THREE.Vector3(0, 0, 0),
            12,
            0xff55ff,
            1.8,
            1.1
        );
        this.worldAxisGizmos.add(this.worldNorthArrow);
        this.worldAxisGizmos.add(this.worldEastArrow);
        this.scene.add(this.worldAxisGizmos);
    }

    setupSelectionRing() {
        const geometry = new THREE.TorusGeometry(3, 0.05, 12, 32);
        const material = new THREE.MeshBasicMaterial({ color: 0xff0000, transparent: true, opacity: 0.8 });

        this.selectionRing = new THREE.Mesh(geometry, material);
        this.selectionRing.rotation.x = Math.PI / 2;
        this.selectionRing.visible = false;
        this.scene.add(this.selectionRing);
    }

    setupMarineSnow() {
        const layerConfigs = [
            { count: 220, size: 0.24, opacity: 0.16, speedMin: 0.010, speedMax: 0.022, driftScale: 0.7 },
            { count: 180, size: 0.48, opacity: 0.24, speedMin: 0.018, speedMax: 0.038, driftScale: 1.1 },
            { count: 120, size: 0.84, opacity: 0.34, speedMin: 0.028, speedMax: 0.056, driftScale: 1.6 }
        ];

        this.marineSnowLayers = [];
        const span = 320;
        const ySpan = 220;
        const yMin = -110;
        const yMax = 110;

        for (const cfg of layerConfigs) {
            const geometry = new THREE.BufferGeometry();
            const positions = new Float32Array(cfg.count * 3);
            const speeds = new Float32Array(cfg.count);

            for (let i = 0; i < cfg.count; i++) {
                positions[i * 3] = (Math.random() - 0.5) * span;
                positions[i * 3 + 1] = (Math.random() - 0.5) * ySpan;
                positions[i * 3 + 2] = (Math.random() - 0.5) * span;
                speeds[i] = cfg.speedMin + Math.random() * (cfg.speedMax - cfg.speedMin);
            }

            geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
            geometry.userData = { speeds, yMin, yMax, span, driftScale: cfg.driftScale };

            const material = new THREE.PointsMaterial({
                color: 0xffffff,
                size: cfg.size,
                sizeAttenuation: true,
                transparent: true,
                opacity: cfg.opacity,
                blending: THREE.AdditiveBlending,
                depthWrite: false
            });

            const layer = new THREE.Points(geometry, material);
            this.scene.add(layer);
            this.marineSnowLayers.push(layer);
        }

        this.marineSnow = this.marineSnowLayers[0] || null;
    }

    setupOwnWakeParticles() {
        if (!this.scene) return;

        const particleCount = 480;
        const positions = new Float32Array(particleCount * 3);
        const velocities = new Float32Array(particleCount * 3);
        const life = new Float32Array(particleCount);
        positions.fill(0);

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

        const material = new THREE.PointsMaterial({
            color: 0xd6f3fa,
            size: 0.86,
            sizeAttenuation: true,
            transparent: true,
            opacity: 0.52,
            depthWrite: false,
            depthTest: false
        });

        this.ownWakeParticles = new THREE.Points(geometry, material);
        this.ownWakeParticles.frustumCulled = false;
        this.scene.add(this.ownWakeParticles);
        this._ownWakeParticleState = {
            cursor: 0,
            positions,
            velocities,
            life,
            count: particleCount
        };
    }

    updateOwnWakeParticles(ownX, ownZ, ownCourse, ownSpeed, dt) {
        if (!this._ownWakeParticleState || !this.ownWakeParticles) return;

        const safeDt = Number.isFinite(dt) ? Math.max(0.001, dt) : 0.016;
        const state = this._ownWakeParticleState;
        const speedAbs = Math.abs(ownSpeed);
        const speedNorm = clamp(speedAbs / 2.8, 0, 1);
        const emitBudget = speedAbs > 0.05 ? Math.floor(3 + (speedNorm * 14)) : 0;
        const scenePos = this.modelToScenePosition(ownX, ownZ);
        const sceneCourse = this.sceneCourseFromModelCourse(ownCourse);
        const forwardX = Math.sin(sceneCourse);
        const forwardZ = Math.cos(sceneCourse);
        const rightX = Math.cos(sceneCourse);
        const rightZ = -Math.sin(sceneCourse);
        const sternX = scenePos.x - (forwardX * 3.2);
        const sternZ = scenePos.z - (forwardZ * 3.2);
        const sternY = this.getTerrainHeight(ownX, ownZ) + 4.8;

        if (this.ownWakeParticles.material && this.ownWakeParticles.material.isPointsMaterial) {
            this.ownWakeParticles.material.opacity = 0.2 + (speedNorm * 0.45);
            this.ownWakeParticles.material.size = 0.72 + (speedNorm * 0.5);
        }

        for (let i = 0; i < emitBudget; i++) {
            const index = state.cursor;
            const p = index * 3;
            const sideJitter = (Math.random() - 0.5) * 1.8;
            state.positions[p] = sternX + (rightX * sideJitter);
            state.positions[p + 1] = sternY + ((Math.random() - 0.5) * 0.7);
            state.positions[p + 2] = sternZ + (rightZ * sideJitter);
            state.velocities[p] = (-forwardX * (0.08 + speedNorm * 0.65)) + ((Math.random() - 0.5) * 0.06);
            state.velocities[p + 1] = 0.09 + (Math.random() * 0.12);
            state.velocities[p + 2] = (-forwardZ * (0.08 + speedNorm * 0.65)) + ((Math.random() - 0.5) * 0.06);
            state.life[index] = 1.2 + (Math.random() * 1.0);
            state.cursor = (state.cursor + 1) % state.count;
        }

        for (let i = 0; i < state.count; i++) {
            const remaining = state.life[i];
            if (remaining <= 0) continue;
            const p = i * 3;
            state.life[i] = remaining - safeDt;
            state.positions[p] += state.velocities[p] * safeDt * 60;
            state.positions[p + 1] += state.velocities[p + 1] * safeDt * 60;
            state.positions[p + 2] += state.velocities[p + 2] * safeDt * 60;
            state.velocities[p] *= 0.978;
            state.velocities[p + 2] *= 0.978;
            if (state.life[i] <= 0) {
                state.positions[p] = scenePos.x;
                state.positions[p + 1] = sternY;
                state.positions[p + 2] = scenePos.z;
            }
        }

        this.ownWakeParticles.geometry.attributes.position.needsUpdate = true;
    }
}
