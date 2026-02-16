import * as THREE from 'three';

const GPU_BUFFER_USAGE = {
    MAP_READ: 0x0001,
    COPY_SRC: 0x0004,
    COPY_DST: 0x0008,
    UNIFORM: 0x0040,
    STORAGE: 0x0080
};

const GPU_MAP_MODE = {
    READ: 0x0001
};

function randomSigned(range) {
    return (Math.random() * 2 - 1) * range;
}

export class CavitationParticles {
    constructor(options = {}) {
        this.maxParticles = options.maxParticles ?? 1536;
        this.speedThreshold = options.speedThreshold ?? 1.1;

        this.scene = null;
        this.points = null;
        this.geometry = null;
        this.material = null;

        this.positions = new Float32Array(this.maxParticles * 3);
        this.velocities = new Float32Array(this.maxParticles * 3);
        this.life = new Float32Array(this.maxParticles);

        this.backend = 'cpu';
        this.ready = false;

        this.adapter = null;
        this.device = null;
        this.pipeline = null;
        this.bindGroup = null;

        this.particleBuffer = null;
        this.velocityBuffer = null;
        this.emittersBuffer = null;
        this.paramsBuffer = null;
        this.readbackBuffer = null;

        this.maxEmitters = 64;
        this.frameCounter = 0;
    }

    async init(scene) {
        if (!scene || this.ready) return;

        this.scene = scene;
        this._setupRenderObjects();

        const gpuOk = await this._initWebGPU();
        this.backend = gpuOk ? 'webgpu' : 'cpu';
        this.ready = true;
    }

    getCapabilities() {
        return {
            backend: this.backend,
            speedThreshold: this.speedThreshold,
            maxParticles: this.maxParticles,
            ready: this.ready
        };
    }

    async update(emitters, dt) {
        if (!this.ready || !this.points) return;

        const clampedDt = Math.min(0.1, Math.max(0.001, dt || 0.016));
        const validEmitters = Array.isArray(emitters) ? emitters : [];

        if (this.backend === 'webgpu' && this.device) {
            try {
                await this._updateWebGPU(validEmitters, clampedDt);
                return;
            } catch (error) {
                console.warn('Cavitation WebGPU update failed, falling back to CPU:', error);
                this.backend = 'cpu';
            }
        }

        this._updateCPU(validEmitters, clampedDt);
    }

