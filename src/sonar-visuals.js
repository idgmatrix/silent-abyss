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
    constructor() {
        this.lCanvas = null;
        this.dCanvas = null;
        this.lCtx = null;
        this.dCtx = null;

        this.btrDisplay = null;
        this.waterfallDisplay = null;

        this.lastTargets = [];
        this.currentTheme = 'CYAN';
        this.currentWaterfallTheme = 'CYAN';
    }

    init() {
        if (this.lCanvas) return; // Already initialized

        this.lCanvas = document.getElementById('lofar-canvas');
        this.dCanvas = document.getElementById('demon-canvas');

        if (this.lCanvas) this.lCtx = this.lCanvas.getContext('2d');
        if (this.dCanvas) this.dCtx = this.dCanvas.getContext('2d');

        this.btrDisplay = new ScrollingDisplay('btr-canvas');
        this.btrDisplay.setDecayRate(0.005); // Very slow decay for BTR

        this.waterfallDisplay = new ScrollingDisplay('waterfall-canvas');
        this.waterfallDisplay.setDecayRate(0.002); // Even slower for Waterfall to show long history

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

    draw(dataArray, targets, currentRpm, pingIntensity, sampleRate, fftSize, selectedTarget = null) {
        if (!dataArray) return;
        this.lastTargets = targets;
        this.drawLOFAR(dataArray, currentRpm, sampleRate, fftSize, selectedTarget);
        this.drawDEMON(dataArray, currentRpm, selectedTarget);
        this.drawBTR(targets, currentRpm, pingIntensity);
        this.drawWaterfall(dataArray);
    }

    drawLOFAR(dataArray, currentRpm, sampleRate, fftSize, selectedTarget) {
        if (!this.lCtx || !this.lCanvas) return;
        const ctx = this.lCtx;
        const cvs = this.lCanvas;

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
        const viewLength = dataArray.length * 0.7; // Limit high frequency view
        for(let i=0; i<viewLength; i++) {
            const x = (i / viewLength) * cvs.width;
            const h = (dataArray[i] / 255) * cvs.height;
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
    }

    drawDEMON(dataArray, currentRpm, selectedTarget) {
        if (!this.dCtx || !this.dCanvas) return;
        const ctx = this.dCtx;
        const cvs = this.dCanvas;

        ctx.fillStyle = 'rgba(0, 5, 10, 0.8)';
        ctx.fillRect(0, 0, cvs.width, cvs.height);
        ctx.strokeStyle = selectedTarget ? '#ff3333' : '#ffaa00';
        ctx.lineWidth = 2;
        const segments = 5;
        const spacing = cvs.width / (segments + 1);
        for(let j=1; j<=segments; j++) {
            const peakX = j * spacing;
            const val = dataArray[j * 2] + (Math.random() * 20);
            const intensity = (val / 255) * cvs.height * 0.7;
            ctx.beginPath();
            ctx.moveTo(peakX, cvs.height);
            ctx.lineTo(peakX, cvs.height - intensity);
            ctx.stroke();
        }
        ctx.fillStyle = selectedTarget ? '#ff3333' : '#00ffff';
        ctx.font = '9px Arial';
        const label = selectedTarget ? `TARGET ANALYSIS: ${selectedTarget.type} (T${selectedTarget.id.split('-')[1]})` : `AUTO-ANALYSIS: ${currentRpm > 0 ? 'ENGINE ACTIVE' : 'IDLE'}`;
        ctx.fillText(label, 10, 15);
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

        this.btrDisplay.drawNextLine((ctx, width, height) => {
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

        const ctx = this.waterfallDisplay.ctx;
        const width = this.waterfallDisplay.canvas.width;
        const theme = BTR_THEMES[this.currentWaterfallTheme].WATERFALL;

        this.waterfallDisplay.drawNextLine((ctx, width, height) => {
            const totalSamples = Math.floor(dataArray.length * 0.8);
            const imageData = ctx.createImageData(width, 1);
            const data = imageData.data;

            // Cache colors to avoid overhead in loop
            const low = theme.low;
            const mid = theme.mid;
            const high = theme.high;

            for (let x = 0; x < width; x++) {
                const sampleIdx = Math.floor((x / width) * totalSamples);
                const val = dataArray[sampleIdx];
                const i = x * 4;

                if (val > 15) {
                    const norm = val / 255;
                    let r, g, b;

                    if (norm < 0.5) {
                        const t = norm * 2;
                        r = low[0] * (1 - t) + mid[0] * t;
                        g = low[1] * (1 - t) + mid[1] * t;
                        b = low[2] * (1 - t) + mid[2] * t;
                    } else {
                        const t = (norm - 0.5) * 2;
                        r = mid[0] * (1 - t) + high[0] * t;
                        g = mid[1] * (1 - t) + high[1] * t;
                        b = mid[2] * (1 - t) + high[2] * t;
                    }

                    data[i] = r | 0;
                    data[i + 1] = g | 0;
                    data[i + 2] = b | 0;
                    data[i + 3] = 255;
                } else {
                    data[i] = 0;
                    data[i + 1] = 0;
                    data[i + 2] = 0;
                    data[i + 3] = 255;
                }
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
    }
}
