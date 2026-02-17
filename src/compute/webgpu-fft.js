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

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function isPowerOfTwo(value) {
    return value > 0 && (value & (value - 1)) === 0;
}

export class WebGPUFFTProcessor {
    constructor(options = {}) {
        const requestedSize = options.fftSize ?? 1024;

        this.fftSize = isPowerOfTwo(requestedSize) ? requestedSize : 1024;
        this.smoothing = clamp(options.smoothing ?? 0.72, 0, 0.98); // Reduced default smoothing for better reactivity
        this.intensityReference = 0.12;

        this.backend = 'cpu';
        this.ready = false;

        this.adapter = null;
        this.device = null;
        this.pipeline = null;
        this.bindGroup = null;

        this.inputBuffer = null;
        this.outputBuffer = null;
        this.paramsBuffer = null;
        this.readbackBuffer = null;

        this._bufferLength = 0;
        this._spectrumCache = null;
        this._hannWindow = null;
        this._lastMode = 'frequency';
    }

    async init() {
        if (this.ready) return true;

        if (typeof navigator === 'undefined' || !navigator.gpu) {
            this.backend = 'cpu';
            return false;
        }

        try {
            this.adapter = await navigator.gpu.requestAdapter();
            if (!this.adapter) {
                this.backend = 'cpu';
                return false;
            }

            this.device = await this.adapter.requestDevice();
            this.backend = 'webgpu';
            this.ready = true;
            return true;
        } catch (error) {
            console.warn('WebGPU FFT initialization failed, using CPU fallback:', error);
            this.backend = 'cpu';
            this.ready = false;
            return false;
        }
    }

    getCapabilities() {
        return {
            backend: this.backend,
            ready: this.ready,
            fftSize: this.fftSize,
            mode: this._lastMode
        };
    }

    async computeLOFARSpectrum(frequencyData, options = {}) {
        const fftSize = options.fftSize && isPowerOfTwo(options.fftSize) ? options.fftSize : this.fftSize;
        const timeDomainData = options.timeDomainData;

        const useTimeDomain =
            timeDomainData instanceof Float32Array &&
            timeDomainData.length >= fftSize &&
            options.preferTimeDomain !== false;

        this._lastMode = useTimeDomain ? 'time-domain' : 'frequency';

        const input = useTimeDomain
            ? this._prepareTimeDomainInput(timeDomainData, fftSize)
            : this._prepareFrequencyInput(frequencyData, fftSize);

        if (this.backend === 'webgpu' && this.ready && this.device) {
            try {
                const gpuSpectrum = await this._computeOnGPU(input, {
                    mode: useTimeDomain ? 0 : 1,
                    fftSize
                });
                return this._postProcessSpectrum(gpuSpectrum);
            } catch (error) {
                console.warn('WebGPU FFT compute failed, switching to CPU fallback:', error);
                this.backend = 'cpu';
            }
        }

        const cpuSpectrum = useTimeDomain
            ? this._computeCpuFFT(input)
            : this._deriveCpuSpectrumFromFrequency(input);

        return this._postProcessSpectrum(cpuSpectrum);
    }

    _prepareTimeDomainInput(timeDomainData, fftSize) {
        const out = new Float32Array(fftSize);
        if (timeDomainData.length === fftSize) {
            out.set(timeDomainData);
        } else {
            out.set(timeDomainData.subarray(0, fftSize));
        }

        this._applyHannWindow(out);
        return out;
    }

    _applyHannWindow(input) {
        const n = input.length;
        if (!this._hannWindow || this._hannWindow.length !== n) {
            this._hannWindow = new Float32Array(n);
            for (let i = 0; i < n; i++) {
                this._hannWindow[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (n - 1)));
            }
        }

