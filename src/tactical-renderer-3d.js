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

export class Tactical3DRenderer {
    constructor(getTerrainHeight) {
        this.getTerrainHeight = typeof getTerrainHeight === 'function' ? getTerrainHeight : () => 0;

        this.container = null;
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.rendererBackend = 'webgl';

        this.terrain = null;
        this.terrainGridLines = null;
        this.waterSurface = null;
        this.scanRingFx = null;
        this.terrainContours = null;

        this.ownShipRoot = null;
        this.ownShipMesh = null;
        this.verticalGuideLine = null;
        this.shipAxisGizmos = null;
        this.worldAxisGizmos = null;
        this.worldNorthArrow = null;
        this.worldEastArrow = null;

        this.selectionRing = null;
        this.marineSnow = null;
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

        this._currentLookAt = new THREE.Vector3();
        this._cameraReady = false;
        this._tmpVec3A = new THREE.Vector3();
        this._tmpVec3B = new THREE.Vector3();
        this._tmpWorldPos = new THREE.Vector3();

        this.debugCoordinatesEnabled = false;
    }

    async init(container) {
        if (this.renderer || !container) return;

        this.container = container;
        this.scene = new THREE.Scene();

        const initWidth = Math.max(1, Math.floor(container.clientWidth || 0));
        const initHeight = Math.max(1, Math.floor(container.clientHeight || 0));

        this.camera = new THREE.PerspectiveCamera(60, initWidth / initHeight, 0.1, 1400);
        this.camera.position.set(0, 40, 100);
        this.camera.lookAt(0, 0, 0);

        this.renderer = await this._createRenderer();
        this.renderer.setPixelRatio(window.devicePixelRatio || 1);
        this.renderer.setSize(initWidth, initHeight);
        this.renderer.domElement.style.position = 'absolute';
        this.renderer.domElement.style.top = '0';
        this.renderer.domElement.style.left = '0';
        this.renderer.domElement.style.width = '100%';
        this.renderer.domElement.style.height = '100%';
        container.appendChild(this.renderer.domElement);

        this.setupTerrain();
        this.setupWaterSurface();
        this.setupOwnShip();
        this.setupSelectionRing();
        this.setupMarineSnow();

        await this.cavitationParticles.init(this.scene);
    }