    _setupRenderObjects() {
        this.geometry = new THREE.BufferGeometry();
        this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));

        this.material = new THREE.PointsMaterial({
            color: 0xb8f6ff,
            size: 0.6,
            transparent: true,
            opacity: 0.6,
            depthWrite: false,
            blending: THREE.AdditiveBlending
        });

        this.points = new THREE.Points(this.geometry, this.material);
        this.points.frustumCulled = false;
        this.scene.add(this.points);

        for (let i = 0; i < this.maxParticles; i++) {
            this._deactivateParticle(i);
        }
    }

    async _initWebGPU() {
        if (typeof navigator === 'undefined' || !navigator.gpu) {
            return false;
        }

        try {
            this.adapter = await navigator.gpu.requestAdapter();
            if (!this.adapter) return false;

            this.device = await this.adapter.requestDevice();

            const particleData = new Float32Array(this.maxParticles * 4);
            const velocityData = new Float32Array(this.maxParticles * 4);
            for (let i = 0; i < this.maxParticles; i++) {
                particleData[i * 4 + 1] = -9999;
            }

            this.particleBuffer = this.device.createBuffer({
                size: particleData.byteLength,
                usage: GPU_BUFFER_USAGE.STORAGE | GPU_BUFFER_USAGE.COPY_DST | GPU_BUFFER_USAGE.COPY_SRC
            });

            this.velocityBuffer = this.device.createBuffer({
                size: velocityData.byteLength,
                usage: GPU_BUFFER_USAGE.STORAGE | GPU_BUFFER_USAGE.COPY_DST
            });

            this.emittersBuffer = this.device.createBuffer({
                size: this.maxEmitters * 4 * 4,
                usage: GPU_BUFFER_USAGE.STORAGE | GPU_BUFFER_USAGE.COPY_DST
            });

            this.paramsBuffer = this.device.createBuffer({
                size: 16,
                usage: GPU_BUFFER_USAGE.UNIFORM | GPU_BUFFER_USAGE.COPY_DST
            });

            this.readbackBuffer = this.device.createBuffer({
                size: particleData.byteLength,
                usage: GPU_BUFFER_USAGE.COPY_DST | GPU_BUFFER_USAGE.MAP_READ
            });

            this.device.queue.writeBuffer(this.particleBuffer, 0, particleData);
            this.device.queue.writeBuffer(this.velocityBuffer, 0, velocityData);

            const shaderModule = this.device.createShaderModule({
                label: 'cavitation-compute-shader',
                code: `
struct Params {
    dt : f32,
    emitterCount : f32,
    time : f32,
    speedScale : f32,
};

@group(0) @binding(0) var<storage, read_write> particles : array<vec4<f32>>;
@group(0) @binding(1) var<storage, read_write> velocities : array<vec4<f32>>;
@group(0) @binding(2) var<storage, read> emitters : array<vec4<f32>>;
@group(0) @binding(3) var<uniform> params : Params;

fn rand(seed : f32) -> f32 {
    return fract(sin(seed) * 43758.5453123);
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
    let idx = gid.x;
    if (idx >= ${this.maxParticles}u) {
        return;
    }

    var particle = particles[idx];
    var velocity = velocities[idx];

    particle.w = particle.w - params.dt;

    if (particle.w <= 0.0) {
        if (params.emitterCount <= 0.0) {
            particle = vec4<f32>(0.0, -9999.0, 0.0, 0.0);
            velocity = vec4<f32>(0.0);
            particles[idx] = particle;
            velocities[idx] = velocity;
            return;
        }

        let emitterIndex = u32(f32(idx) % params.emitterCount);
        let emitter = emitters[emitterIndex];
        let baseSeed = f32(idx) * 17.0 + params.time * 31.0;

        let ox = (rand(baseSeed + 1.0) - 0.5) * 2.0;
        let oy = rand(baseSeed + 2.0) * 0.6;
        let oz = (rand(baseSeed + 3.0) - 0.5) * 2.0;

        let newPos = emitter.xyz + vec3<f32>(ox, oy, oz);
        particle = vec4<f32>(newPos, 0.8 + rand(baseSeed + 4.0) * 1.3);

        let vx = (rand(baseSeed + 5.0) - 0.5) * 0.6;
        let vy = 0.5 + rand(baseSeed + 6.0) * 1.1;
        let vz = (rand(baseSeed + 7.0) - 0.5) * 0.6;

        velocity = vec4<f32>(vec3<f32>(vx, vy, vz) * (emitter.w * params.speedScale), velocity.w);
    } else {
        let newVelY = velocity.y + params.dt * 0.18;
        velocity = vec4<f32>(velocity.x, newVelY, velocity.z, velocity.w);
        particle = vec4<f32>(particle.xyz + velocity.xyz * params.dt, particle.w);
    }

    particles[idx] = particle;
    velocities[idx] = velocity;
}
`
            });

            this.pipeline = this.device.createComputePipeline({
                label: 'cavitation-compute-pipeline',
                layout: 'auto',
                compute: {
                    module: shaderModule,
                    entryPoint: 'main'
                }
            });

            this.bindGroup = this.device.createBindGroup({
                layout: this.pipeline.getBindGroupLayout(0),
                entries: [
                    { binding: 0, resource: { buffer: this.particleBuffer } },
                    { binding: 1, resource: { buffer: this.velocityBuffer } },
                    { binding: 2, resource: { buffer: this.emittersBuffer } },
                    { binding: 3, resource: { buffer: this.paramsBuffer } }
                ]
            });

            return true;
        } catch (error) {
            console.warn('Cavitation WebGPU initialization failed:', error);
            return false;
        }
    }

    async _updateWebGPU(emitters, dt) {
        const emitterData = new Float32Array(this.maxEmitters * 4);
        const emitCount = Math.min(emitters.length, this.maxEmitters);

        for (let i = 0; i < emitCount; i++) {
            const e = emitters[i];
            emitterData[i * 4] = e.x;
            emitterData[i * 4 + 1] = e.y;
            emitterData[i * 4 + 2] = e.z;
            emitterData[i * 4 + 3] = Math.max(0.4, e.intensity ?? 1);
        }

        this.frameCounter++;

        this.device.queue.writeBuffer(this.emittersBuffer, 0, emitterData);
        this.device.queue.writeBuffer(
            this.paramsBuffer,
            0,
            new Float32Array([dt, emitCount, performance.now() * 0.001, 1.0])
        );

        const encoder = this.device.createCommandEncoder({ label: 'cavitation-update-encoder' });
        const pass = encoder.beginComputePass({ label: 'cavitation-update-pass' });
        pass.setPipeline(this.pipeline);
        pass.setBindGroup(0, this.bindGroup);
        pass.dispatchWorkgroups(Math.ceil(this.maxParticles / 64));
        pass.end();

        encoder.copyBufferToBuffer(
            this.particleBuffer,
            0,
            this.readbackBuffer,
            0,
            this.maxParticles * 4 * 4
        );

        this.device.queue.submit([encoder.finish()]);
        await this.device.queue.onSubmittedWorkDone();

        await this.readbackBuffer.mapAsync(GPU_MAP_MODE.READ);
        const gpuData = new Float32Array(this.readbackBuffer.getMappedRange());

        for (let i = 0; i < this.maxParticles; i++) {
            this.positions[i * 3] = gpuData[i * 4];
            this.positions[i * 3 + 1] = gpuData[i * 4 + 1];
            this.positions[i * 3 + 2] = gpuData[i * 4 + 2];
        }

        this.readbackBuffer.unmap();

        this.geometry.attributes.position.needsUpdate = true;
    }

    _updateCPU(emitters, dt) {
        for (let i = 0; i < this.maxParticles; i++) {
            this.life[i] -= dt;

            const base = i * 3;
            if (this.life[i] <= 0) {
                if (emitters.length === 0) {
                    this._deactivateParticle(i);
                    continue;
                }

                const emitter = emitters[i % emitters.length];
                const intensity = Math.max(0.4, emitter.intensity ?? 1);

                this.positions[base] = emitter.x + randomSigned(1.0);
                this.positions[base + 1] = emitter.y + Math.random() * 0.5;
                this.positions[base + 2] = emitter.z + randomSigned(1.0);

                this.velocities[base] = randomSigned(0.6) * intensity;
                this.velocities[base + 1] = (0.5 + Math.random()) * intensity;
                this.velocities[base + 2] = randomSigned(0.6) * intensity;

                this.life[i] = 0.8 + Math.random() * 1.3;
                continue;
            }

            this.velocities[base + 1] += dt * 0.18;
            this.positions[base] += this.velocities[base] * dt;
            this.positions[base + 1] += this.velocities[base + 1] * dt;
            this.positions[base + 2] += this.velocities[base + 2] * dt;
        }

        this.geometry.attributes.position.needsUpdate = true;
    }

    _deactivateParticle(i) {
        const base = i * 3;
        this.positions[base] = 0;
        this.positions[base + 1] = -9999;
        this.positions[base + 2] = 0;
        this.velocities[base] = 0;
        this.velocities[base + 1] = 0;
        this.velocities[base + 2] = 0;
        this.life[i] = 0;
    }

    dispose() {
        if (this.points && this.scene) {
            this.scene.remove(this.points);
        }

        this.geometry?.dispose();
        this.material?.dispose();

        this.particleBuffer?.destroy();
        this.velocityBuffer?.destroy();
        this.emittersBuffer?.destroy();
        this.paramsBuffer?.destroy();
        this.readbackBuffer?.destroy();

        this.points = null;
        this.geometry = null;
        this.material = null;

        this.particleBuffer = null;
        this.velocityBuffer = null;
        this.emittersBuffer = null;
        this.paramsBuffer = null;
        this.readbackBuffer = null;

        this.device = null;
        this.adapter = null;
        this.pipeline = null;
        this.bindGroup = null;
        this.scene = null;
        this.ready = false;
    }
}
