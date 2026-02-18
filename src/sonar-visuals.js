import { ScrollingDisplay } from './scrolling-display.js';
import { TrackState } from './simulation.js';

export const BTR_THEMES = {
    'CYAN': {
        SUBMARINE: [0, 255, 255],
        BIOLOGICAL: [0, 255, 0],
        STATIC: [128, 128, 128],
        SHIP: [0, 255, 128],
        TORPEDO: [255, 0, 0],
        SELF: [0, 100, 150],
        BACKGROUND: [0, 20, 20],
        PING: [200, 255, 255],
        WATERFALL: {
            low: [0, 0, 0],
            mid: [0, 150, 255],
            high: [200, 255, 255]
        }
    },
    'PHOSPHOR': {
        SUBMARINE: [0, 255, 68],
        BIOLOGICAL: [100, 255, 100],
        STATIC: [0, 100, 20],
        SHIP: [0, 200, 50],
        TORPEDO: [200, 255, 0],
        SELF: [0, 150, 40],
        BACKGROUND: [0, 30, 5],
        PING: [150, 255, 150],
        WATERFALL: {
            low: [0, 10, 0],
            mid: [0, 200, 50],
            high: [200, 255, 100]
        }
    },
    'AMBER': {
        SUBMARINE: [255, 176, 0],
        BIOLOGICAL: [200, 100, 0],
        STATIC: [100, 50, 0],
        SHIP: [255, 120, 0],
        TORPEDO: [255, 50, 0],
        SELF: [150, 80, 0],
        BACKGROUND: [30, 15, 0],
        PING: [255, 220, 100],
        WATERFALL: {
            low: [20, 5, 0],
            mid: [255, 120, 0],
            high: [255, 255, 150]
        }
    },
    'THERMAL': {
        SUBMARINE: [255, 255, 255],
        BIOLOGICAL: [255, 200, 0],
        STATIC: [100, 100, 255],
        SHIP: [255, 100, 0],
        TORPEDO: [255, 0, 0],
        SELF: [50, 50, 200],
        BACKGROUND: [0, 0, 50],
        PING: [255, 255, 255],
        WATERFALL: {
            low: [0, 0, 50],
            mid: [255, 0, 0],
            high: [255, 255, 255]
        }
    }
};

export class SonarVisuals {
    constructor(options = {}) {
        this.lCanvas = null;
        this.dCanvas = null;
        this.lCtx = null;
        this.dCtx = null;

        this.btrDisplay = null;
        this.waterfallDisplay = null;

        this.lastTargets = [];
        this.currentTheme = 'CYAN';
        this.currentWaterfallTheme = 'CYAN';

        this.fftProcessor = options.fftProcessor || null;
        this.lofarSpectrum = null;
        this._lofarPending = null;
        this._lofarFrameCounter = 0;
        this._demonSpectrum = null;
        this._demonEnhancedSpectrum = null;
        this._demonSmoothedSpectrum = null;
        this._demonPeaksHz = [];
        this._demonHarmonicScore = 0;
        this._demonDisplayHarmonicScore = 0;
        this._demonFrameCounter = 0;
        this._demonSampleBuffer = new Float32Array(32768);
        this._demonSampleWriteIndex = 0;
        this._demonSampleCount = 0;

        this.lineHistory = [];
        this.maxLineHistory = 15;
    }

    init() {
        if (this.lCanvas) return; // Already initialized

        this.lCanvas = document.getElementById('lofar-canvas');
        this.dCanvas = document.getElementById('demon-canvas');

        if (this.lCanvas) this.lCtx = this.lCanvas.getContext('2d');
        if (this.dCanvas) this.dCtx = this.dCanvas.getContext('2d');

        this.btrDisplay = new ScrollingDisplay('btr-canvas');
        this.btrDisplay.setDecayRate(0.0015); // Slower decay to preserve deeper BTR history

        this.waterfallDisplay = new ScrollingDisplay('waterfall-canvas');
        this.waterfallDisplay.setDecayRate(0.0008); // Slower decay to preserve broadband waterfall history

        this._btrClickHandler = (e) => this.handleBTRClick(e);

        if (this.btrDisplay.canvas) {
            this.btrDisplay.canvas.style.cursor = 'crosshair';
            this.btrDisplay.canvas.addEventListener('click', this._btrClickHandler);
        }

        this._resizeHandler = () => this.resize();
        this.resize();
        window.addEventListener('resize', this._resizeHandler);
    }

