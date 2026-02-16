export class AudioSystem {
    constructor() {
        this.ctx = null;
        this.engineNode = null;
        this.engineGain = null;
        this.analyser = null;
        this.dataArray = null;
        this.targetNodes = new Map(); // Stores gain nodes for targets
    }

    async init() {
        if (this.ctx) return;

        try {
            this.ctx = new (window.AudioContext || window.webkitAudioContext)();

            const workletCode = `
                class SoundEngineProcessor extends AudioWorkletProcessor {
                    constructor() {
                        super();
                        this.targetRpm = 0;
                        this.currentRpm = 0;
                        this.phase = 0;
                        this.bladeCount = 5;
                        this.sampleRate = 48000;
                        this.lastNoise = 0;
                        this.port.onmessage = (e) => {
                            if (e.data.type === 'SET_RPM') this.targetRpm = e.data.value;
                        };
                    }
                    process(inputs, outputs) {
                        const output = outputs[0][0];
                        if (!output) return true;

                        // Smooth RPM transition - faster response (0.99 vs 0.9997)
                        this.currentRpm = this.currentRpm * 0.99 + this.targetRpm * 0.01;
                        const activeRpm = this.currentRpm;

                        if (activeRpm > 0.05) {
                             const baseFreq = (activeRpm / 60) * this.bladeCount;
                             const delta = (2 * Math.PI * baseFreq) / this.sampleRate;
                             // Pre-calculate amplitude outside loop for efficiency
                             const amplitude = Math.min(0.25, activeRpm / 200); // Higher max amplitude
                             const cavitationIntensity = activeRpm > 100 ? (activeRpm - 100) / 300 : 0.01;
                             const filterAlpha = 0.2; // Brighter noise

                            for (let i = 0; i < output.length; i++) {
                                this.phase = (this.phase + delta) % (2 * Math.PI);

                                // 1. Blade Thump - Richer harmonics
                                let harmonicSignal = Math.sin(this.phase) * 0.6; // Fundamental
                                harmonicSignal += Math.sin(this.phase * 2) * 0.25; // 2nd harmonic
                                harmonicSignal += Math.sin(this.phase * 3) * 0.15; // 3rd harmonic
                                harmonicSignal += Math.sin(this.phase * 0.5) * 0.05; // Sub-harmonic (shaft)

                                // Soft clipping shape for "thump"
                                const thump = Math.tanh(harmonicSignal * 1.5);

                                // 2. Cavitation Noise with Amplitude Modulation
                                // Noise pulses aligned with blade phase
                                const noiseRaw = (Math.random() * 2 - 1);
                                this.lastNoise = this.lastNoise + filterAlpha * (noiseRaw - this.lastNoise);

                                // AM: Noise is louder at peak of blade stroke
                                const bladeMod = (Math.sin(this.phase) + 1) * 0.5;
                                const noiseSignal = this.lastNoise * cavitationIntensity * (0.5 + 0.5 * bladeMod);

                                output[i] = (thump * amplitude * 0.6) + (noiseSignal * 0.8);
                            }
                        } else {
                            for (let i = 0; i < output.length; i++) output[i] = 0;
                            this.lastNoise = 0;
                        }
                        return true;
                    }
                }
                registerProcessor('sound-engine-processor', SoundEngineProcessor);
            `;

            const blob = new Blob([workletCode], { type: 'application/javascript' });
            await this.ctx.audioWorklet.addModule(URL.createObjectURL(blob));

            this.analyser = this.ctx.createAnalyser();
            this.analyser.fftSize = 2048;
            this.analyser.smoothingTimeConstant = 0.85;
            this.dataArray = new Uint8Array(this.analyser.frequencyBinCount);

            this.engineNode = new AudioWorkletNode(this.ctx, 'sound-engine-processor');
            this.engineGain = this.ctx.createGain();
            this.engineGain.gain.value = 0;

            this.engineNode.connect(this.engineGain).connect(this.analyser);
            this.analyser.connect(this.ctx.destination); // Optional monitor, usually disabled in sonar ops but useful for dev

            // Ramp up engine gain
            this.engineGain.gain.linearRampToValueAtTime(1.0, this.ctx.currentTime + 0.5);

        } catch (e) {
            console.error("Audio initialization failed:", e);
        }
    }

    setRpm(value) {
        if (this.engineNode) {
            this.engineNode.port.postMessage({ type: 'SET_RPM', value: value });
        }
    }

    createTargetAudio(target) {
        if (!this.ctx) return;
        const targetId = target.id;
        const type = target.type || 'SHIP';

        let targetOsc = null;
        let targetNoise = null;
        let targetFilter = this.ctx.createBiquadFilter();
        const gain = this.ctx.createGain();
        gain.gain.value = 0.01;

        if (type === 'BIOLOGICAL') {
            // Random clicks/chirps instead of steady sound
            this.createBioLoop(targetId, gain);
        } else if (type === 'STATIC') {
            // Just steady low rumble noise
            targetNoise = this.createNoiseSource(2.0);
            targetFilter.type = 'lowpass';
            targetFilter.frequency.value = 150;
            targetNoise.connect(targetFilter);
        } else {
            // SHIP or SUBMARINE
            targetOsc = this.ctx.createOscillator();
            targetOsc.type = type === 'SUBMARINE' ? 'sine' : 'triangle';

            // Base frequency based on RPM and blade count
            const baseFreq = (target.rpm / 60) * target.bladeCount;
            targetOsc.frequency.value = Math.max(20, baseFreq * 2); // 2x for audible fundamental range

            targetNoise = this.createNoiseSource(2.0);
            targetFilter.type = 'lowpass';
            targetFilter.frequency.value = type === 'SUBMARINE' ? 250 : 500;

            targetOsc.connect(targetFilter);
            targetNoise.connect(targetFilter);
            targetOsc.start();
        }

        if (targetNoise) targetNoise.start();
        targetFilter.connect(gain).connect(this.analyser);

        this.targetNodes.set(targetId, {
            osc: targetOsc,
            noise: targetNoise,
            gain: gain,
            type: type
        });
    }

    createNoiseSource(duration) {
        const bSize = this.ctx.sampleRate * duration;
        const buffer = this.ctx.createBuffer(1, bSize, this.ctx.sampleRate);
        const dArr = buffer.getChannelData(0);
        for(let i=0; i<bSize; i++) dArr[i] = Math.random() * 2 - 1;
        const noise = this.ctx.createBufferSource();
        noise.buffer = buffer;
        noise.loop = true;
        return noise;
    }

    createBioLoop(targetId, outputGain) {
        const playClick = () => {
            if (!this.targetNodes.has(targetId)) return;

            const osc = this.ctx.createOscillator();
            const g = this.ctx.createGain();
            osc.connect(g).connect(outputGain);

            const freq = 800 + Math.random() * 2000;
            osc.frequency.setValueAtTime(freq, this.ctx.currentTime);
            osc.frequency.exponentialRampToValueAtTime(100, this.ctx.currentTime + 0.1);

            g.gain.setValueAtTime(0, this.ctx.currentTime);
            g.gain.linearRampToValueAtTime(0.5, this.ctx.currentTime + 0.01);
            g.gain.linearRampToValueAtTime(0, this.ctx.currentTime + 0.1);

            osc.start();
            osc.stop(this.ctx.currentTime + 0.15);

            // Schedule next click
            setTimeout(playClick, 500 + Math.random() * 3000);
        };
        playClick();
    }

    updateTargetVolume(targetId, distance) {
        const node = this.targetNodes.get(targetId);
        if (node && this.ctx) {
            const vol = Math.max(0.005, (100 - distance) / 400) * 0.3;
            node.gain.gain.setTargetAtTime(vol, this.ctx.currentTime, 0.1);
        }
    }

    createPingTap(vol = 0.5, startFreq = 1200, endFreq = 900) {
        if (!this.ctx) return;
        const time = this.ctx.currentTime;

        const osc = this.ctx.createOscillator();
        const g = this.ctx.createGain();

        osc.connect(g).connect(this.analyser);

        osc.frequency.setValueAtTime(startFreq, time);
        osc.frequency.exponentialRampToValueAtTime(endFreq, time + 0.1);

        g.gain.setValueAtTime(0, time);
        g.gain.linearRampToValueAtTime(vol, time + 0.02);
        g.gain.linearRampToValueAtTime(0, time + 1.2);

        osc.start(time);
        osc.stop(time + 1.3);
    }

    getFrequencyData() {
        if (this.analyser && this.dataArray) {
            this.analyser.getByteFrequencyData(this.dataArray);
            return this.dataArray;
        }
        return new Uint8Array(0);
    }

    getContext() {
        return this.ctx;
    }
}
