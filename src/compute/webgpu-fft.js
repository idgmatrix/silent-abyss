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
        this.smoothing = clamp(options.smoothing ?? 0.82, 0, 0.98);

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
        if (timeDomainData.length === fftSize) return timeDomainData;
        const out = new Float32Array(fftSize);
        out.set(timeDomainData.subarray(0, fftSize));
        return out;
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
        pass.dispatchWorkgroups(Math.ceil(bins / 64));
        pass.end();

        encoder.copyBufferToBuffer(this.outputBuffer, 0, this.readbackBuffer, 0, bins * 4);

        this.device.queue.submit([encoder.finish()]);
        await this.device.queue.onSubmittedWorkDone();

        await this.readbackBuffer.mapAsync(GPU_MAP_MODE.READ);
        const copied = new Float32Array(this.readbackBuffer.getMappedRange()).slice();
        this.readbackBuffer.unmap();

        return copied;
    }

    _ensureGpuResources(fftSize) {
        if (this._bufferLength === fftSize && this.pipeline && this.bindGroup) return;

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

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
    let idx = gid.x;
    let n = u32(params.length);
    let bins = n / 2u;

    if (idx >= bins) {
        return;
    }

    var value = 0.0;

    if (u32(params.mode) == 0u) {
        var real = 0.0;
        var imag = 0.0;
        let k = f32(idx);
        let len = f32(n);

        for (var sampleIndex = 0u; sampleIndex < n; sampleIndex = sampleIndex + 1u) {
            let phase = -2.0 * 3.14159265359 * k * f32(sampleIndex) / len;
            let sample = inputData[sampleIndex];
            real = real + sample * cos(phase);
            imag = imag + sample * sin(phase);
        }

        value = sqrt(real * real + imag * imag) / len;
    } else {
        let sourceIndex = min(idx * 2u, n - 1u);
        value = max(inputData[sourceIndex], 0.0);
    }

    outputData[idx] = value;
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

        let maxValue = 0;
        for (let i = 0; i < spectrum.length; i++) {
            const normalized = Math.log1p(Math.max(0, spectrum[i]) * 24) / Math.log(25);
            maxValue = Math.max(maxValue, normalized);
            out[i] = normalized;
        }

        if (maxValue > 0) {
            for (let i = 0; i < out.length; i++) {
                out[i] /= maxValue;
            }
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
    }
}