    resize() {
        const dpr = window.devicePixelRatio || 1;

        [this.lCanvas, this.dCanvas].forEach(cvs => {
            if (cvs) {
                const rect = cvs.parentElement.getBoundingClientRect();
                cvs.width = rect.width * dpr;
                cvs.height = rect.height * dpr;
                // No need to set CSS width/height if they are already 100% in CSS
            }
        });

        if (this.btrDisplay) this.btrDisplay.resize();
        if (this.waterfallDisplay) this.waterfallDisplay.resize();
    }

    handleBTRClick(e) {
        if (!this.btrDisplay || !this.btrDisplay.canvas) return;
        const rect = this.btrDisplay.canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const clickedBearing = (x / rect.width) * 360;

        // Find closest target by bearing
        let closestTarget = null;
        let minDiff = 15; // 15 degrees tolerance

        this.lastTargets.forEach(t => {
            if (t.state !== TrackState.TRACKED) return;

            let diff = Math.abs(t.bearing - clickedBearing);
            if (diff > 180) diff = 360 - diff;

            if (diff < minDiff) {
                minDiff = diff;
                closestTarget = t;
            }
        });

        if (closestTarget) {
            document.getElementById('tactical-viewport').dispatchEvent(
                new CustomEvent('targetSelected', { detail: { id: closestTarget.id } })
            );
        } else {
            document.getElementById('tactical-viewport').dispatchEvent(
                new CustomEvent('targetSelected', { detail: { id: null } })
            );
        }
    }

    setFFTProcessor(processor) {
        this.fftProcessor = processor || null;
    }

    draw(dataArray, targets, currentRpm, pingIntensity, sampleRate, fftSize, selectedTarget = null, timeDomainData = null) {
        if (!dataArray) return;
        this.lastTargets = targets;
        this._updateLofarSpectrum(dataArray, timeDomainData, fftSize);
        this._updateDemonSpectrum(timeDomainData, sampleRate);
        this.drawLOFAR(dataArray, currentRpm, sampleRate, fftSize, selectedTarget);
        this.drawDEMON(dataArray, currentRpm, selectedTarget, sampleRate);
        this.drawBTR(targets, currentRpm, pingIntensity);
        this.drawWaterfall(dataArray);
    }

    drawLOFAR(dataArray, currentRpm, sampleRate, fftSize, selectedTarget) {
        if (!this.lCtx || !this.lCanvas) return;
        const ctx = this.lCtx;
        const cvs = this.lCanvas;
        const source = this.lofarSpectrum || dataArray;
        const sourceIsFloat = source instanceof Float32Array;

        ctx.fillStyle = 'rgba(0, 5, 10, 0.9)';
        ctx.fillRect(0, 0, cvs.width, cvs.height);

        // Grid lines
        ctx.strokeStyle = selectedTarget ? 'rgba(255, 0, 0, 0.1)' : 'rgba(0, 255, 204, 0.05)';
        ctx.beginPath();
        for(let i=1; i<10; i++) {
            ctx.moveTo(i * cvs.width/10, 0);
            ctx.lineTo(i * cvs.width/10, cvs.height);
        }
        ctx.stroke();

        ctx.beginPath();
        ctx.strokeStyle = selectedTarget ? '#ff3333' : '#00ffcc';
        ctx.lineWidth = 1.2;
        const viewLength = source.length * 0.7; // Limit high frequency view
        for(let i=0; i<viewLength; i++) {
            const x = (i / viewLength) * cvs.width;
            const sampleValue = source[i] ?? 0;
            const normalized = sourceIsFloat ? sampleValue : sampleValue / 255;
            const h = normalized * (cvs.height * 1.0);
            if(i===0) ctx.moveTo(x, cvs.height - h);
            else ctx.lineTo(x, cvs.height - h);
        }
        ctx.stroke();

        // Labeling peak harmonics if RPM > 0
        if (currentRpm > 50) {
            const baseFreqIdx = Math.floor(((currentRpm / 60) * 5) / (sampleRate / fftSize));
            if (baseFreqIdx < viewLength) {
                const x = (baseFreqIdx / viewLength) * cvs.width;
                ctx.fillStyle = 'rgba(0, 255, 204, 0.5)';
                ctx.fillText("RPM PEAK", x + 2, cvs.height - 10);
            }
        }

        // Draw classification lines
        this._processAndDrawLines(ctx, cvs, source, viewLength);
    }

