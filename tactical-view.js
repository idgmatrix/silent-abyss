export class TacticalView {
    constructor() {
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.terrain = null;
        this.targetMeshes = new Map();
        this.container = null;
    }

    init(containerId) {
        this.container = document.getElementById(containerId);
        if (!this.container) return;

        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(60, this.container.clientWidth / this.container.clientHeight, 0.1, 1000);
        this.camera.position.set(0, 50, 80);
        this.camera.lookAt(0, 0, 0);

        this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
        this.container.appendChild(this.renderer.domElement);

        this.setupTerrain();
        this.scene.add(new THREE.GridHelper(200, 20, 0x002222, 0x001111));

        window.addEventListener('resize', () => this.resize());
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

    updateTargetPosition(targetId, distance, angle) {
        const mesh = this.targetMeshes.get(targetId);
        if (mesh) {
            mesh.position.set(
                Math.cos(angle) * distance,
                1,
                Math.sin(angle) * distance
            );
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

    render() {
        if (this.renderer && this.scene && this.camera) {
            this.renderer.render(this.scene, this.camera);
        }
    }

    resize() {
        if (!this.renderer || !this.camera || !this.container) return;
        this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
        this.camera.aspect = this.container.clientWidth / this.container.clientHeight;
        this.camera.updateProjectionMatrix();
    }
}
