import { ScrollingDisplay } from './scrolling-display.js';

export class SonarVisuals {
    constructor() {
        this.lCanvas = null;
        this.dCanvas = null;
        this.lCtx = null;
        this.dCtx = null;

        this.btrDisplay = null;
        this.waterfallDisplay = null;

        this.lastTargets = [];
    }

    init() {
        this.lCanvas = document.getElementById('lofar-canvas');
        this.dCanvas = document.getElementById('demon-canvas');

        if (this.lCanvas) this.lCtx = this.lCanvas.getContext('2d');
        if (this.dCanvas) this.dCtx = this.dCanvas.getContext('2d');

        this.btrDisplay = new ScrollingDisplay('btr-canvas');
        this.waterfallDisplay = new ScrollingDisplay('waterfall-canvas');

        if (this.btrDisplay.canvas) {
            this.btrDisplay.canvas.style.cursor = 'crosshair';
            this.btrDisplay.canvas.addEventListener('click', (e) => this.handleBTRClick(e));
        }

        this.resize();
        window.addEventListener('resize', () => this.resize());
    }

    resize() {
        // ... (existing code)
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
            if (!t.isPassivelyDetected && !t.detected) return;

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

    drawBTR(targets, currentRpm, pingIntensity) {
        if (!this.btrDisplay) return;

        this.btrDisplay.drawNextLine((ctx, width, height) => {
            // Background for the new line
            ctx.fillStyle = '#000000';
            ctx.fillRect(0, 0, width, 1);

            // Targets
            targets.forEach(target => {
                if (!target.isPassivelyDetected && pingIntensity <= 0) return;

                const targetX = (target.bearing / 360) * width;
                let targetIntensity = Math.min(255, target.passiveSNR * 40);

                // Boost intensity if target was recently detected by active sonar
                if (target.detected) {
                    targetIntensity = Math.max(targetIntensity, 200);
                }

                let color;
                switch(target.type) {
                    case 'SUBMARINE': color = `rgb(0, ${targetIntensity}, ${targetIntensity})`; break; // Cyan
                    case 'BIOLOGICAL': color = `rgb(0, ${targetIntensity}, 0)`; break; // Green
                    case 'STATIC': color = `rgb(${targetIntensity * 0.5}, ${targetIntensity * 0.5}, ${targetIntensity * 0.5})`; break; // Gray
                    default: color = `rgb(0, ${targetIntensity}, ${targetIntensity * 0.5})`; break; // Orange-ish Green (Existing)
                }

                ctx.fillStyle = color;
                ctx.fillRect(targetX - 1, 0, 3, 1);
            });

            // Self Noise
            const selfNoiseIntensity = (currentRpm / 400) * 100;
            if (selfNoiseIntensity > 5) {
                const centerBearing = 180;
                const spread = 40 + (currentRpm / 10);
                const selfX = (centerBearing / 360) * width;
                const selfW = (spread / 360) * width;
                ctx.fillStyle = `rgba(0, 100, 150, ${selfNoiseIntensity / 255})`;
                ctx.fillRect(selfX - selfW/2, 0, selfW, 1);

                // Add some noise across the whole spectrum
                ctx.fillStyle = `rgba(0, 80, 80, ${selfNoiseIntensity / 1000})`;
                ctx.fillRect(0, 0, width, 1);
            }

            // Ping Mask
            if (pingIntensity > 0) {
                ctx.fillStyle = `rgba(200, 255, 255, ${pingIntensity})`;
                ctx.fillRect(0, 0, width, 1);
            }
        });
    }

    drawWaterfall(dataArray) {
        if (!this.waterfallDisplay) return;

        this.waterfallDisplay.drawNextLine((ctx, width, height) => {
            const totalSamples = dataArray.length * 0.8;
            const bw = width / totalSamples;

            for(let i=0; i < totalSamples; i++) {
                const val = dataArray[i];
                if(val > 15) {
                    let r = val > 220 ? 255 : (val > 180 ? (val-180)*3 : 0);
                    let g = val * 0.7;
                    let b = val * 0.4;
                    ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
                    ctx.fillRect(i * bw, 0, bw + 1, 1);
                } else {
                    ctx.fillStyle = '#000';
                    ctx.fillRect(i * bw, 0, bw + 1, 1);
                }
            }
        });
    }
}