    _processAndDrawLines(ctx, cvs, source, viewLength) {
        const threshold = 0.2;
        const currentPeaks = [];

        for (let i = 4; i < viewLength - 1; i++) {
            if (source[i] > threshold && source[i] > source[i-1] && source[i] > source[i+1]) {
                currentPeaks.push(i);
            }
        }

        this.lineHistory.push(currentPeaks);
        if (this.lineHistory.length > this.maxLineHistory) this.lineHistory.shift();

        // Calculate persistence (how many times a bin was a peak in history)
        const persistence = new Float32Array(viewLength);
        this.lineHistory.forEach(frame => {
            frame.forEach(idx => {
                if (idx < viewLength) persistence[idx] += 1.0 / this.maxLineHistory;
            });
        });

        // Draw stable lines
        ctx.save();
        for (let i = 0; i < viewLength; i++) {
            if (persistence[i] > 0.4) {
                const x = (i / viewLength) * cvs.width;
                const alpha = (persistence[i] - 0.4) * 1.5;
                ctx.strokeStyle = `rgba(255, 255, 255, ${alpha})`;
                ctx.setLineDash([2, 4]);
                ctx.beginPath();
                ctx.moveTo(x, 0);
                ctx.lineTo(x, cvs.height);
                ctx.stroke();
            }
        }
        ctx.restore();
    }

    _updateLofarSpectrum(dataArray, timeDomainData, fftSize) {
        if (!this.fftProcessor || this._lofarPending) return;
        if (!dataArray || dataArray.length === 0) return;

        // Run compute every other frame to reduce contention with rendering.
        this._lofarFrameCounter++;
        if (this._lofarFrameCounter % 2 !== 0) return;

        this._lofarPending = this.fftProcessor.computeLOFARSpectrum(dataArray, {
            fftSize,
            timeDomainData
        })
            .then((spectrum) => {
                if (spectrum && spectrum.length > 0) {
                    this.lofarSpectrum = new Float32Array(spectrum);
                }
            })
            .catch((error) => {
                console.warn('LOFAR compute failed, using analyser bins:', error);
            })
            .finally(() => {
                this._lofarPending = null;
            });
    }

    _updateDemonSpectrum(timeDomainData, sampleRate) {
        if (!(timeDomainData instanceof Float32Array)) return;
        if (!sampleRate || sampleRate <= 0) return;

        this._pushDemonSamples(timeDomainData);

        // Update less frequently to keep render cost stable.
        this._demonFrameCounter++;
        if (this._demonFrameCounter % 3 !== 0) return;

        const analysisWindow = this._getDemonAnalysisWindow();
        if (!analysisWindow) return;

        const rawSpectrum = this._computeDemonSpectrum(analysisWindow, sampleRate, 120);
        this._demonSpectrum = rawSpectrum;
        this._demonEnhancedSpectrum = this._enhanceDemonSpectrum(rawSpectrum);
        this._demonSmoothedSpectrum = this._smoothDemonSpectrum(this._demonEnhancedSpectrum);
        this._demonPeaksHz = this._detectDemonPeaks(this._demonSmoothedSpectrum, 6);
    }

