class SoundEngineProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this.targetRpm = 0;
        this.currentRpm = 0;
        this.phase = 0;
        this.bladeCount = 5;
        this.lastNoise = 0;
        this.port.onmessage = (e) => {
            if (e.data.type === 'SET_RPM') this.targetRpm = e.data.value;
            if (e.data.type === 'SET_BLADES') this.bladeCount = e.data.value;
        };
    }

    process(inputs, outputs) {
        const output = outputs[0][0];
        if (!output) return true;

        // Smooth RPM transition
        this.currentRpm = this.currentRpm * 0.99 + this.targetRpm * 0.01;
        const activeRpm = this.currentRpm;

        if (activeRpm > 0.05) {
            const baseFreq = (activeRpm / 60) * this.bladeCount;
            const delta = (2 * Math.PI * baseFreq) / sampleRate;
            const amplitude = Math.min(0.25, activeRpm / 200);
            const cavitationIntensity = activeRpm > 100 ? (activeRpm - 100) / 300 : 0.01;
            const filterAlpha = 0.2;

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
