import * as THREE from 'three';

export class Tactical3DRenderer {
    constructor(getTerrainHeight) {
        this.getTerrainHeight = typeof getTerrainHeight === 'function' ? getTerrainHeight : () => 0;

        this.container = null;
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.terrain = null;
        this.ownShip = null;
        this.selectionRing = null;
        this.marineSnow = null;
        this.targetMeshes = new Map();
    }

    init(container) {
        if (this.renderer || !container) return;

        this.container = container;
        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(60, container.clientWidth / container.clientHeight, 0.1, 1000);
        this.camera.position.set(0, 50, 80);
        this.camera.lookAt(0, 0, 0);

        this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        this.renderer.setPixelRatio(window.devicePixelRatio || 1);
        this.renderer.setSize(container.clientWidth, container.clientHeight);
        this.renderer.domElement.style.position = 'absolute';
        this.renderer.domElement.style.top = '0';
        this.renderer.domElement.style.left = '0';
        this.renderer.domElement.style.width = '100%';
        this.renderer.domElement.style.height = '100%';
        container.appendChild(this.renderer.domElement);

        this.setupTerrain();
        this.setupOwnShip();
        this.setupSelectionRing();
        this.setupMarineSnow();
    }

    dispose() {
        if (this.renderer) {
            this.renderer.dispose();
            if (this.renderer.domElement && this.renderer.domElement.parentElement) {
                this.renderer.domElement.parentElement.removeChild(this.renderer.domElement);
            }
        }

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

        this.container = null;
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.terrain = null;
        this.ownShip = null;
        this.selectionRing = null;
        this.marineSnow = null;
        this.targetMeshes.clear();
    }

    setVisible(visible) {
        if (!this.renderer) return;
        this.renderer.domElement.style.display = visible ? 'block' : 'none';
    }

    resize(width, height) {
        if (!this.renderer || !this.camera) return;
        this.renderer.setSize(width, height);
        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
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
            new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0 })
        );
        mesh.userData = { type };
        this.scene.add(mesh);
        this.targetMeshes.set(targetId, mesh);
    }

    updateTargetPosition(targetId, x, z, passive = false) {
        const mesh = this.targetMeshes.get(targetId);
        if (!mesh) return;

        const y = this.getTerrainHeight(x, z) + 2.0;
        mesh.position.set(x, y, z);

        if (passive) {
            if (mesh.material.opacity < 0.3) mesh.material.opacity = 0.3;
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
        if (!this.terrain) return;
        this.terrain.material.uniforms.uScanRadius.value = radius;
        this.terrain.material.uniforms.uActive.value = active ? 1.0 : 0.0;
    }

    render(ownShipCourse, selectedTargetId, pulse) {
        if (!this.renderer || !this.scene || !this.camera) return;

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

        if (this.ownShip) {
            this.ownShip.rotation.y = -ownShipCourse;
        }

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

    pickTargetAtPoint(x, y, rect) {
        if (!this.camera) return null;

        let hitId = null;
        this.targetMeshes.forEach((mesh, id) => {
            if (mesh.material.opacity <= 0.2) return;

            const vec = new THREE.Vector3(mesh.position.x, mesh.position.y, mesh.position.z);
            vec.project(this.camera);

            const screenX = (vec.x * 0.5 + 0.5) * rect.width;
            const screenY = (-(vec.y * 0.5) + 0.5) * rect.height;
            const dist = Math.sqrt((x - screenX) ** 2 + (y - screenY) ** 2);
            if (dist < 20) hitId = id;
        });

        return hitId;
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

    setupTerrain() {
        const geometry = new THREE.PlaneGeometry(300, 300, 60, 60);
        geometry.rotateX(-Math.PI / 2);

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
                    vec3 baseColor = uColor * (0.2 + (vHeight + 15.0) / 30.0);
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

    setupOwnShip() {
        const geometry = new THREE.ConeGeometry(2, 6, 4);
        geometry.rotateX(Math.PI / 2);
        const material = new THREE.MeshBasicMaterial({ color: 0x00ff00, wireframe: true });
        const ownShip = new THREE.Mesh(geometry, material);
        const y = this.getTerrainHeight(0, 0) + 5.0;
        ownShip.position.set(0, y, 0);
        this.scene.add(ownShip);
        this.ownShip = ownShip;
    }
}