    _pushDemonSamples(samples) {
        if (!(samples instanceof Float32Array)) return;

        for (let i = 0; i < samples.length; i++) {
            this._demonSampleBuffer[this._demonSampleWriteIndex] = samples[i];
            this._demonSampleWriteIndex =
                (this._demonSampleWriteIndex + 1) % this._demonSampleBuffer.length;
        }

        this._demonSampleCount = Math.min(
            this._demonSampleBuffer.length,
            this._demonSampleCount + samples.length
        );
    }

    _getDemonAnalysisWindow() {
        const targetLength = this._demonSampleCount >= 16384 ? 16384 : 8192;
        if (this._demonSampleCount < targetLength) return null;

        const out = new Float32Array(targetLength);
        const startIndex =
            (this._demonSampleWriteIndex - targetLength + this._demonSampleBuffer.length) %
            this._demonSampleBuffer.length;

        const firstChunk = Math.min(
            targetLength,
            this._demonSampleBuffer.length - startIndex
        );
        out.set(this._demonSampleBuffer.subarray(startIndex, startIndex + firstChunk), 0);
        if (firstChunk < targetLength) {
            out.set(
                this._demonSampleBuffer.subarray(0, targetLength - firstChunk),
                firstChunk
            );
        }

        return out;
    }

    _computeDemonSpectrum(timeDomainData, sampleRate, maxFreqHz) {
        const n = Math.min(timeDomainData.length, 4096);
        const spectrum = new Float32Array(maxFreqHz + 1);
        if (n < 64) return spectrum;

        // Approximate DEMON chain:
        // 1) band-limit the raw signal to machinery band
        // 2) full-wave rectify to get envelope
        // 3) remove slow DC drift from envelope
        const signal = new Float32Array(n);
        let meanRaw = 0;
        for (let i = 0; i < n; i++) meanRaw += timeDomainData[i];
        meanRaw /= n;

        const hpCutHz = 20;
        const lpCutHz = 1800;
        const hpRc = 1 / (2 * Math.PI * hpCutHz);
        const lpRc = 1 / (2 * Math.PI * lpCutHz);
        const dt = 1 / sampleRate;
        const hpAlpha = hpRc / (hpRc + dt);
        const lpAlpha = dt / (lpRc + dt);

        let hpY = 0;
        let hpPrevX = 0;
        let lpY = 0;

        const envelope = new Float32Array(n);
        for (let i = 0; i < n; i++) {
            const x = timeDomainData[i] - meanRaw;
            hpY = hpAlpha * (hpY + x - hpPrevX);
            hpPrevX = x;
            lpY += lpAlpha * (hpY - lpY);
            envelope[i] = Math.abs(lpY);
        }

        // Remove very low-frequency drift from envelope.
        const envHpCutHz = 1.0;
        const envHpRc = 1 / (2 * Math.PI * envHpCutHz);
        const envHpAlpha = envHpRc / (envHpRc + dt);
        let envHpY = 0;
        let envHpPrevX = envelope[0] || 0;
        for (let i = 0; i < n; i++) {
            const x = envelope[i];
            envHpY = envHpAlpha * (envHpY + x - envHpPrevX);
            envHpPrevX = x;
            signal[i] = envHpY;
        }

        const hannDenom = Math.max(1, n - 1);
        for (let f = 1; f <= maxFreqHz; f++) {
            const omega = (2 * Math.PI * f) / sampleRate;
            let re = 0;
            let im = 0;

            for (let i = 0; i < n; i++) {
                const hann = 0.5 * (1 - Math.cos((2 * Math.PI * i) / hannDenom));
                const v = signal[i] * hann;
                const phase = omega * i;
                re += v * Math.cos(phase);
                im -= v * Math.sin(phase);
            }

            spectrum[f] = Math.hypot(re, im) / n;
        }

        return spectrum;
    }