        for (let i = 0; i < n; i++) {
            input[i] *= this._hannWindow[i];
        }
    }

    _prepareFrequencyInput(frequencyData, fftSize) {
        const input = new Float32Array(fftSize);
        if (!(frequencyData instanceof Uint8Array)) {
            return input;
        }

        const srcLength = Math.min(frequencyData.length, fftSize);
        for (let i = 0; i < srcLength; i++) {
            input[i] = frequencyData[i] / 255;
        }
        return input;
    }

    async _computeOnGPU(input, options) {
        const fftSize = options.fftSize;
        const bins = fftSize >> 1;

        this._ensureGpuResources(fftSize);

        this.device.queue.writeBuffer(this.inputBuffer, 0, input);
        const params = new Float32Array([fftSize, options.mode, this.smoothing, 0]);
        this.device.queue.writeBuffer(this.paramsBuffer, 0, params);

        const encoder = this.device.createCommandEncoder({ label: 'lofar-fft-encoder' });
        const pass = encoder.beginComputePass({ label: 'lofar-fft-pass' });
        pass.setPipeline(this.pipeline);
        pass.setBindGroup(0, this.bindGroup);
        // Single workgroup for shared-memory FFT (supports up to 1024 points)
        pass.dispatchWorkgroups(1);
        pass.end();

        encoder.copyBufferToBuffer(this.outputBuffer, 0, this.readbackBuffer, 0, bins * 4);

        this.device.queue.submit([encoder.finish()]);

        // mapAsync handles synchronization with the GPU queue internally
        await this.readbackBuffer.mapAsync(GPU_MAP_MODE.READ);
        const copied = new Float32Array(this.readbackBuffer.getMappedRange()).slice();
        this.readbackBuffer.unmap();

        return copied;
    }

    _ensureGpuResources(fftSize) {
        if (this._bufferLength === fftSize && this.pipeline && this.bindGroup) return;

        // Cleanup existing resources if size changed
        if (this._bufferLength !== fftSize) {
            this.inputBuffer?.destroy();
            this.outputBuffer?.destroy();
            this.readbackBuffer?.destroy();
            this.paramsBuffer?.destroy();
        }

        const bins = fftSize >> 1;
        this._bufferLength = fftSize;

        const shaderModule = this.device.createShaderModule({
            label: 'lofar-fft-shader',
            code: `
struct Params {
    length : f32,
    mode : f32,
    smoothing : f32,
    pad : f32,
};

@group(0) @binding(0) var<storage, read> inputData : array<f32>;
@group(0) @binding(1) var<storage, read_write> outputData : array<f32>;
@group(0) @binding(2) var<uniform> params : Params;

var<workgroup> sharedReal : array<f32, 4096>;
var<workgroup> sharedImag : array<f32, 4096>;

fn bit_reverse(v: u32, bits: u32) -> u32 {
    return reverseBits(v) >> (32u - bits);
}

@compute @workgroup_size(256)
fn main(@builtin(local_invocation_id) lid : vec3<u32>) {
    let n = u32(params.length);
    let logN = u32(log2(params.length));

    // Mode 1: Pass-through magnitude (subsampling frequency data)
    if (u32(params.mode) == 1u) {
        // Simple parallel copy for bypass mode
        for (var i = lid.x; i < n / 2u; i += 256u) {
            outputData[i] = max(inputData[i * 2u], 0.0);
        }
        return;
    }

    // 1. Bit-reversed loading from Global to Shared Memory
    // Handle multiple elements per thread to support up to 2048 with 256 threads
    for (var i = lid.x; i < n; i += 256u) {
        sharedReal[i] = inputData[bit_reverse(i, logN)];
        sharedImag[i] = 0.0;
    }

    workgroupBarrier();

    // 2. Cooley-Tukey Iterative FFT
    for (var s = 1u; s <= logN; s = s + 1u) {
        let m = 1u << s;
        let m2 = m >> 1u;

        // Process butterflies in parallel
        // Each thread handles (n/2)/256 butterflies
        for (var butterflyIdx = lid.x; butterflyIdx < n / 2u; butterflyIdx += 256u) {
            let section = butterflyIdx / m2;
            let k = butterflyIdx % m2;
            let i = section * m + k;
            let j = i + m2;

            let angle = -2.0 * 3.14159265359 * f32(k) / f32(m);
            let wr = cos(angle);
            let wi = sin(angle);

            let tr = wr * sharedReal[j] - wi * sharedImag[j];
            let ti = wr * sharedImag[j] + wi * sharedReal[j];

            sharedReal[j] = sharedReal[i] - tr;
            sharedImag[j] = sharedImag[i] - ti;
            sharedReal[i] = sharedReal[i] + tr;
            sharedImag[i] = sharedImag[i] + ti;
        }

        workgroupBarrier();
    }

    // 3. Output Magnitude
    for (var i = lid.x; i < n / 2u; i += 256u) {
        let mag = sqrt(sharedReal[i] * sharedReal[i] + sharedImag[i] * sharedImag[i]) / f32(n);
        outputData[i] = mag;
    }
}
`
        });

        this.pipeline = this.device.createComputePipeline({
            label: 'lofar-fft-pipeline',
            layout: 'auto',
            compute: {
                module: shaderModule,
                entryPoint: 'main'
            }
        });

        this.inputBuffer = this.device.createBuffer({
            size: fftSize * 4,
            usage: GPU_BUFFER_USAGE.STORAGE | GPU_BUFFER_USAGE.COPY_DST
        });

        this.outputBuffer = this.device.createBuffer({
            size: bins * 4,
            usage: GPU_BUFFER_USAGE.STORAGE | GPU_BUFFER_USAGE.COPY_SRC
        });

        this.paramsBuffer = this.device.createBuffer({
            size: 16,
            usage: GPU_BUFFER_USAGE.UNIFORM | GPU_BUFFER_USAGE.COPY_DST
        });

        this.readbackBuffer = this.device.createBuffer({
            size: bins * 4,
            usage: GPU_BUFFER_USAGE.COPY_DST | GPU_BUFFER_USAGE.MAP_READ
        });

        this.bindGroup = this.device.createBindGroup({
            layout: this.pipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: this.inputBuffer } },
                { binding: 1, resource: { buffer: this.outputBuffer } },
                { binding: 2, resource: { buffer: this.paramsBuffer } }
            ]
        });
    }

    _computeCpuFFT(realInput) {
        const n = realInput.length;
        const real = new Float32Array(n);
        const imag = new Float32Array(n);
        real.set(realInput);

        const bits = Math.log2(n) | 0;

        for (let i = 0; i < n; i++) {
            const j = this._bitReverse(i, bits);
            if (j > i) {
                const tmpReal = real[i];
                real[i] = real[j];
                real[j] = tmpReal;
            }
        }

        for (let size = 2; size <= n; size <<= 1) {
            const half = size >> 1;
            const step = (Math.PI * 2) / size;

            for (let start = 0; start < n; start += size) {
                for (let k = 0; k < half; k++) {
                    const evenIndex = start + k;
                    const oddIndex = evenIndex + half;

                    const angle = -step * k;
                    const wr = Math.cos(angle);
                    const wi = Math.sin(angle);

                    const tr = wr * real[oddIndex] - wi * imag[oddIndex];
                    const ti = wr * imag[oddIndex] + wi * real[oddIndex];

                    real[oddIndex] = real[evenIndex] - tr;
                    imag[oddIndex] = imag[evenIndex] - ti;
                    real[evenIndex] += tr;
                    imag[evenIndex] += ti;
                }
            }
        }

        const bins = n >> 1;
        const output = new Float32Array(bins);

        for (let i = 0; i < bins; i++) {
            output[i] = Math.hypot(real[i], imag[i]) / n;
        }

        return output;
    }

    _deriveCpuSpectrumFromFrequency(input) {
        const bins = input.length >> 1;
        const output = new Float32Array(bins);

        for (let i = 0; i < bins; i++) {
            output[i] = input[i * 2] ?? 0;
        }

        return output;
    }

    _bitReverse(value, bits) {
        let reversed = 0;
        for (let i = 0; i < bits; i++) {
            reversed = (reversed << 1) | (value & 1);
            value >>= 1;
        }
        return reversed;
    }

    _postProcessSpectrum(spectrum) {
        const out = new Float32Array(spectrum.length);
        const LOG_SCALE_FACTOR = 100;
        const LOG_SCALE_NORMALIZER = Math.log1p(LOG_SCALE_FACTOR);
        const REFERENCE_DECAY = 0.92;
        const REFERENCE_FLOOR = 0.04;

        // Filter fewer low-frequency bins to preserve engine harmonics
        const DC_SKIP = 32;
        let framePeak = 0;

        for (let i = 0; i < spectrum.length; i++) {
            let val = spectrum[i];

            // Dampen first 16 bins using a parabolic ramp to suppress low-freq noise
            if (i < DC_SKIP) {
                const factor = Math.pow(i / DC_SKIP, 2);
                val *= factor;
            }

            const normalized =
                Math.log1p(Math.max(0, val) * LOG_SCALE_FACTOR) / LOG_SCALE_NORMALIZER;

            const clamped = Math.min(1.0, normalized);
            out[i] = clamped;

            if (i >= DC_SKIP) {
                framePeak = Math.max(framePeak, clamped);
            }
        }

        // Decaying peak reference prevents startup transients from flattening later frames.
        const decayedReference = Math.max(REFERENCE_FLOOR, this.intensityReference * REFERENCE_DECAY);
        this.intensityReference = Math.max(framePeak, decayedReference) * 0.125;

        for (let i = 0; i < out.length; i++) {
            out[i] = Math.min(1.0, out[i] / this.intensityReference);
        }

        if (!this._spectrumCache || this._spectrumCache.length !== out.length) {
            this._spectrumCache = new Float32Array(out.length);
        }

        for (let i = 0; i < out.length; i++) {
            this._spectrumCache[i] =
                this._spectrumCache[i] * this.smoothing + out[i] * (1 - this.smoothing);
        }

        return this._spectrumCache;
    }

    dispose() {
        this.inputBuffer?.destroy();
        this.outputBuffer?.destroy();
        this.paramsBuffer?.destroy();
        this.readbackBuffer?.destroy();

        this.inputBuffer = null;
        this.outputBuffer = null;
        this.paramsBuffer = null;
        this.readbackBuffer = null;
        this.bindGroup = null;
        this.pipeline = null;
        this.device = null;
        this.adapter = null;
        this.ready = false;
        this.backend = 'cpu';
        this.intensityReference = 0.12;
    }
}
