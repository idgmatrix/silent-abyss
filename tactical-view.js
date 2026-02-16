export class TacticalView {
    constructor() {
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.terrain = null;
        this.targetMeshes = new Map();
        this.container = null;

        // View State
        this.viewMode = '3d'; // '3d', 'radial', 'grid'
        this.selectedTargetId = null;
        this.scanRadius = 0;
        this.scanActive = false;

        // Selection HUD elements
        this.selectionRing = null;

        // Particle System (Marine Snow)
        this.marineSnow = null;
        this.pulse = 0;

        // Canvases
        this.twoDCanvas = null;
        this.twoDCtx = null;
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

    init(containerId) {
        if (this.renderer) return; // Already initialized

        this.container = document.getElementById(containerId);
        console.log("TacticalView Init:", this.container);
        if (!this.container) return;

        this.scene = new THREE.Scene();
        if (!this.scene) {
             console.error("Scene failed to init");
             return;
        }
        this.camera = new THREE.PerspectiveCamera(60, this.container.clientWidth / this.container.clientHeight, 0.1, 1000);
        this.camera.position.set(0, 50, 80);
        this.camera.lookAt(0, 0, 0);

        this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
        this.renderer.domElement.style.position = 'absolute';
        this.renderer.domElement.style.top = '0';
        this.renderer.domElement.style.left = '0';
        this.renderer.domElement.style.width = '100%';
        this.renderer.domElement.style.height = '100%';
        this.container.appendChild(this.renderer.domElement);

        // Setup Single 2D Canvas (for Radial and Grid modes)
        this.twoDCanvas = document.createElement('canvas');
        this.twoDCanvas.style.position = 'absolute';
        this.twoDCanvas.style.top = '0';
        this.twoDCanvas.style.left = '0';
        this.twoDCanvas.style.width = '100%';
        this.twoDCanvas.style.height = '100%';
        this.twoDCanvas.style.pointerEvents = 'none'; // Let clicks pass through
        this.twoDCanvas.style.display = 'none'; // Hidden by default
        this.container.appendChild(this.twoDCanvas);
        this.twoDCtx = this.twoDCanvas.getContext('2d');

        // Event handlers
        this._resizeHandler = () => this.resize();
        this._clickHandler = (e) => this.handleCanvasClick(e);

        // Click handling
        this.container.addEventListener('click', this._clickHandler);

        this.setupTerrain();
        this.setupSelectionRing();
        this.setupMarineSnow();

        window.addEventListener('resize', this._resizeHandler);

        // Initial resize to set canvas dimensions
        this.resize();
    }

    dispose() {
        if (this._resizeHandler) {
            window.removeEventListener('resize', this._resizeHandler);
        }
        if (this.container && this._clickHandler) {
            this.container.removeEventListener('click', this._clickHandler);
        }

        if (this.renderer) {
            this.renderer.dispose();
            if (this.renderer.domElement && this.renderer.domElement.parentElement) {
                this.renderer.domElement.parentElement.removeChild(this.renderer.domElement);
            }
        }

        if (this.twoDCanvas && this.twoDCanvas.parentElement) {
            this.twoDCanvas.parentElement.removeChild(this.twoDCanvas);
        }

        if (this.scene) {
            this.scene.traverse(object => {
                if (object.geometry) object.geometry.dispose();
                if (object.material) {
                    if (Array.isArray(object.material)) {
                        object.material.forEach(mat => mat.dispose());
                    } else {
                        object.material.dispose();
                    }
                }
            });
        }

        this.renderer = null;
        this.scene = null;
        this.camera = null;
        this.twoDCtx = null;
        this.twoDCanvas = null;
        this.container = null;
        this.targetMeshes.clear();
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
        geometry.userData = { speeds: speeds };

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

    setupTerrain() {
        const geometry = new THREE.PlaneGeometry(300, 300, 60, 60);
        geometry.rotateX(-Math.PI / 2);

        // Apply noise to vertices
        const pos = geometry.attributes.position;
        for (let i = 0; i < pos.count; i++) {
            const x = pos.getX(i);
            const z = pos.getZ(i);
            const y = this.getTerrainHeight(x, z);
            pos.setY(i, y);
        }
        geometry.computeVertexNormals();

        const mat = new THREE.ShaderMaterial({
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

                    // Base color shaded by depth
                    vec3 baseColor = uColor * (0.2 + (vHeight + 15.0) / 30.0);

                    // Final color with ping ring
                    if (uActive > 0.5) {
                        gl_FragColor = vec4(baseColor + vec3(0.0, 1.0, 1.0) * ring * 0.8, 0.6 + ring * 0.4);
                    } else {
                        gl_FragColor = vec4(baseColor, 0.4);
                    }
                }`,
            transparent: true,
            wireframe: true
        });

        this.terrain = new THREE.Mesh(geometry, mat);
        this.scene.add(this.terrain);
    }

    addTarget(target) {
        const targetId = target.id;
        const type = target.type || 'SHIP';
        if (this.targetMeshes.has(targetId)) return;

        let geometry;
        let color;

        switch (type) {
            case 'SUBMARINE':
                geometry = new THREE.OctahedronGeometry(1.5, 0);
                color = 0x00ffff;
                break;
            case 'TORPEDO':
                geometry = new THREE.ConeGeometry(0.8, 4, 8);
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
            new THREE.MeshBasicMaterial({ color: color, transparent: true, opacity: 0 })
        );
        mesh.userData = { type: type }; // Store type for 2D rendering
        this.scene.add(mesh);
        this.targetMeshes.set(targetId, mesh);
    }

    updateTargetPosition(targetId, x, z, passive = false) {
        const mesh = this.targetMeshes.get(targetId);
        if (mesh) {
            const y = this.getTerrainHeight(x, z) + 2.0;
            mesh.position.set(x, y, z);
            if (passive) {
                // Passive detection maintains a base visibility
                if (mesh.material.opacity < 0.3) mesh.material.opacity = 0.3;
            } else {
                mesh.material.opacity = 1;
            }
        }
    }

    updateTargetOpacities(decayFactor = 0.98) {
        this.targetMeshes.forEach(mesh => {
            if (mesh.material.opacity > 0) {
                mesh.material.opacity *= decayFactor;
            }
        });
    }

    setScanExUniforms(radius, active) {
        this.scanRadius = radius;
        this.scanActive = active;
        if (this.terrain) {
            this.terrain.material.uniforms.uScanRadius.value = radius;
            this.terrain.material.uniforms.uActive.value = active ? 1.0 : 0.0;
        }
    }

    // Central render method called by main loop
    // Targets and ownShipCourse are passed from main.js
    render(targets, ownShipCourse) {
        if (!this.container) return;

        this.pulse = (Date.now() % 2000) / 2000; // 0 to 1 loop every 2 seconds

        if (this.viewMode === '3d') {
            // 3D Mode
            if (this.renderer && this.scene && this.camera) {
                this.renderer.domElement.style.display = 'block';
                if (this.twoDCanvas) this.twoDCanvas.style.display = 'none';

                // Update Selection Ring
                if (this.selectedTargetId && this.targetMeshes.has(this.selectedTargetId)) {
                    const targetMesh = this.targetMeshes.get(this.selectedTargetId);
                    this.selectionRing.position.copy(targetMesh.position);
                    this.selectionRing.visible = targetMesh.material.opacity > 0.1;
                    const s = 1.0 + Math.sin(this.pulse * Math.PI * 2) * 0.1;
                    this.selectionRing.scale.set(s, s, s);
                } else {
                    this.selectionRing.visible = false;
                }

                // Update Marine Snow
                if (this.marineSnow) {
                    const positions = this.marineSnow.geometry.attributes.position.array;
                    const speeds = this.marineSnow.geometry.userData.speeds;
                    for (let i = 0; i < speeds.length; i++) {
                        positions[i * 3 + 1] -= speeds[i];
                        if (positions[i * 3 + 1] < -100) positions[i * 3 + 1] = 100;
                    }
                    this.marineSnow.geometry.attributes.position.needsUpdate = true;
                }

                this.renderer.render(this.scene, this.camera);
            }
        } else {
            // 2D Modes (Radial or Grid)
            if (this.renderer) this.renderer.domElement.style.display = 'none';
            if (this.twoDCanvas) {
                this.twoDCanvas.style.display = 'block';

                if (this.viewMode === 'radial') {
                    this.render2DRadial(targets, ownShipCourse);
                } else if (this.viewMode === 'grid') {
                    this.renderGrid(targets);
                }
            }
        }
    }

    setViewMode(mode) {
        this.viewMode = mode;
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

        // Pulsing glow circle
        const glowAlpha = 0.2 + Math.sin(pulse * Math.PI * 2) * 0.1;
        ctx.strokeStyle = `rgba(255, 0, 0, ${glowAlpha})`;
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(0, 0, size * (1.1 + Math.sin(pulse * Math.PI * 2) * 0.05), 0, Math.PI * 2);
        ctx.stroke();

        // Corners
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

    handleCanvasClick(e) {
        const rect = this.container.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        let hitId = null;

        if (this.viewMode === '3d') {
            // Check targets in 3D
            this.targetMeshes.forEach((mesh, id) => {
                // Target must be visible enough to be selectable
                if (mesh.material.opacity <= 0.2) return;

                const vec = new THREE.Vector3(mesh.position.x, mesh.position.y, mesh.position.z);
                vec.project(this.camera);

                const screenX = (vec.x * 0.5 + 0.5) * rect.width;
                const screenY = (-(vec.y * 0.5) + 0.5) * rect.height;

                const dist = Math.sqrt((x - screenX)**2 + (y - screenY)**2);
                if (dist < 20) hitId = id;
            });
        } else if (this.viewMode === 'radial') {
            const centerX = rect.width / 2;
            const centerY = rect.height / 2;
            const scale = 1.5;
            const angleOffset = -Math.PI / 2;

            this.targetMeshes.forEach((mesh, id) => {
                const rotX = mesh.position.x * Math.cos(angleOffset) - mesh.position.z * Math.sin(angleOffset);
                const rotZ = mesh.position.x * Math.sin(angleOffset) + mesh.position.z * Math.cos(angleOffset);

                const dx = centerX + rotX * scale;
                const dy = centerY + rotZ * scale;

                const dist = Math.sqrt((x - dx)**2 + (y - dy)**2);
                if (dist < 25) hitId = id;
            });
        } else if (this.viewMode === 'grid') {
            const centerX = rect.width / 2;
            const centerY = rect.height / 2;
            const scale = 1.5;

            this.targetMeshes.forEach((mesh, id) => {
                const dx = centerX + mesh.position.x * scale;
                const dy = centerY + mesh.position.z * scale;

                const dist = Math.sqrt((x - dx)**2 + (y - dy)**2);
                if (dist < 25) hitId = id;
            });
        }

        this.selectedTargetId = hitId;
        this.container.dispatchEvent(new CustomEvent('targetSelected', { detail: { id: hitId } }));
    }

    render2DRadial(targets, ownShipCourse) {
        if (!this.container) return;
        const w = this.container.clientWidth;
        const h = this.container.clientHeight;
        const ctx = this.twoDCtx;

        // Clear with black background
        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, w, h);

        const centerX = w / 2;
        const centerY = h / 2;
        const scale = 1.5; // pixels per meter unit (reduced to fit more)

        ctx.strokeStyle = '#00ffff';
        ctx.lineWidth = 1;

        // Draw Rings
        for (let r = 50; r <= 200; r += 50) {
            ctx.beginPath();
            ctx.arc(centerX, centerY, r * scale, 0, Math.PI * 2);
            ctx.stroke();
            ctx.fillStyle = '#004444';
            ctx.fillText(`${r}m`, centerX + 5, centerY - r * scale - 5);
        }

        // Draw Targets
        ctx.font = '10px monospace';
        if (!targets) return;

        // Transform logic for RADIAL mode (North-Up)
        const angleOffset = -Math.PI / 2;

        // Grid Lines (0, 90, 180, 270)
        ctx.strokeStyle = '#002222';
        [0, 90, 180, 270].forEach(deg => {
            const rad = (deg * Math.PI / 180) + angleOffset;
            ctx.beginPath();
            ctx.moveTo(centerX, centerY);
            ctx.lineTo(centerX + Math.cos(rad) * 300, centerY + Math.sin(rad) * 300);
            ctx.stroke();
        });

        targets.forEach(t => {
            if (t.detected || t.isPassivelyDetected) {
                // Rotate position
                let tx = t.x;
                let tz = t.z;

                // Apply rotation
                const rotX = tx * Math.cos(angleOffset) - tz * Math.sin(angleOffset);
                const rotZ = tx * Math.sin(angleOffset) + tz * Math.cos(angleOffset);

                const dx = centerX + rotX * scale;
                const dy = centerY + rotZ * scale;

                const isSelected = this.selectedTargetId === t.id;

                // Set transparency for passive detections
                ctx.globalAlpha = t.detected ? 1.0 : 0.5;

                // Draw Selection HUD if selected
                if (isSelected) {
                    this.drawSelectionHUD(ctx, dx, dy, 12, this.pulse);
                }

                // Draw Target based on type
                ctx.fillStyle = this.getTypeColor(t.type);
                ctx.strokeStyle = ctx.fillStyle;
                ctx.lineWidth = 1;

                if (t.type === 'SUBMARINE') {
                    // Draw Diamond
                    ctx.beginPath();
                    ctx.moveTo(dx, dy - 8);
                    ctx.lineTo(dx + 8, dy);
                    ctx.lineTo(dx, dy + 8);
                    ctx.lineTo(dx - 8, dy);
                    ctx.closePath();
                    if (t.detected) ctx.fill();
                    ctx.stroke();
                } else if (t.type === 'TORPEDO') {
                    // Draw Triangle (pointing in course direction?)
                    // For now, fixed triangle
                    ctx.beginPath();
                    ctx.moveTo(dx, dy - 8);
                    ctx.lineTo(dx + 5, dy + 5);
                    ctx.lineTo(dx - 5, dy + 5);
                    ctx.closePath();
                    if (t.detected) ctx.fill();
                    ctx.stroke();
                } else if (t.type === 'BIOLOGICAL') {
                    // Draw Small Circle
                    ctx.beginPath();
                    ctx.arc(dx, dy, 4, 0, Math.PI * 2);
                    if (t.detected) ctx.fill();
                    ctx.stroke();
                } else if (t.type === 'STATIC') {
                    // Draw Square
                    if (t.detected) {
                        ctx.fillRect(dx - 6, dy - 6, 12, 12);
                    } else {
                        ctx.strokeRect(dx - 6, dy - 6, 12, 12);
                    }
                } else {
                    // Draw Circle (SHIP)
                    ctx.beginPath();
                    ctx.arc(dx, dy, 6, 0, Math.PI * 2);
                    if (t.detected) ctx.fill();
                    ctx.stroke();
                }

                // Draw Label
                ctx.fillStyle = '#ffffff';
                ctx.globalAlpha = 1.0;
                ctx.fillText(t.id.replace('target-', 'T'), dx + 10, dy);
            }
        });

        // Draw Ping Ring
        if (this.scanActive) {
            ctx.strokeStyle = '#00ffff';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(centerX, centerY, this.scanRadius * scale, 0, Math.PI * 2);
            ctx.stroke();

            // Fading trail
            ctx.strokeStyle = 'rgba(0, 255, 255, 0.4)';
            ctx.beginPath();
            ctx.arc(centerX, centerY, (this.scanRadius - 5) * scale, 0, Math.PI * 2);
            ctx.stroke();
        }

        // Draw Own Ship (Center)
        ctx.save();
        ctx.translate(centerX, centerY);
        // Ship triangle pointing up (North)
        ctx.beginPath();
        ctx.moveTo(0, -10);
        ctx.lineTo(5, 5);
        ctx.lineTo(-5, 5);
        ctx.closePath();
        ctx.fillStyle = '#00ff00';
        ctx.fill();
        ctx.restore();
    }

    renderGrid(targets) {
        if (!this.twoDCtx || !this.twoDCanvas || !this.container) return;

        const w = this.container.clientWidth;
        const h = this.container.clientHeight;
        const ctx = this.twoDCtx;

        // Clear with black background
        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, w, h);

        const centerX = w / 2;
        const centerY = h / 2;
        const scale = 1.5;

        ctx.strokeStyle = '#004444';
        ctx.lineWidth = 1;
        ctx.fillStyle = '#00ffff';

        // Draw Grid Lines
        for(let i = -5; i <= 5; i++) {
            ctx.beginPath();
            ctx.moveTo(0, centerY + i * 50);
            ctx.lineTo(w, centerY + i * 50);
            ctx.stroke();

            ctx.beginPath();
            ctx.moveTo(centerX + i * 50, 0);
            ctx.lineTo(centerX + i * 50, h);
            ctx.stroke();
        }

        // Draw Axes
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

        if (!targets) return;

        // Draw Targets
        targets.forEach(t => {
            if (t.detected || t.isPassivelyDetected) {
                const dx = centerX + t.x * scale;
                const dy = centerY + t.z * scale;

                const isSelected = this.selectedTargetId === t.id;
                ctx.globalAlpha = t.detected ? 1.0 : 0.5;

                if (isSelected) {
                    this.drawSelectionHUD(ctx, dx, dy, 10, this.pulse);
                }

                ctx.fillStyle = this.getTypeColor(t.type);
                ctx.strokeStyle = ctx.fillStyle;
                ctx.lineWidth = 1;

                if (t.type === 'SUBMARINE') {
                    // Diamond
                    ctx.beginPath();
                    ctx.moveTo(dx, dy - 7);
                    ctx.lineTo(dx + 7, dy);
                    ctx.lineTo(dx, dy + 7);
                    ctx.lineTo(dx - 7, dy);
                    ctx.closePath();
                    if (t.detected) ctx.fill();
                    ctx.stroke();
                } else if (t.type === 'TORPEDO') {
                    // Triangle
                    ctx.beginPath();
                    ctx.moveTo(dx, dy - 7);
                    ctx.lineTo(dx + 4, dy + 4);
                    ctx.lineTo(dx - 4, dy + 4);
                    ctx.closePath();
                    if (t.detected) ctx.fill();
                    ctx.stroke();
                } else if (t.type === 'BIOLOGICAL') {
                    // Circle
                    ctx.beginPath();
                    ctx.arc(dx, dy, 4, 0, Math.PI * 2);
                    if (t.detected) ctx.fill();
                    ctx.stroke();
                } else {
                    // Square
                    if (t.detected) {
                        ctx.fillRect(dx - 5, dy - 5, 10, 10);
                    } else {
                        ctx.strokeRect(dx - 5, dy - 5, 10, 10);
                    }
                }

                // Label
                ctx.fillStyle = '#ffffff';
                ctx.font = '8px monospace';
                ctx.globalAlpha = 1.0;
                ctx.fillText(t.id.replace('target-', 'T'), dx + 8, dy);
            }
        });

        // Draw Ping Ring (Square-ish or circular, let's stick to circular for consistency)
        if (this.scanActive) {
            ctx.strokeStyle = '#00ffff';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(centerX, centerY, this.scanRadius * scale, 0, Math.PI * 2);
            ctx.stroke();
        }

        // Own Ship
        ctx.fillStyle = '#00ff00';
        ctx.beginPath();
        ctx.moveTo(centerX, centerY - 8);
        ctx.lineTo(centerX + 6, centerY + 6);
        ctx.lineTo(centerX - 6, centerY + 6);
        ctx.fill();
    }

    resize() {
        if (!this.renderer || !this.camera || !this.container) return;
        const dpr = window.devicePixelRatio || 1;
        const width = this.container.clientWidth;
        const height = this.container.clientHeight;

        this.renderer.setSize(width, height);

        // Resize 2D canvas
        if (this.twoDCanvas) {
             this.twoDCanvas.width = width * dpr;
             this.twoDCanvas.height = height * dpr;
             // Scale context to use CSS pixels for drawing
             if (this.twoDCtx) this.twoDCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
        }

        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
    }
}