    _enhanceDemonSpectrum(spectrum) {
        if (!(spectrum instanceof Float32Array) || spectrum.length < 4) {
            return new Float32Array(0);
        }

        const out = new Float32Array(spectrum.length);
        const radius = 3;
        let peak = 1e-6;

        for (let i = 1; i < spectrum.length; i++) {
            let sum = 0;
            let count = 0;
            const start = Math.max(1, i - radius);
            const end = Math.min(spectrum.length - 1, i + radius);
            for (let j = start; j <= end; j++) {
                if (j === i) continue;
                sum += spectrum[j];
                count++;
            }
            const localNoise = count > 0 ? sum / count : 0;
            const whitened = Math.max(0, spectrum[i] - localNoise * 0.92);
            out[i] = whitened;
            if (whitened > peak) peak = whitened;
        }

        if (peak <= 1e-6) return out;
        for (let i = 1; i < out.length; i++) {
            out[i] /= peak;
        }

        return out;
    }

    _smoothDemonSpectrum(spectrum) {
        if (!(spectrum instanceof Float32Array) || spectrum.length === 0) {
            return new Float32Array(0);
        }

        if (
            !(this._demonSmoothedSpectrum instanceof Float32Array) ||
            this._demonSmoothedSpectrum.length !== spectrum.length
        ) {
            this._demonSmoothedSpectrum = new Float32Array(spectrum.length);
        }

        for (let i = 1; i < spectrum.length; i++) {
            const prev = this._demonSmoothedSpectrum[i];
            const curr = spectrum[i];
            const alpha = curr >= prev ? 0.2 : 0.08;
            this._demonSmoothedSpectrum[i] = prev + (curr - prev) * alpha;
        }

        return this._demonSmoothedSpectrum;
    }

    _detectDemonPeaks(enhancedSpectrum, maxPeaks = 6) {
        if (!(enhancedSpectrum instanceof Float32Array) || enhancedSpectrum.length < 4) return [];

        const peaks = [];
        for (let hz = 2; hz < enhancedSpectrum.length - 1; hz++) {
            const v = enhancedSpectrum[hz];
            if (v < 0.18) continue;
            if (v > enhancedSpectrum[hz - 1] && v >= enhancedSpectrum[hz + 1]) {
                peaks.push({ hz, value: v });
            }
        }

        peaks.sort((a, b) => b.value - a.value);
        return peaks.slice(0, maxPeaks).map((p) => p.hz).sort((a, b) => a - b);
    }

    drawDEMON(dataArray, currentRpm, selectedTarget, sampleRate) {
        if (!this.dCtx || !this.dCanvas) return;
        const ctx = this.dCtx;
        const cvs = this.dCanvas;
        const maxFreqHz = 120;

        ctx.fillStyle = 'rgba(0, 5, 10, 0.8)';
        ctx.fillRect(0, 0, cvs.width, cvs.height);

        // Background frequency grid.
        ctx.strokeStyle = 'rgba(0, 255, 255, 0.08)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let hz = 10; hz <= maxFreqHz; hz += 10) {
            const x = (hz / maxFreqHz) * cvs.width;
            ctx.moveTo(x, 0);
            ctx.lineTo(x, cvs.height);
        }
        ctx.stroke();

