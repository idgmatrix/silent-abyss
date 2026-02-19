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
        this._demonSampleBuffer = new Float32Array(131072); // ~3 s at 44100 Hz
        this._demonSampleWriteIndex = 0;
        this._demonSampleCount = 0;
        this.selfNoiseSuppressionEnabled = true;
        this._ownShipSignature = { rpm: 0, bladeCount: 0, bpfHz: 0 };
        this._ownShipMaskBins = [];
        this._demonPeakTracks = [];
        this._demonSignalQuality = 0;
        this._demonSourceMode = 'COMPOSITE';
        this._demonTrackState = 'SEARCHING';
        this._demonLockConfidence = 0;
        this._demonSelectedTargetId = null;
        this._demonTargetCache = new Map();
        this._demonPingTransient = { active: false, recent: false, sinceLastPing: Infinity };
        this._pingEchoes = [];
        this._demonFocusWidthHz = 1.3;
        this._demonResponsiveness = 0.55;
        this._demonLocks = new Map();
        this._demonLockConfig = {
            combToleranceHz: 1.3,
            maxHarmonics: 8,
            lockOn: 0.68,
            lockOff: 0.42,
            tentativeOn: 0.36,
            tentativeOff: 0.2,
            confidenceAttack: 0.24,
            confidenceRelease: 0.12,
            lowEnergyFastRelease: 0.34,
            lowEnergyThreshold: 0.18,
            staleTimeoutSec: 45
        };

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
        this.btrDisplay.setTopInset(12);

        this.waterfallDisplay = new ScrollingDisplay('waterfall-canvas');
        this.waterfallDisplay.setDecayRate(0.0008); // Slower decay to preserve broadband waterfall history
        this.waterfallDisplay.setTopInset(12);

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

    draw(dataArray, targets, currentRpm, pingIntensity, sampleRate, fftSize, selectedTarget = null, timeDomainData = null, options = {}) {
        if (!dataArray) return;
        this.lastTargets = targets;
        this._ownShipSignature = options.ownShipSignature || this._ownShipSignature;
        this._demonSourceMode = options.sourceMode === 'SELECTED' ? 'SELECTED' : 'COMPOSITE';
        this._demonPingTransient = options.pingTransient || this._demonPingTransient;
        this._pingEchoes = options.pingEchoes || [];
        this._syncDemonTargetCache(selectedTarget);
        this._updateLofarSpectrum(dataArray, timeDomainData, fftSize);
        this._updateDemonSpectrum(timeDomainData, sampleRate, selectedTarget);
        this.drawLOFAR(dataArray, currentRpm, sampleRate, fftSize, selectedTarget);
        this.drawDEMON(dataArray, currentRpm, selectedTarget, sampleRate);
        this.drawBTR(targets, currentRpm, pingIntensity, this._pingEchoes, selectedTarget);
        this.drawWaterfall(dataArray, pingIntensity, sampleRate, fftSize);
    }

    _cloneDemonLock(lock) {
        if (!lock) return null;
        return {
            targetId: lock.targetId,
            bpfEstimateHz: lock.bpfEstimateHz,
            confidence: lock.confidence,
            harmonicHits: lock.harmonicHits,
            harmonicCount: lock.harmonicCount,
            state: lock.state,
            lastUpdateTime: lock.lastUpdateTime
        };
    }

    _snapshotCurrentDemonState() {
        const lock = this._demonLocks.get(this._demonSelectedTargetId);
        return {
            smoothedSpectrum: this._demonSmoothedSpectrum instanceof Float32Array
                ? new Float32Array(this._demonSmoothedSpectrum)
                : null,
            enhancedSpectrum: this._demonEnhancedSpectrum instanceof Float32Array
                ? new Float32Array(this._demonEnhancedSpectrum)
                : null,
            peaksHz: Array.isArray(this._demonPeaksHz) ? [...this._demonPeaksHz] : [],
            peakTracks: Array.isArray(this._demonPeakTracks)
                ? this._demonPeakTracks.map((track) => ({ ...track }))
                : [],
            harmonicScore: this._demonHarmonicScore,
            displayHarmonicScore: this._demonDisplayHarmonicScore,
            signalQuality: this._demonSignalQuality,
            trackState: this._demonTrackState,
            lockConfidence: this._demonLockConfidence,
            lock: this._cloneDemonLock(lock),
            lastSeenAt: performance.now() / 1000
        };
    }

    _restoreDemonStateFromCache(targetId) {
        const cached = this._demonTargetCache.get(targetId);
        if (!cached) {
            this._demonPeakTracks = [];
            this._demonPeaksHz = [];
            this._demonHarmonicScore = 0;
            this._demonDisplayHarmonicScore = 0;
            this._demonSignalQuality = 0;
            this._demonTrackState = 'SEARCHING';
            this._demonLockConfidence = 0;
            this._demonSmoothedSpectrum = null;
            this._demonEnhancedSpectrum = null;
            this._demonSampleCount = 0;
            this._demonSampleWriteIndex = 0;
            this._demonSampleBuffer.fill(0);
            return;
        }

        this._demonSmoothedSpectrum = cached.smoothedSpectrum ? new Float32Array(cached.smoothedSpectrum) : null;
        this._demonEnhancedSpectrum = cached.enhancedSpectrum ? new Float32Array(cached.enhancedSpectrum) : null;
        this._demonPeaksHz = Array.isArray(cached.peaksHz) ? [...cached.peaksHz] : [];
        this._demonPeakTracks = Array.isArray(cached.peakTracks)
            ? cached.peakTracks.map((track) => ({ ...track }))
            : [];
        this._demonHarmonicScore = Number.isFinite(cached.harmonicScore) ? cached.harmonicScore : 0;
        this._demonDisplayHarmonicScore = Number.isFinite(cached.displayHarmonicScore)
            ? cached.displayHarmonicScore
            : this._demonHarmonicScore;
        this._demonSignalQuality = Number.isFinite(cached.signalQuality) ? cached.signalQuality : 0;
        this._demonTrackState = cached.trackState || 'SEARCHING';
        this._demonLockConfidence = Number.isFinite(cached.lockConfidence) ? cached.lockConfidence : 0;
        if (cached.lock) {
            this._demonLocks.set(targetId, this._cloneDemonLock(cached.lock));
        }
    }

    _expireStaleDemonCaches(nowSec = performance.now() / 1000) {
        const expirySec = Math.max(20, (this._demonLockConfig?.staleTimeoutSec || 45));
        for (const [targetId, cached] of this._demonTargetCache.entries()) {
            const age = nowSec - (cached.lastSeenAt || 0);
            if (age > expirySec) {
                this._demonTargetCache.delete(targetId);
                this._demonLocks.delete(targetId);
            }
        }
    }

    _syncDemonTargetCache(selectedTarget) {
        const nextTargetId = selectedTarget?.id || null;
        const nowSec = performance.now() / 1000;
        this._expireStaleDemonCaches(nowSec);

        if (this._demonSelectedTargetId === nextTargetId) return;

        if (this._demonSelectedTargetId) {
            this._demonTargetCache.set(
                this._demonSelectedTargetId,
                this._snapshotCurrentDemonState()
            );
        }

        this._demonSelectedTargetId = nextTargetId;
        if (this._demonSelectedTargetId) {
            this._restoreDemonStateFromCache(this._demonSelectedTargetId);
        } else {
            this._demonPeakTracks = [];
            this._demonPeaksHz = [];
            this._demonHarmonicScore = 0;
            this._demonDisplayHarmonicScore = 0;
            this._demonSignalQuality = 0;
            this._demonTrackState = 'SEARCHING';
            this._demonLockConfidence = 0;
            this._demonSmoothedSpectrum = null;
            this._demonEnhancedSpectrum = null;
        }
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

        // Own-ship harmonic overlay (distinct from target/peak traces).
        const ownBpfHz = Number.isFinite(this._ownShipSignature?.bpfHz) ? this._ownShipSignature.bpfHz : 0;
        const binHz = sampleRate > 0 && fftSize > 0 ? sampleRate / fftSize : 0;
        if (ownBpfHz > 0 && binHz > 0) {
            ctx.save();
            ctx.strokeStyle = 'rgba(70, 180, 255, 0.55)';
            ctx.fillStyle = 'rgba(120, 200, 255, 0.75)';
            ctx.lineWidth = 1;
            ctx.setLineDash([2, 2]);
            let drawn = 0;
            for (let k = 1; k <= 5; k++) {
                const f = ownBpfHz * k;
                const idx = Math.round(f / binHz);
                if (idx <= 1 || idx >= viewLength) break;
                const x = (idx / viewLength) * cvs.width;
                ctx.beginPath();
                ctx.moveTo(x, 0);
                ctx.lineTo(x, cvs.height);
                ctx.stroke();
                ctx.fillText(`S${k}`, x + 2, 9 + k * 9);
                drawn++;
                if (drawn >= 4) break;
            }
            ctx.restore();
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

    _updateDemonSpectrum(timeDomainData, sampleRate, selectedTarget = null) {
        if (!(timeDomainData instanceof Float32Array)) return;
        if (!sampleRate || sampleRate <= 0) return;

        this._pushDemonSamples(timeDomainData);

        const pingActive = !!this._demonPingTransient?.active;
        const pingRecent = !!this._demonPingTransient?.recent;
        if (pingActive || pingRecent) {
            // Reject transient-contaminated DEMON frames during/shortly after active ping.
            if (this._demonSmoothedSpectrum instanceof Float32Array) {
                for (let i = 1; i < this._demonSmoothedSpectrum.length; i++) {
                    this._demonSmoothedSpectrum[i] *= 0.92;
                }
            }
            this._demonPeaksHz = [];
            this._demonPeakTracks = this._demonPeakTracks
                .map((track) => ({ ...track, strength: track.strength * 0.78, age: track.age + 1, seen: false }))
                .filter((track) => track.age <= 6 && track.strength >= 0.12);
            this._demonSignalQuality *= 0.84;
            return;
        }

        // Update less frequently to keep render cost stable.
        this._demonFrameCounter++;
        if (this._demonFrameCounter % 3 !== 0) return;

        const analysisWindow = this._getDemonAnalysisWindow();
        if (!analysisWindow) return;

        let rawSpectrum = this._computeDemonSpectrum(analysisWindow, sampleRate, 120);
        rawSpectrum = this._applyOwnShipMask(rawSpectrum, selectedTarget);
        this._demonSpectrum = rawSpectrum;
        let maxRaw = 0;
        let sumRaw = 0;
        let binsRaw = 0;
        for (let hz = 1; hz < rawSpectrum.length; hz++) {
            const v = rawSpectrum[hz] || 0;
            if (v > maxRaw) maxRaw = v;
            sumRaw += v;
            binsRaw++;
        }
        const meanRaw = binsRaw > 0 ? sumRaw / binsRaw : 0;
        const absoluteScore = Math.max(0, Math.min(1, (maxRaw - 0.0015) / 0.01));
        const contrastScore = Math.max(
            0,
            Math.min(1, ((maxRaw / Math.max(1e-6, meanRaw)) - 1.5) / 2.5)
        );
        const quality = absoluteScore * 0.6 + contrastScore * 0.4;
        this._demonSignalQuality += (quality - this._demonSignalQuality) * 0.18;
        this._demonEnhancedSpectrum = this._enhanceDemonSpectrum(rawSpectrum);
        this._demonSmoothedSpectrum = this._smoothDemonSpectrum(this._demonEnhancedSpectrum);
        this._demonPeaksHz = this._detectDemonPeaks(this._demonSmoothedSpectrum, 6);
    }

    _applyOwnShipMask(spectrum, selectedTarget = null) {
        this._ownShipMaskBins = [];
        if (!(spectrum instanceof Float32Array) || spectrum.length < 4) return spectrum;
        if (!this.selfNoiseSuppressionEnabled) return spectrum;

        // When a target is selected the analysis bus carries contacts only
        // (own-ship is structurally excluded), so there is nothing to mask.
        if (selectedTarget) return spectrum;

        const ownBpfHz = Number.isFinite(this._ownShipSignature?.bpfHz) ? this._ownShipSignature.bpfHz : 0;
        if (ownBpfHz <= 0) return spectrum;

        const out = new Float32Array(spectrum);
        const multiplier = 0.38;
        const baseRadiusHz = 0.9;
        for (let k = 1; k <= 10; k++) {
            const f = ownBpfHz * k;
            const centerBin = Math.round(f);
            if (centerBin <= 1 || centerBin >= out.length) break;
            const radius = Math.max(1, Math.round(baseRadiusHz + k * 0.12));
            this._ownShipMaskBins.push(centerBin);
            for (let b = centerBin - radius; b <= centerBin + radius; b++) {
                if (b <= 1 || b >= out.length) continue;
                const dist = Math.abs(b - centerBin) / Math.max(1, radius);
                const falloff = Math.exp(-3.2 * dist * dist);
                const attenuation = 1 - (1 - multiplier) * falloff;
                out[b] *= attenuation;
            }
        }
        return out;
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
        const targetLength = this._demonSampleCount >= 65536 ? 65536 :
            this._demonSampleCount >= 16384 ? 16384 : 8192;
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
        const nRaw = timeDomainData.length;
        const spectrum = new Float32Array(maxFreqHz + 1);
        if (nRaw < 64) return spectrum;

        // DEMON chain:
        // 1) Band-limit raw signal to machinery band (20–1800 Hz HP+LP).
        // 2) Full-wave rectify to get amplitude envelope.
        // 3) Average-decimate envelope to ~500 Hz — we only need 1–120 Hz,
        //    so decimation improves low-frequency resolution while cutting cost.
        // 4) Remove slow DC drift (1 Hz HP) from decimated envelope.
        // 5) DFT of decimated envelope at 1–maxFreqHz Hz.
        let meanRaw = 0;
        for (let i = 0; i < nRaw; i++) meanRaw += timeDomainData[i];
        meanRaw /= nRaw;

        const hpRc = 1 / (2 * Math.PI * 20);
        const lpRc = 1 / (2 * Math.PI * 1800);
        const dt = 1 / sampleRate;
        const hpAlpha = hpRc / (hpRc + dt);
        const lpAlpha = dt / (lpRc + dt);

        // Decimate envelope to ~500 Hz sample rate.
        const D = Math.max(1, Math.floor(sampleRate / 500));
        const decimSR = sampleRate / D;
        const nDecim = Math.floor(nRaw / D);
        if (nDecim < 8) return spectrum;

        const decimEnv = new Float32Array(nDecim);
        let hpY = 0, hpPrevX = 0, lpY = 0, accum = 0;
        for (let i = 0; i < nRaw; i++) {
            const x = timeDomainData[i] - meanRaw;
            hpY = hpAlpha * (hpY + x - hpPrevX);
            hpPrevX = x;
            lpY += lpAlpha * (hpY - lpY);
            accum += Math.abs(lpY);
            if ((i + 1) % D === 0) {
                decimEnv[(i + 1) / D - 1] = accum / D;
                accum = 0;
            }
        }

        // Remove slow DC drift from decimated envelope (1 Hz HP).
        const envHpRc = 1 / (2 * Math.PI * 1.0);
        const decimDt = 1 / decimSR;
        const envHpAlpha = envHpRc / (envHpRc + decimDt);
        let envHpY = 0, envHpPrevX = decimEnv[0] || 0;
        const signal = new Float32Array(nDecim);
        for (let i = 0; i < nDecim; i++) {
            const x = decimEnv[i];
            envHpY = envHpAlpha * (envHpY + x - envHpPrevX);
            envHpPrevX = x;
            signal[i] = envHpY;
        }

        // DFT of decimated envelope at each target frequency.
        const hannDenom = Math.max(1, nDecim - 1);
        for (let f = 1; f <= maxFreqHz; f++) {
            const omega = (2 * Math.PI * f) / decimSR;
            let re = 0, im = 0;
            for (let i = 0; i < nDecim; i++) {
                const hann = 0.5 * (1 - Math.cos((2 * Math.PI * i) / hannDenom));
                const v = signal[i] * hann;
                re += v * Math.cos(omega * i);
                im -= v * Math.sin(omega * i);
            }
            spectrum[f] = Math.hypot(re, im) / nDecim;
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
            const riseAlpha = 0.1 + this._demonResponsiveness * 0.3;
            const fallAlpha = 0.04 + this._demonResponsiveness * 0.18;
            const alpha = curr >= prev ? riseAlpha : fallAlpha;
            this._demonSmoothedSpectrum[i] = prev + (curr - prev) * alpha;
        }

        return this._demonSmoothedSpectrum;
    }

    _detectDemonPeaks(enhancedSpectrum, maxPeaks = 6) {
        if (!(enhancedSpectrum instanceof Float32Array) || enhancedSpectrum.length < 4) return [];

        let maxValue = 0;
        let sum = 0;
        let count = 0;
        for (let hz = 1; hz < enhancedSpectrum.length; hz++) {
            const v = enhancedSpectrum[hz] || 0;
            sum += v;
            count++;
            if (v > maxValue) maxValue = v;
        }
        const meanValue = count > 0 ? sum / count : 0;
        const dynamicRange = maxValue - meanValue;

        // Flat/low-energy spectra should not produce jittery pseudo-peaks.
        if (maxValue < 0.22 || dynamicRange < 0.08) {
            this._demonPeakTracks = this._demonPeakTracks
                .map((track) => ({
                    ...track,
                    strength: track.strength * 0.8,
                    age: track.age + 1,
                    seen: false
                }))
                .filter((track) => track.age <= 8 && track.strength >= 0.14);
            return this._demonPeakTracks
                .filter((track) => track.strength >= 0.26)
                .slice(0, maxPeaks)
                .map((track) => Math.round(track.hz))
                .sort((a, b) => a - b);
        }

        const candidates = [];
        for (let hz = 2; hz < enhancedSpectrum.length - 2; hz++) {
            const v = enhancedSpectrum[hz];
            if (v < 0.2) continue;
            if (v > enhancedSpectrum[hz - 1] && v >= enhancedSpectrum[hz + 1]) {
                const localBase = Math.max(
                    enhancedSpectrum[hz - 1],
                    enhancedSpectrum[hz + 1],
                    (enhancedSpectrum[hz - 2] + enhancedSpectrum[hz + 2]) * 0.5
                );
                const prominence = v - localBase;
                if (prominence < 0.03) continue;
                candidates.push({
                    hz,
                    value: v,
                    prominence,
                    score: v * 0.75 + prominence * 0.25
                });
            }
        }

        candidates.sort((a, b) => b.score - a.score);
        const tracks = this._demonPeakTracks.map((track) => ({
            ...track,
            strength: track.strength * 0.86,
            age: track.age + 1,
            seen: false
        }));

        const matchWindowHz = Math.max(1.4, this._demonFocusWidthHz * 1.8);
        const maxCandidates = Math.min(candidates.length, maxPeaks * 3);
        for (let i = 0; i < maxCandidates; i++) {
            const candidate = candidates[i];
            let bestIdx = -1;
            let bestDist = Infinity;
            for (let j = 0; j < tracks.length; j++) {
                const dist = Math.abs(tracks[j].hz - candidate.hz);
                if (dist <= matchWindowHz && dist < bestDist) {
                    bestDist = dist;
                    bestIdx = j;
                }
            }

            if (bestIdx >= 0) {
                const track = tracks[bestIdx];
                track.hz = track.hz * 0.72 + candidate.hz * 0.28;
                track.strength = Math.min(1, track.strength * 0.55 + candidate.value * 0.9);
                track.prominence = candidate.prominence;
                track.age = 0;
                track.seen = true;
            } else {
                tracks.push({
                    hz: candidate.hz,
                    strength: candidate.value * 0.62,
                    prominence: candidate.prominence,
                    age: 0,
                    seen: true
                });
            }
        }

        const alive = tracks
            .filter((track) => track.age <= 14 && track.strength >= 0.12)
            .sort((a, b) => {
                const aWeight = a.strength + (a.seen ? 0.08 : 0) - a.age * 0.01;
                const bWeight = b.strength + (b.seen ? 0.08 : 0) - b.age * 0.01;
                return bWeight - aWeight;
            })
            .slice(0, maxPeaks * 2);

        this._demonPeakTracks = alive;

        const stablePeaks = alive
            .filter((track) => track.strength >= 0.24 && (track.seen || track.age <= 3))
            .slice(0, maxPeaks)
            .map((track) => Math.round(track.hz));

        return [...new Set(stablePeaks)].sort((a, b) => a - b);
    }

    _estimateBpfFromPeaks(peaksHz, maxFreqHz) {
        if (!Array.isArray(peaksHz) || peaksHz.length < 2) return null;
        const spacings = [];
        for (let i = 1; i < peaksHz.length; i++) {
            const d = peaksHz[i] - peaksHz[i - 1];
            if (d >= 2 && d <= Math.max(20, maxFreqHz * 0.35)) {
                spacings.push(d);
            }
        }
        if (spacings.length === 0) return null;
        spacings.sort((a, b) => a - b);
        return spacings[Math.floor(spacings.length / 2)];
    }

    _scoreDemonComb(spectrum, bpfHz, maxFreqHz) {
        if (!(spectrum instanceof Float32Array) || !Number.isFinite(bpfHz) || bpfHz <= 0) {
            return { score: 0, harmonicHits: 0, harmonicCount: 0 };
        }
        const cfg = this._demonLockConfig;
        let weightedHits = 0;
        let weightedTotal = 0;
        let harmonicHits = 0;
        let harmonicCount = 0;

        for (let k = 1; k <= cfg.maxHarmonics; k++) {
            const f = bpfHz * k;
            if (f > maxFreqHz) break;
            const c = Math.round(f);
            if (c <= 3 || c >= spectrum.length - 4) continue;
            harmonicCount++;

            const tolerance = Math.max(1, Math.round(cfg.combToleranceHz + k * 0.05));
            let maxVal = 0;
            let maxIdx = c;
            for (let i = c - tolerance; i <= c + tolerance; i++) {
                if (i <= 1 || i >= spectrum.length - 1) continue;
                const v = spectrum[i];
                if (v > maxVal) {
                    maxVal = v;
                    maxIdx = i;
                }
            }

            const localNoise =
                (spectrum[maxIdx - 3] +
                    spectrum[maxIdx - 2] +
                    spectrum[maxIdx + 2] +
                    spectrum[maxIdx + 3]) / 4;
            const prominence = Math.max(0, maxVal - localNoise);
            const harmonicWeight = 1 / Math.sqrt(k);
            weightedTotal += harmonicWeight;

            if (prominence >= 0.04 && maxVal >= 0.16) {
                harmonicHits++;
                const hitStrength = Math.max(0, Math.min(1, maxVal * 0.7 + prominence * 2.1));
                weightedHits += harmonicWeight * hitStrength;
            }
        }

        const baseScore = weightedTotal > 0 ? weightedHits / weightedTotal : 0;
        const countFactor = harmonicCount > 0 ? Math.min(1, harmonicHits / Math.max(2, harmonicCount * 0.7)) : 0;
        const score = Math.max(0, Math.min(1, baseScore * 0.7 + countFactor * 0.3));
        return { score, harmonicHits, harmonicCount };
    }

    _updateSelectedDemonLock(selectedTarget, bpfHintHz, spectrum, maxFreqHz) {
        const nowSec = performance.now() / 1000;
        // prune stale lock entries
        for (const [id, lock] of this._demonLocks.entries()) {
            if (nowSec - lock.lastUpdateTime > this._demonLockConfig.staleTimeoutSec) {
                this._demonLocks.delete(id);
            }
        }

        if (!selectedTarget?.id) {
            this._demonTrackState = 'SEARCHING';
            this._demonLockConfidence += (0 - this._demonLockConfidence) * 0.2;
            return null;
        }

        const targetId = selectedTarget.id;
        const cfg = this._demonLockConfig;
        const lock = this._demonLocks.get(targetId) || {
            targetId,
            bpfEstimateHz: Number.isFinite(bpfHintHz) && bpfHintHz > 0 ? bpfHintHz : null,
            confidence: 0,
            harmonicHits: 0,
            harmonicCount: 0,
            state: 'SEARCHING',
            lastUpdateTime: nowSec
        };

        const peakBpf = this._estimateBpfFromPeaks(this._demonPeaksHz, maxFreqHz);
        const candidates = [];
        if (Number.isFinite(lock.bpfEstimateHz) && lock.bpfEstimateHz > 0) candidates.push(lock.bpfEstimateHz);
        if (Number.isFinite(bpfHintHz) && bpfHintHz > 0) candidates.push(bpfHintHz);
        if (Number.isFinite(peakBpf) && peakBpf > 0) candidates.push(peakBpf);
        const uniq = [...new Set(candidates.map((v) => Number(v.toFixed(2))))].filter((v) => v >= 2 && v <= maxFreqHz * 0.5);

        let best = { bpfHz: lock.bpfEstimateHz || bpfHintHz || null, score: 0, harmonicHits: 0, harmonicCount: 0 };
        for (const cand of uniq) {
            const scored = this._scoreDemonComb(spectrum, cand, maxFreqHz);
            if (scored.score > best.score) {
                best = { bpfHz: cand, ...scored };
            }
        }

        if (Number.isFinite(best.bpfHz) && best.bpfHz > 0) {
            if (!Number.isFinite(lock.bpfEstimateHz) || lock.bpfEstimateHz <= 0) {
                lock.bpfEstimateHz = best.bpfHz;
            } else {
                lock.bpfEstimateHz = lock.bpfEstimateHz * 0.74 + best.bpfHz * 0.26;
            }
        }

        const combinedEvidence = Math.max(
            0,
            Math.min(1, best.score * 0.78 + Math.max(0, Math.min(1, this._demonSignalQuality)) * 0.22)
        );
        const lowEnergy = this._demonSignalQuality < cfg.lowEnergyThreshold;
        const tau = combinedEvidence >= lock.confidence
            ? cfg.confidenceAttack
            : lowEnergy
                ? cfg.lowEnergyFastRelease
                : cfg.confidenceRelease;
        lock.confidence += (combinedEvidence - lock.confidence) * tau;
        lock.harmonicHits = best.harmonicHits;
        lock.harmonicCount = best.harmonicCount;

        if (lock.state === 'LOCKED') {
            if (lock.confidence < cfg.lockOff || lock.harmonicHits < 2) {
                lock.state = 'LOST';
            }
        } else if (lock.state === 'LOST') {
            if (lock.confidence >= cfg.tentativeOn && lock.harmonicHits >= 1) {
                lock.state = 'TENTATIVE';
            } else if (lock.confidence < cfg.tentativeOff) {
                lock.state = 'SEARCHING';
            }
        } else if (lock.state === 'TENTATIVE') {
            if (lock.confidence >= cfg.lockOn && lock.harmonicHits >= 2) {
                lock.state = 'LOCKED';
            } else if (lock.confidence < cfg.tentativeOff) {
                lock.state = 'SEARCHING';
            }
        } else if (lock.confidence >= cfg.tentativeOn && lock.harmonicHits >= 1) {
            lock.state = 'TENTATIVE';
        } else {
            lock.state = 'SEARCHING';
        }

        lock.lastUpdateTime = nowSec;
        this._demonLocks.set(targetId, lock);

        this._demonTrackState = lock.state;
        this._demonLockConfidence = lock.confidence;
        return lock;
    }

    drawDEMON(dataArray, currentRpm, selectedTarget, sampleRate) {
        if (!this.dCtx || !this.dCanvas) return;
        const ctx = this.dCtx;
        const cvs = this.dCanvas;
        const selectedBladeCount = Number.isFinite(selectedTarget?.bladeCount)
            ? Math.max(1, Math.floor(selectedTarget.bladeCount))
            : null;
        const bladeCountForMarkers = selectedBladeCount ?? 5;
        const rpmForMarkers = selectedTarget?.rpm ?? currentRpm;
        const bpfHz = rpmForMarkers > 0 ? (rpmForMarkers / 60) * bladeCountForMarkers : 0;
        const maxFreqHz = (() => {
            const defaultRange = 80;
            if (!Number.isFinite(bpfHz) || bpfHz <= 0) return defaultRange;
            const adaptive = Math.ceil((bpfHz * 6) / 10) * 10;
            return Math.max(40, Math.min(100, adaptive));
        })();
        const infoPanelWidth = Math.min(220, Math.max(180, Math.floor(cvs.width * 0.42)));
        const infoPanelX = cvs.width - infoPanelWidth - 8;
        const infoPanelY = 6;
        const plotLeft = 6;
        const plotRight = cvs.width - 6;
        const plotWidth = Math.max(40, plotRight - plotLeft);
        const toPlotX = (hz) => plotLeft + (hz / maxFreqHz) * plotWidth;

        ctx.fillStyle = 'rgba(0, 5, 10, 0.8)';
        ctx.fillRect(0, 0, cvs.width, cvs.height);

        // Background frequency grid.
        ctx.strokeStyle = 'rgba(0, 255, 255, 0.08)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let hz = 10; hz <= maxFreqHz; hz += 10) {
            const x = toPlotX(hz);
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
            ctx.strokeStyle = selectedTarget ? 'rgba(255, 60, 60, 0.45)' : 'rgba(255, 190, 40, 0.4)';
            ctx.lineWidth = 1.05;

            const traceSamples = Math.max(240, Math.floor(plotWidth * 2.5));
            for (let i = 0; i <= traceSamples; i++) {
                const hz = 1 + (i / traceSamples) * (maxFreqHz - 1);
                const x = toPlotX(hz);
                const lo = Math.max(1, Math.floor(hz));
                const hi = Math.min(enhancedSpectrum.length - 1, lo + 1);
                const t = Math.max(0, Math.min(1, hz - lo));
                const v0 = enhancedSpectrum[lo] || 0;
                const v1 = enhancedSpectrum[hi] || v0;
                const value = v0 + (v1 - v0) * t;
                const norm = Math.log1p((value / peak) * 50) / Math.log1p(50);
                const y = cvs.height - norm * cvs.height * 0.75;
                if (i === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            }
            ctx.stroke();

            // Draw detected narrowband peaks.
            ctx.strokeStyle = 'rgba(0, 255, 255, 0.9)';
            ctx.lineWidth = 1.4;
            let peakDrawCount = 0;
            for (const hz of this._demonPeaksHz) {
                if (hz > maxFreqHz) continue;
                const x = toPlotX(hz);
                ctx.beginPath();
                ctx.moveTo(x, cvs.height);
                ctx.lineTo(x, cvs.height * 0.42);
                ctx.stroke();
                peakDrawCount++;
                if (peakDrawCount >= 4) break;
            }
        } else {
            // Fallback when time-domain data isn't available.
            ctx.strokeStyle = 'rgba(255, 170, 0, 0.6)';
            ctx.lineWidth = 2;
            const bins = Math.min(12, dataArray.length);
            for (let i = 1; i < bins; i++) {
                const hz = (i / bins) * maxFreqHz;
                const x = toPlotX(hz);
                const val = dataArray[i] / 255;
                const y = cvs.height - val * cvs.height * 0.55;
                ctx.beginPath();
                ctx.moveTo(x, cvs.height);
                ctx.lineTo(x, y);
                ctx.stroke();
            }
        }

        // Blade-rate harmonic markers.
        const autoBpfConfidenceThreshold = 0.45;
        const hasSelectedTarget = !!selectedTarget;
        const selectedLock = this._updateSelectedDemonLock(
            selectedTarget,
            bpfHz,
            enhancedSpectrum,
            maxFreqHz
        );
        const trackedBpfHz = Number.isFinite(selectedLock?.bpfEstimateHz) ? selectedLock.bpfEstimateHz : bpfHz;
        const harmonicEvalEnabled =
            hasSelectedTarget &&
            this._demonTrackState !== 'SEARCHING' &&
            this._demonSignalQuality >= 0.32 &&
            (selectedLock?.harmonicHits ?? 0) >= 1;
        const harmonicGuidesVisible = this._demonTrackState !== 'SEARCHING';
        const targetHarmonicsHz = [];
        this._demonHarmonicScore = selectedLock ? selectedLock.confidence : 0;
        if (hasSelectedTarget && trackedBpfHz > 0 && Number.isFinite(trackedBpfHz) && harmonicGuidesVisible) {
            ctx.save();
            const toleranceHz = Math.max(0.5, this._demonFocusWidthHz);
            ctx.fillStyle = harmonicEvalEnabled
                ? 'rgba(170, 255, 170, 0.14)'
                : 'rgba(170, 255, 170, 0.08)';
            ctx.strokeStyle = harmonicEvalEnabled ? 'rgba(170, 255, 170, 0.9)' : 'rgba(170, 255, 170, 0.35)';
            ctx.lineWidth = harmonicEvalEnabled ? 1.3 : 1.0;
            ctx.setLineDash([2, 2]);
            for (let k = 1; k <= 6; k++) {
                const f = trackedBpfHz * k;
                if (f > maxFreqHz) break;
                targetHarmonicsHz.push(f);

                const bandLeftHz = Math.max(0, f - toleranceHz);
                const bandRightHz = Math.min(maxFreqHz, f + toleranceHz);
                const bandX = toPlotX(bandLeftHz);
                const bandW = Math.max(1, toPlotX(bandRightHz) - bandX);
                ctx.fillRect(bandX, 0, bandW, cvs.height * 0.8);

                const x = toPlotX(f);
                ctx.beginPath();
                ctx.moveTo(x, 0);
                ctx.lineTo(x, cvs.height * 0.8);
                ctx.stroke();
            }
            ctx.restore();
        }
        this._demonDisplayHarmonicScore +=
            (this._demonHarmonicScore - this._demonDisplayHarmonicScore) * 0.12;
        const showBpfReadout =
            (hasSelectedTarget && (selectedLock?.confidence ?? 0) >= 0.32) ||
            (!hasSelectedTarget && this._demonDisplayHarmonicScore >= autoBpfConfidenceThreshold);

        const ownBpfHz = Number.isFinite(this._ownShipSignature?.bpfHz) ? this._ownShipSignature.bpfHz : 0;
        if (ownBpfHz > 0) {
            ctx.save();
            ctx.strokeStyle = 'rgba(80, 170, 255, 0.38)';
            ctx.fillStyle = 'rgba(120, 205, 255, 0.8)';
            ctx.setLineDash([2, 2]);
            let drawn = 0;
            for (let k = 1; k <= 8; k++) {
                const hz = ownBpfHz * k;
                if (hz > maxFreqHz) break;
                // Avoid overdraw where own-ship harmonics nearly overlap target harmonics.
                if (targetHarmonicsHz.some((f) => Math.abs(f - hz) < 0.9)) continue;
                const x = toPlotX(hz);
                ctx.beginPath();
                ctx.moveTo(x, 0);
                ctx.lineTo(x, cvs.height * 0.55);
                ctx.stroke();
                ctx.fillText(`S${k}`, x + 2, cvs.height * 0.57);
                drawn++;
                if (drawn >= 5) break;
            }
            ctx.restore();
        }

        // Keep text readable against dense marker regions.
        ctx.fillStyle = 'rgba(0, 0, 0, 0.48)';
        ctx.fillRect(infoPanelX, infoPanelY, infoPanelWidth, 130);

        ctx.fillStyle = selectedTarget ? '#ff3333' : '#00ffff';
        ctx.font = '9px Arial';
        const label = selectedTarget
            ? `TARGET ANALYSIS: ${selectedTarget.type} (T${selectedTarget.id.split('-')[1]})`
            : `AUTO-ANALYSIS: ${currentRpm > 0 ? 'ENGINE ACTIVE' : 'IDLE'}`;
        ctx.fillText(label, infoPanelX + 6, infoPanelY + 10);

        ctx.fillStyle = '#ffffff';
        ctx.font = '10px monospace';
        ctx.fillText(`SOURCE: ${this._demonSourceMode}`, infoPanelX + 6, infoPanelY + 24);
        ctx.fillText(`DEMON TRACK: ${this._demonTrackState}`, infoPanelX + 6, infoPanelY + 38);
        ctx.fillText(`BLADE COUNT: ${selectedBladeCount ?? '--'}`, infoPanelX + 6, infoPanelY + 52);
        ctx.fillText(
            `BPF: ${showBpfReadout && trackedBpfHz > 0 ? `${trackedBpfHz.toFixed(1)} Hz` : '--'}`,
            infoPanelX + 6,
            infoPanelY + 66
        );
        if (sampleRate > 0) {
            ctx.fillText(`BAND: 1-${maxFreqHz} Hz`, infoPanelX + 6, infoPanelY + 80);
        }
        ctx.fillText(
            `HARMONIC MATCH: ${harmonicEvalEnabled ? `${(this._demonDisplayHarmonicScore * 100).toFixed(0)}%` : '--'}`,
            infoPanelX + 6,
            infoPanelY + 94
        );
        ctx.fillStyle = '#79bfff';
        ctx.fillText(
            `SELF MASK: ${this.selfNoiseSuppressionEnabled ? 'ON' : 'OFF'} | OWN BPF: ${ownBpfHz > 0 ? `${ownBpfHz.toFixed(1)}Hz` : '--'}`,
            infoPanelX + 6,
            infoPanelY + 108
        );

        if (selectedTarget && selectedTarget.classification) {
            const cls = selectedTarget.classification;
            ctx.fillStyle = '#ffffff';
            ctx.font = '10px monospace';
            ctx.fillText(`STATUS: ${cls.state}`, infoPanelX + 6, infoPanelY + 122);

            // Progress bar
            ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
            ctx.fillRect(infoPanelX + 6, infoPanelY + 127, 100, 4);
            ctx.fillStyle = cls.confirmed ? '#00ff00' : '#ffffff';
            ctx.fillRect(infoPanelX + 6, infoPanelY + 127, cls.progress * 100, 4);

            if (cls.identifiedClass) {
                ctx.fillText(`CLASS: ${cls.identifiedClass.toUpperCase()}`, infoPanelX + 6, infoPanelY + 142);
            }
        }
    }

    setSelfNoiseSuppressionEnabled(enabled) {
        this.selfNoiseSuppressionEnabled = !!enabled;
    }

    setDemonFocusWidth(valueHz) {
        const width = Number.isFinite(valueHz) ? valueHz : this._demonFocusWidthHz;
        this._demonFocusWidthHz = Math.max(0.6, Math.min(3.0, width));
        this._demonLockConfig.combToleranceHz = this._demonFocusWidthHz;
    }

    setDemonResponsiveness(value01) {
        const v = Number.isFinite(value01) ? value01 : this._demonResponsiveness;
        this._demonResponsiveness = Math.max(0, Math.min(1, v));
        const r = this._demonResponsiveness;
        this._demonLockConfig.confidenceAttack = 0.14 + r * 0.22;
        this._demonLockConfig.confidenceRelease = 0.08 + r * 0.18;
        this._demonLockConfig.lowEnergyFastRelease = 0.22 + r * 0.23;
        this._demonLockConfig.lockOn = 0.74 - r * 0.12;
        this._demonLockConfig.lockOff = 0.5 - r * 0.16;
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

    drawBTR(targets, currentRpm, pingIntensity, _pingEchoes = [], selectedTarget = null) {
        if (!this.btrDisplay) return;

        const theme = BTR_THEMES[this.currentTheme];

        this.btrDisplay.drawNextLine((ctx, width, _height, scanY) => {
            // Background with faint sea-noise speckle
            ctx.fillStyle = '#000000';
            ctx.fillRect(0, scanY, width, 1);

            // Speckle noise
            for (let i = 0; i < width; i += 4) {
                if (Math.random() > 0.95) {
                    const noiseVal = Math.random() * 0.15;
                    ctx.fillStyle = `rgba(${theme.BACKGROUND[0]}, ${theme.BACKGROUND[1]}, ${theme.BACKGROUND[2]}, ${noiseVal})`;
                    ctx.fillRect(i, scanY, 2, 1);
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
                ctx.fillRect(targetX - 5, scanY, 10, 1);
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
                ctx.fillRect(selfX - selfW/2, scanY, selfW, 1);

                // Wide background noise from self engines
                ctx.fillStyle = `rgba(${theme.SELF[0]}, ${theme.SELF[1]}, ${theme.SELF[2]}, ${selfNoiseIntensity * 0.05})`;
                ctx.fillRect(0, scanY, width, 1);
            }

            // Outgoing ping — faint full-panel wash (represents own transmitted pulse)
            if (pingIntensity > 0) {
                ctx.fillStyle = `rgba(${theme.PING[0]}, ${theme.PING[1]}, ${theme.PING[2]}, ${pingIntensity * 0.18})`;
                ctx.fillRect(0, scanY, width, 1);
            }
        });

        this._drawBTRBearingScale(theme);
        this._drawBTRSelectedGate(selectedTarget, theme);
    }

    _drawBTRBearingScale(theme) {
        if (!this.btrDisplay || !this.btrDisplay.ctx || !this.btrDisplay.canvas) return;
        const ctx = this.btrDisplay.ctx;
        const width = this.btrDisplay.canvas.width;
        const topInset = this.btrDisplay.getTopInsetDevicePx
            ? this.btrDisplay.getTopInsetDevicePx()
            : 0;
        if (topInset <= 0) return;

        const dpr = window.devicePixelRatio || 1;
        const minorTick = Math.max(2, Math.round(2 * dpr));
        const majorTick = Math.max(4, Math.round(4 * dpr));

        ctx.save();
        ctx.fillStyle = 'rgba(0, 0, 0, 0.9)';
        ctx.fillRect(0, 0, width, topInset);

        ctx.strokeStyle = `rgba(${theme.PING[0]}, ${theme.PING[1]}, ${theme.PING[2]}, 0.38)`;
        ctx.lineWidth = Math.max(1, dpr);
        ctx.beginPath();
        ctx.moveTo(0, topInset - 0.5);
        ctx.lineTo(width, topInset - 0.5);
        ctx.stroke();

        ctx.font = `${Math.max(7, Math.round(7 * dpr))}px "Share Tech Mono", monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';

        for (let bearing = 0; bearing <= 360; bearing += 10) {
            const x = (bearing / 360) * width;
            const major = bearing % 30 === 0;
            const tickLen = major ? majorTick : minorTick;
            ctx.strokeStyle = major
                ? `rgba(${theme.PING[0]}, ${theme.PING[1]}, ${theme.PING[2]}, 0.72)`
                : `rgba(${theme.PING[0]}, ${theme.PING[1]}, ${theme.PING[2]}, 0.36)`;
            ctx.beginPath();
            ctx.moveTo(x + 0.5, topInset - tickLen);
            ctx.lineTo(x + 0.5, topInset);
            ctx.stroke();

            if (major && bearing % 60 === 0) {
                ctx.fillStyle = `rgba(${theme.PING[0]}, ${theme.PING[1]}, ${theme.PING[2]}, 0.85)`;
                ctx.fillText(`${bearing}`, x, 1);
            }
        }
        ctx.restore();
    }

    _drawBTRSelectedGate(selectedTarget, theme) {
        if (!selectedTarget || !Number.isFinite(selectedTarget.bearing)) return;
        if (!this.btrDisplay || !this.btrDisplay.ctx || !this.btrDisplay.canvas) return;

        const ctx = this.btrDisplay.ctx;
        const width = this.btrDisplay.canvas.width;
        const topInset = this.btrDisplay.getTopInsetDevicePx
            ? this.btrDisplay.getTopInsetDevicePx()
            : 0;
        const dpr = window.devicePixelRatio || 1;

        const bearing = ((selectedTarget.bearing % 360) + 360) % 360;
        const x = (bearing / 360) * width;
        const gateHalfWidth = (1.5 / 360) * width; // +/- 1.5 degrees tolerance band
        const isLost = selectedTarget.state === TrackState.LOST;

        ctx.save();

        // Draw compact brackets at the newest scan line instead of a full-height guide.
        // This avoids masking nearby contact streaks and tolerates slight bearing jitter.
        const scanY = topInset;
        const bracketH = Math.max(6, Math.round(6 * dpr));
        const bracketGap = Math.max(2, Math.round(2 * dpr));
        ctx.strokeStyle = isLost
            ? 'rgba(255, 180, 90, 0.72)'
            : 'rgba(255, 235, 140, 0.95)';
        ctx.lineWidth = Math.max(1, dpr);
        if (isLost) ctx.setLineDash([3, 2]);
        ctx.beginPath();
        ctx.moveTo(x - gateHalfWidth, scanY + bracketGap);
        ctx.lineTo(x - gateHalfWidth, scanY + bracketH);
        ctx.moveTo(x - gateHalfWidth, scanY + bracketGap);
        ctx.lineTo(x - gateHalfWidth + 3 * dpr, scanY + bracketGap);
        ctx.moveTo(x + gateHalfWidth, scanY + bracketGap);
        ctx.lineTo(x + gateHalfWidth, scanY + bracketH);
        ctx.moveTo(x + gateHalfWidth, scanY + bracketGap);
        ctx.lineTo(x + gateHalfWidth - 3 * dpr, scanY + bracketGap);
        ctx.stroke();
        ctx.setLineDash([]);

        // Top marker triangle.
        const triH = Math.max(4, Math.round(4 * dpr));
        const triW = Math.max(6, Math.round(6 * dpr));
        ctx.fillStyle = `rgba(${theme.PING[0]}, ${theme.PING[1]}, ${theme.PING[2]}, 0.95)`;
        ctx.beginPath();
        ctx.moveTo(x, topInset - 1);
        ctx.lineTo(x - triW / 2, topInset - triH - 1);
        ctx.lineTo(x + triW / 2, topInset - triH - 1);
        ctx.closePath();
        ctx.fill();

        // Label in top lane.
        const labelId = selectedTarget.id ? selectedTarget.id.replace('target-', 'T') : 'SEL';
        const label = `SEL ${labelId} ${bearing.toFixed(1)}\u00B0`;
        ctx.font = `${Math.max(7, Math.round(7 * dpr))}px "Share Tech Mono", monospace`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';

        const textWidth = ctx.measureText(label).width;
        const pad = Math.max(2, Math.round(2 * dpr));
        let textX = x + pad + 2;
        if (textX + textWidth + pad * 2 > width) {
            textX = Math.max(0, x - textWidth - pad * 2 - 2);
        }

        ctx.fillStyle = 'rgba(0, 0, 0, 0.62)';
        ctx.fillRect(textX - pad, 0, textWidth + pad * 2, Math.max(9, topInset - 1));
        ctx.fillStyle = isLost
            ? 'rgba(255, 185, 110, 0.92)'
            : 'rgba(255, 238, 150, 0.98)';
        ctx.fillText(label, textX, 1);

        ctx.restore();
    }

    drawWaterfall(dataArray, _pingIntensity = 0, sampleRate = 0, fftSize = 0) {
        if (!this.waterfallDisplay || !this.waterfallDisplay.ctx) return;

        const theme = BTR_THEMES[this.currentWaterfallTheme].WATERFALL;
        const source = this.lofarSpectrum || dataArray;
        const sourceIsFloat = source instanceof Float32Array;
        const totalSamples = Math.floor(source.length * 0.8);
        const binHz = sampleRate > 0 && fftSize > 0 ? sampleRate / fftSize : 0;
        const maxFreqHz = totalSamples > 0 && binHz > 0 ? totalSamples * binHz : 0;

        this.waterfallDisplay.drawNextLine((ctx, width, _height, scanY) => {
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

            ctx.putImageData(imageData, 0, scanY);


        });
        this._drawWaterfallFrequencyScale(theme, maxFreqHz);
    }

    _drawWaterfallFrequencyScale(theme, maxFreqHz) {
        if (!this.waterfallDisplay || !this.waterfallDisplay.ctx || !this.waterfallDisplay.canvas) return;
        const ctx = this.waterfallDisplay.ctx;
        const width = this.waterfallDisplay.canvas.width;
        const topInset = this.waterfallDisplay.getTopInsetDevicePx
            ? this.waterfallDisplay.getTopInsetDevicePx()
            : 0;
        if (topInset <= 0 || !Number.isFinite(maxFreqHz) || maxFreqHz <= 0) return;

        const dpr = window.devicePixelRatio || 1;
        const tickStepCandidates = [100, 200, 500, 1000, 2000, 5000, 10000];
        let tickStep = tickStepCandidates[tickStepCandidates.length - 1];
        for (const candidate of tickStepCandidates) {
            if (maxFreqHz / candidate <= 8) {
                tickStep = candidate;
                break;
            }
        }

        const minorTick = Math.max(2, Math.round(2 * dpr));
        const majorTick = Math.max(4, Math.round(4 * dpr));

        ctx.save();
        ctx.fillStyle = 'rgba(0, 0, 0, 0.9)';
        ctx.fillRect(0, 0, width, topInset);

        ctx.strokeStyle = `rgba(${theme.high[0]}, ${theme.high[1]}, ${theme.high[2]}, 0.4)`;
        ctx.lineWidth = Math.max(1, dpr);
        ctx.beginPath();
        ctx.moveTo(0, topInset - 0.5);
        ctx.lineTo(width, topInset - 0.5);
        ctx.stroke();

        ctx.font = `${Math.max(7, Math.round(7 * dpr))}px "Share Tech Mono", monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';

        const majorStep = tickStep * 2;
        for (let hz = 0; hz <= maxFreqHz; hz += tickStep) {
            const x = (hz / maxFreqHz) * width;
            const isMajor = hz % majorStep === 0;
            const tickLen = isMajor ? majorTick : minorTick;
            const alpha = isMajor ? 0.78 : 0.38;
            ctx.strokeStyle = `rgba(${theme.high[0]}, ${theme.high[1]}, ${theme.high[2]}, ${alpha})`;
            ctx.beginPath();
            ctx.moveTo(x + 0.5, topInset - tickLen);
            ctx.lineTo(x + 0.5, topInset);
            ctx.stroke();

            const label = hz >= 1000
                ? `${Number.isInteger(hz / 1000) ? hz / 1000 : (hz / 1000).toFixed(1)}k`
                : `${hz}`;
            const labelAlpha = isMajor ? 0.88 : 0.62;
            ctx.fillStyle = `rgba(${theme.high[0]}, ${theme.high[1]}, ${theme.high[2]}, ${labelAlpha})`;
            ctx.fillText(label, x, 1);
        }
        ctx.restore();
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
