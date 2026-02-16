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

        // Canvases
        this.twoDCanvas = null;
        this.twoDCtx = null;
    }

    init(containerId) {
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

        // Click handling
        this.container.addEventListener('click', (e) => this.handleCanvasClick(e));

        this.setupTerrain();
        this.scene.add(new THREE.GridHelper(200, 20, 0x00ffff, 0x004444));

        // Debug cube
        const cube = new THREE.Mesh(new THREE.BoxGeometry(5, 5, 5), new THREE.MeshBasicMaterial({ color: 0x00ff00 }));
        cube.position.y = 10;
        this.scene.add(cube);

        window.addEventListener('resize', () => this.resize());

        // Initial resize to set canvas dimensions
        this.resize();
    }

    setupTerrain() {
        const mat = new THREE.ShaderMaterial({
            uniforms: {
                uScanRadius: { value: 0 },
                uColor: { value: new THREE.Color(0x004444) },
                uActive: { value: 0.0 }
            },
            vertexShader: `varying float vDist; void main() { vDist = length(position.xz); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
            fragmentShader: `
                uniform float uScanRadius;
                uniform vec3 uColor;
                uniform float uActive;
                varying float vDist;
                void main() {
                    float ring = smoothstep(uScanRadius - 10.0, uScanRadius, vDist) * (1.0 - smoothstep(uScanRadius, uScanRadius + 0.5, vDist));
                    if(uActive < 0.5) discard;
                    gl_FragColor = vec4(uColor * (0.1 + ring * 5.0), ring);
                }`,
            transparent: true, wireframe: true
        });
        this.terrain = new THREE.Mesh(new THREE.PlaneGeometry(200, 200, 30, 30).rotateX(-Math.PI/2), mat);
        this.scene.add(this.terrain);
    }

    addTarget(targetId) {
        if (this.targetMeshes.has(targetId)) return;

        const mesh = new THREE.Mesh(
            new THREE.SphereGeometry(1.5, 8, 8),
            new THREE.MeshBasicMaterial({ color: 0xff0000, transparent: true, opacity: 0 })
        );
        this.scene.add(mesh);
        this.targetMeshes.set(targetId, mesh);
    }

    updateTargetPosition(targetId, x, z) {
        const mesh = this.targetMeshes.get(targetId);
        if (mesh) {
            mesh.position.set(x, 1, z);
            mesh.material.opacity = 1;
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
        if (this.terrain) {
            this.terrain.material.uniforms.uScanRadius.value = radius;
            this.terrain.material.uniforms.uActive.value = active ? 1.0 : 0.0;
        }
    }

    // Central render method called by main loop
    // Targets and ownShipCourse are passed from main.js
    render(targets, ownShipCourse) {
        if (!this.container) return;

        if (this.viewMode === '3d') {
            // 3D Mode
            if (this.renderer && this.scene && this.camera) {
                this.renderer.domElement.style.display = 'block';
                if (this.twoDCanvas) this.twoDCanvas.style.display = 'none';
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

    handleCanvasClick(e) {
        const rect = this.container.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        // Check targets
        this.targetMeshes.forEach((mesh, id) => {
            if (mesh.material.opacity <= 0.1) return; // Ignore undetected targets

            const vec = new THREE.Vector3(mesh.position.x, mesh.position.y, mesh.position.z);
            vec.project(this.camera);

            const screenX = (vec.x * 0.5 + 0.5) * rect.width;
            const screenY = (-(vec.y * 0.5) + 0.5) * rect.height;

            const dist = Math.sqrt((x - screenX)**2 + (y - screenY)**2);
            if (dist < 20) {
                this.selectedTargetId = id;
                // Dispatch event or callback?
                // Let's check if there's a callback or we can just read it.
                // We'll rely on main.js polling or passing a callback.
                // For now, let's dispatch a custom event.
                this.container.dispatchEvent(new CustomEvent('targetSelected', { detail: { id } }));
            }
        });
    }

    render2DRadial(targets, ownShipCourse) {
        const w = this.twoDCanvas.width;
        const h = this.twoDCanvas.height;
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
        // North is Up (0 degrees in ThreeJS is +X, which is East).
        // We want +Z (North) to be Up.
        // -90 degrees (-PI/2) to rotate +Z to point up.
        const angleOffset = -Math.PI / 2;

        // We can use ctx.rotate, but we need to convert target positions (x, z) first.
        // x is East, z is South (in standard 3D view from top).
        // Let's just iterate and draw.

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
            if (t.detected) {
                // Rotate position
                let tx = t.x;
                let tz = t.z;

                // Apply rotation
                const rotX = tx * Math.cos(angleOffset) - tz * Math.sin(angleOffset);
                const rotZ = tx * Math.sin(angleOffset) + tz * Math.cos(angleOffset);

                const dx = centerX + rotX * scale;
                const dy = centerY + rotZ * scale;

                // Draw Target
                ctx.fillStyle = this.selectedTargetId === t.id ? '#ff0000' : '#ff8800';
                ctx.beginPath();
                ctx.arc(dx, dy, 6, 0, Math.PI * 2);
                ctx.fill();

                // Draw Label
                ctx.fillStyle = '#ffffff';
                ctx.fillText(t.id.replace('target-', 'T'), dx + 10, dy);
            }
        });

        // Draw Own Ship (Center) - Fixed orientation for North-Up
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
        if (!this.twoDCtx || !this.twoDCanvas) return;

        const w = this.twoDCanvas.width;
        const h = this.twoDCanvas.height;
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

        // Draw Targets (Simple squares for grid)
        targets.forEach(t => {
            if (t.detected) {
                const dx = centerX + t.x * scale;
                const dy = centerY + t.z * scale; // Z is 'down' in 2D canvas usually, but let's stick to standard map

                ctx.fillStyle = this.selectedTargetId === t.id ? '#ff0000' : '#ff8800';
                ctx.fillRect(dx - 5, dy - 5, 10, 10);

                // Label
                ctx.fillStyle = '#ffffff';
                ctx.font = '8px monospace';
                ctx.fillText(t.id.replace('target-', 'T'), dx + 8, dy);
            }
        });

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
        }

        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
    }
}