        // DEMON spectrum trace (envelope spectrum in low-frequency band).
        const enhancedSpectrum = this._demonSmoothedSpectrum;
        if (enhancedSpectrum && enhancedSpectrum.length > 2) {
            let peak = 1e-6;
            for (let i = 1; i < enhancedSpectrum.length; i++) {
                if (enhancedSpectrum[i] > peak) peak = enhancedSpectrum[i];
            }

            ctx.beginPath();
            ctx.strokeStyle = selectedTarget ? '#ff3333' : '#ffaa00';
            ctx.lineWidth = 1.5;

            for (let hz = 1; hz <= maxFreqHz; hz++) {
                const x = (hz / maxFreqHz) * cvs.width;
                const norm = Math.log1p((enhancedSpectrum[hz] / peak) * 50) / Math.log1p(50);
                const y = cvs.height - norm * cvs.height * 0.75;
                if (hz === 1) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            }
            ctx.stroke();

            // Draw detected narrowband peaks.
            ctx.strokeStyle = 'rgba(0, 255, 255, 0.9)';
            ctx.lineWidth = 1;
            for (const hz of this._demonPeaksHz) {
                const x = (hz / maxFreqHz) * cvs.width;
                ctx.beginPath();
                ctx.moveTo(x, cvs.height);
                ctx.lineTo(x, cvs.height * 0.18);
                ctx.stroke();
            }
        } else {
            // Fallback when time-domain data isn't available.
            ctx.strokeStyle = 'rgba(255, 170, 0, 0.6)';
            ctx.lineWidth = 2;
            const bins = Math.min(12, dataArray.length);
            for (let i = 1; i < bins; i++) {
                const x = (i / bins) * cvs.width;
                const val = dataArray[i] / 255;
                const y = cvs.height - val * cvs.height * 0.55;
                ctx.beginPath();
                ctx.moveTo(x, cvs.height);
                ctx.lineTo(x, y);
                ctx.stroke();
            }
        }

        // Blade-rate harmonic markers.
        const selectedBladeCount = Number.isFinite(selectedTarget?.bladeCount)
            ? Math.max(1, Math.floor(selectedTarget.bladeCount))
            : null;
        const bladeCountForMarkers = selectedBladeCount ?? 5;
        const rpmForMarkers = selectedTarget?.rpm ?? currentRpm;
        const bpfHz = rpmForMarkers > 0 ? (rpmForMarkers / 60) * bladeCountForMarkers : 0;
        this._demonHarmonicScore = 0;
        if (bpfHz > 0 && Number.isFinite(bpfHz)) {
            ctx.save();
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
            ctx.setLineDash([3, 3]);
            let harmonicHits = 0;
            let harmonicCount = 0;
            for (let k = 1; k <= 8; k++) {
                const f = bpfHz * k;
                if (f > maxFreqHz) break;
                harmonicCount++;
                const x = (f / maxFreqHz) * cvs.width;
                ctx.beginPath();
                ctx.moveTo(x, 0);
                ctx.lineTo(x, cvs.height);
                ctx.stroke();

                const nearestHz = Math.round(f);
                if (
                    enhancedSpectrum &&
                    nearestHz > 1 &&
                    nearestHz < enhancedSpectrum.length &&
                    enhancedSpectrum[nearestHz] > 0.16
                ) {
                    harmonicHits++;
                }
            }
            ctx.restore();
            this._demonHarmonicScore =
                harmonicCount > 0 ? harmonicHits / harmonicCount : 0;
        }
        this._demonDisplayHarmonicScore +=
            (this._demonHarmonicScore - this._demonDisplayHarmonicScore) * 0.12;

        ctx.fillStyle = selectedTarget ? '#ff3333' : '#00ffff';
        ctx.font = '9px Arial';
        const label = selectedTarget ? `TARGET ANALYSIS: ${selectedTarget.type} (T${selectedTarget.id.split('-')[1]})` : `AUTO-ANALYSIS: ${currentRpm > 0 ? 'ENGINE ACTIVE' : 'IDLE'}`;
        ctx.fillText(label, 10, 15);