    async _createRenderer() {
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
                    this.rendererBackend = 'webgpu';
                    return renderer;
                }
            } catch (error) {
                console.warn('Failed to create WebGPU renderer, using WebGL fallback:', error);
            }
        }

        this.rendererBackend = 'webgl';
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

        this.terrain = null;
        this.terrainGridLines = null;
        this.waterSurface = null;
        this.scanRingFx = null;
        this.terrainContours = null;
        this.ownShipRoot = null;
        this.ownShipMesh = null;
        this.verticalGuideLine = null;
        this.shipAxisGizmos = null;
        this.worldAxisGizmos = null;
        this.worldNorthArrow = null;
        this.worldEastArrow = null;
        this.selectionRing = null;
        this.marineSnow = null;

        this.targetMeshes.clear();

        this._cavitationPending = false;
        this._renderPending = false;
        this._lastTerrainGridCenter = { x: Number.NaN, z: Number.NaN };
        this._cameraReady = false;
    }

    setVisible(visible) {
        if (!this.renderer) return;
        this.renderer.domElement.style.display = visible ? 'block' : 'none';
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
        if (this.terrain && this.terrain.material.uniforms) {
            this.terrain.material.uniforms.uScanRadius.value = radius;
            this.terrain.material.uniforms.uActive.value = active ? 1.0 : 0.0;
        }

        if (this.scanRingFx) {
            this.scanRingFx.visible = !!active;
            const ringRadius = Math.max(1, radius);
            this.scanRingFx.scale.set(ringRadius, ringRadius, ringRadius);
        }
    }

    render(ownShipPose, selectedTargetId, pulse, targets = [], dt = 0.016) {
        if (!this.renderer || !this.scene || !this.camera) return;

        const ownX = Number.isFinite(ownShipPose?.x) ? ownShipPose.x : 0;
        const ownZ = Number.isFinite(ownShipPose?.z) ? ownShipPose.z : 0;
        const ownCourse = Number.isFinite(ownShipPose?.course) ? ownShipPose.course : 0;

        this.updateTerrainAroundShip(ownX, ownZ);
        this.updateOwnShipAndCamera(ownX, ownZ, ownCourse, dt);

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

    updateOwnShipAndCamera(ownX, ownZ, ownCourse, dt) {
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

    updateMarineSnow(dt, ownX, ownZ) {
        if (!this.marineSnow) return;

        const positions = this.marineSnow.geometry.attributes.position.array;
        const speeds = this.marineSnow.geometry.userData.speeds;
        const fallFactor = clamp((Number.isFinite(dt) ? dt : 0.016) * 60, 0.1, 2.5);

        for (let i = 0; i < speeds.length; i++) {
            positions[i * 3 + 1] -= speeds[i] * fallFactor;
            if (positions[i * 3 + 1] < -100) positions[i * 3 + 1] = 100;
        }

        this.marineSnow.geometry.attributes.position.needsUpdate = true;
        const scenePos = this.modelToScenePosition(ownX, ownZ);
        this.marineSnow.position.set(scenePos.x, this.getTerrainHeight(ownX, ownZ) + 10, scenePos.z);
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
        const lines = [];

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

        for (const level of this._contourLevels) {
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
                        lines.push(
                            gridX + a.x, level + 0.2, gridZ + a.z,
                            gridX + b.x, level + 0.2, gridZ + b.z
                        );
                    }
                }
            }
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(lines, 3));
        this.terrainContours.geometry.dispose();
        this.terrainContours.geometry = geometry;
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
                    uColor: { value: new THREE.Color(0x004444) },
                    uActive: { value: 0.0 }
                },
                vertexShader: `
                varying float vDist;
                varying float vHeight;
                void main() {
                    vDist = length(position.xz);
                    vHeight = position.y;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }`,
                fragmentShader: `
                uniform float uScanRadius;
                uniform vec3 uColor;
                uniform float uActive;
                varying float vDist;
                varying float vHeight;
                void main() {
                    float ring = smoothstep(uScanRadius - 12.0, uScanRadius, vDist) * (1.0 - smoothstep(uScanRadius, uScanRadius + 1.0, vDist));
                    vec3 baseColor = uColor * (0.2 + (vHeight + 15.0) / 30.0);
                    if (uActive > 0.5) {
                        gl_FragColor = vec4(baseColor + vec3(0.0, 1.0, 1.0) * ring * 0.8, 0.6 + ring * 0.4);
                    } else {
                        gl_FragColor = vec4(baseColor, 0.4);
                    }
                }`,
                transparent: true,
                wireframe: false
            })
            : new THREE.MeshBasicMaterial({
                color: 0x0f5f5f,
                transparent: true,
                opacity: 0.45,
                wireframe: false
            });

        this.terrain = new THREE.Mesh(geometry, material);
        this.scene.add(this.terrain);

        const gridMaterial = new THREE.LineBasicMaterial({
            color: 0x0f5f5f,
            transparent: true,
            opacity: 0.55
        });
        this.terrainGridLines = new THREE.LineSegments(new THREE.BufferGeometry(), gridMaterial);
        this.terrainGridLines.frustumCulled = false;
        this.scene.add(this.terrainGridLines);
        this.updateTerrainGridLines(0, 0);

        const contourMaterial = new THREE.LineBasicMaterial({
            color: 0x00ffff,
            transparent: true,
            opacity: 0.35
        });
        this.terrainContours = new THREE.LineSegments(new THREE.BufferGeometry(), contourMaterial);
        this.terrainContours.frustumCulled = false;
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
    }

    setupWaterSurface() {
        const geometry = new THREE.PlaneGeometry(300, 300, 1, 1);
        geometry.rotateX(-Math.PI / 2);

        const material = new THREE.MeshBasicMaterial({
            color: 0x114444,
            transparent: true,
            opacity: 0.14,
            depthWrite: false
        });

        this.waterSurface = new THREE.Mesh(geometry, material);
        this.waterSurface.position.y = 0;
        this.scene.add(this.waterSurface);
    }

    setupOwnShip() {
        this.ownShipRoot = new THREE.Object3D();

        const shipGeometry = new THREE.ConeGeometry(2, 6, 6);
        shipGeometry.rotateX(Math.PI / 2);
        const shipMaterial = new THREE.MeshBasicMaterial({ color: 0x00ff00, wireframe: true });

        this.ownShipMesh = new THREE.Mesh(shipGeometry, shipMaterial);
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
        const count = 500;
        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(count * 3);
        const speeds = new Float32Array(count);

        for (let i = 0; i < count; i++) {
            positions[i * 3] = (Math.random() - 0.5) * 300;
            positions[i * 3 + 1] = (Math.random() - 0.5) * 200;
            positions[i * 3 + 2] = (Math.random() - 0.5) * 300;
            speeds[i] = 0.02 + Math.random() * 0.05;
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.userData = { speeds };

        const material = new THREE.PointsMaterial({
            color: 0xffffff,
            size: 0.5,
            transparent: true,
            opacity: 0.3,
            blending: THREE.AdditiveBlending
        });

        this.marineSnow = new THREE.Points(geometry, material);
        this.scene.add(this.marineSnow);
    }
}