        ctx.fillStyle = '#ffffff';
        ctx.font = '10px monospace';
        ctx.fillText(`BLADE COUNT: ${selectedBladeCount ?? '--'}`, 10, 30);
        if (bpfHz > 0) {
            ctx.fillText(`BPF: ${bpfHz.toFixed(1)} Hz`, 10, 44);
        }
        if (sampleRate > 0) {
            ctx.fillText(`BAND: 1-${maxFreqHz} Hz`, 10, 58);
        }
        ctx.fillText(
            `HARMONIC MATCH: ${(this._demonDisplayHarmonicScore * 100).toFixed(0)}%`,
            10,
            72
        );

        if (selectedTarget && selectedTarget.classification) {
            const cls = selectedTarget.classification;
            ctx.fillStyle = '#ffffff';
            ctx.font = '10px monospace';
            ctx.fillText(`STATUS: ${cls.state}`, 10, 86);

            // Progress bar
            ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
            ctx.fillRect(10, 91, 100, 4);
            ctx.fillStyle = cls.confirmed ? '#00ff00' : '#ffffff';
            ctx.fillRect(10, 91, cls.progress * 100, 4);

            if (cls.identifiedClass) {
                ctx.fillText(`CLASS: ${cls.identifiedClass.toUpperCase()}`, 10, 106);
            }
        }
    }

    setTheme(themeName) {
        if (BTR_THEMES[themeName]) {
            this.currentTheme = themeName;
        }
    }

    setWaterfallTheme(themeName) {
        if (BTR_THEMES[themeName]) {
            this.currentWaterfallTheme = themeName;
        }
    }

    drawBTR(targets, currentRpm, pingIntensity) {
        if (!this.btrDisplay) return;

        const theme = BTR_THEMES[this.currentTheme];

        this.btrDisplay.drawNextLine((ctx, width) => {
            // Background with faint sea-noise speckle
            ctx.fillStyle = '#000000';
            ctx.fillRect(0, 0, width, 1);

            // Speckle noise
            for (let i = 0; i < width; i += 4) {
                if (Math.random() > 0.95) {
                    const noiseVal = Math.random() * 0.15;
                    ctx.fillStyle = `rgba(${theme.BACKGROUND[0]}, ${theme.BACKGROUND[1]}, ${theme.BACKGROUND[2]}, ${noiseVal})`;
                    ctx.fillRect(i, 0, 2, 1);
                }
            }

            // Targets
            targets.forEach(target => {
                if (target.state !== TrackState.TRACKED && pingIntensity <= 0) return;

                // Add small bearing jitter based on SNR
                const jitter = (Math.random() - 0.5) * (5.0 / (target.snr + 0.1));
                const targetX = ((target.bearing + jitter) / 360) * width;

                let targetIntensity = Math.min(1.0, (target.snr * 40) / 255);

                // Boost intensity if target is tracked
                if (target.state === TrackState.TRACKED) {
                    targetIntensity = Math.max(targetIntensity, 0.4);
                }

                let baseColor = theme[target.type] || theme.SHIP;

                // Implement Smearing (Horizontal Gradient)
                const grad = ctx.createLinearGradient(targetX - 4, 0, targetX + 4, 0);
                grad.addColorStop(0, 'rgba(0,0,0,0)');
                grad.addColorStop(0.5, `rgba(${baseColor[0]}, ${baseColor[1]}, ${baseColor[2]}, ${targetIntensity})`);
                grad.addColorStop(1, 'rgba(0,0,0,0)');

                ctx.fillStyle = grad;
                ctx.fillRect(targetX - 5, 0, 10, 1);
            });

            // Self Noise
            const selfNoiseIntensity = (currentRpm / 400);
            if (selfNoiseIntensity > 0.02) {
                const centerBearing = 180;
                const spread = 40 + (currentRpm / 10);
                const selfX = (centerBearing / 360) * width;
                const selfW = (spread / 360) * width;

                const grad = ctx.createLinearGradient(selfX - selfW/2, 0, selfX + selfW/2, 0);
                grad.addColorStop(0, 'rgba(0,0,0,0)');
                grad.addColorStop(0.5, `rgba(${theme.SELF[0]}, ${theme.SELF[1]}, ${theme.SELF[2]}, ${selfNoiseIntensity * 0.5})`);
                grad.addColorStop(1, 'rgba(0,0,0,0)');

                ctx.fillStyle = grad;
                ctx.fillRect(selfX - selfW/2, 0, selfW, 1);

                // Wide background noise from self engines
                ctx.fillStyle = `rgba(${theme.SELF[0]}, ${theme.SELF[1]}, ${theme.SELF[2]}, ${selfNoiseIntensity * 0.05})`;
                ctx.fillRect(0, 0, width, 1);
            }

            // Ping Mask
            if (pingIntensity > 0) {
                ctx.fillStyle = `rgba(${theme.PING[0]}, ${theme.PING[1]}, ${theme.PING[2]}, ${pingIntensity * 0.6})`;
                ctx.fillRect(0, 0, width, 1);
            }
        });
    }

    drawWaterfall(dataArray) {
        if (!this.waterfallDisplay || !this.waterfallDisplay.ctx) return;

        const theme = BTR_THEMES[this.currentWaterfallTheme].WATERFALL;
        const source = this.lofarSpectrum || dataArray;
        const sourceIsFloat = source instanceof Float32Array;

        this.waterfallDisplay.drawNextLine((ctx, width) => {
            const totalSamples = Math.floor(source.length * 0.8);
            const imageData = ctx.createImageData(width, 1);
            const data = imageData.data;
            const NOISE_FLOOR = 0.004;
            const DISPLAY_GAIN = 2.0;
            const LOG_NORMALIZER = Math.log1p(40);

            // Cache colors to avoid overhead in loop
            const low = theme.low;
            const mid = theme.mid;
            const high = theme.high;

            for (let x = 0; x < width; x++) {
                const sampleIdx = Math.floor((x / width) * totalSamples);
                const val = source[sampleIdx] ?? 0;
                const norm = sourceIsFloat ? val : val / 255;
                const i = x * 4;
                const lifted = Math.max(0, norm - NOISE_FLOOR);
                const boosted =
                    Math.log1p(Math.max(0, lifted) * DISPLAY_GAIN * 40) / LOG_NORMALIZER;
                const dimFloor = norm > 0 ? Math.min(0.12, Math.sqrt(norm) * 0.08) : 0;
                const level = Math.max(dimFloor, Math.min(1.0, boosted));

                let r = 0;
                let g = 0;
                let b = 0;

                if (level < 0.5) {
                    const t = level * 2;
                    r = low[0] * (1 - t) + mid[0] * t;
                    g = low[1] * (1 - t) + mid[1] * t;
                    b = low[2] * (1 - t) + mid[2] * t;
                } else {
                    const t = Math.min(1.0, (level - 0.5) * 2);
                    r = mid[0] * (1 - t) + high[0] * t;
                    g = mid[1] * (1 - t) + high[1] * t;
                    b = mid[2] * (1 - t) + high[2] * t;
                }

                data[i] = r | 0;
                data[i + 1] = g | 0;
                data[i + 2] = b | 0;
                data[i + 3] = 255;
            }

            ctx.putImageData(imageData, 0, 0);
        });
    }

    dispose() {
        if (this._resizeHandler) {
            window.removeEventListener('resize', this._resizeHandler);
        }
        if (this.btrDisplay) {
            if (this.btrDisplay.canvas && this._btrClickHandler) {
                this.btrDisplay.canvas.removeEventListener('click', this._btrClickHandler);
            }
            this.btrDisplay.dispose();
        }
        if (this.waterfallDisplay) {
            this.waterfallDisplay.dispose();
        }
        this.btrDisplay = null;
        this.waterfallDisplay = null;
        this.lCtx = null;
        this.dCtx = null;
        this.lCanvas = null;
        this.dCanvas = null;
        this.fftProcessor = null;
        this.lofarSpectrum = null;
        this._lofarPending = null;
    }
}
