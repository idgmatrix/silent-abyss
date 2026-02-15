import { SimulationEngine, SimulationTarget } from './simulation.js';

const workletCode = `
    class SoundEngineProcessor extends AudioWorkletProcessor {
        constructor() {
            super();
            this.targetRpm = 0;
            this.currentRpm = 0;
            this.phase = 0;
            this.bladeCount = 5;
            this.sampleRate = 48000;
            this.lastNoise = 0; // For simple low-pass filter
            this.port.onmessage = (e) => {
                if (e.data.type === 'SET_RPM') this.targetRpm = e.data.value;
            };
        }
        process(inputs, outputs) {
            const output = outputs[0][0];
            if (!output) return true;
            for (let i = 0; i < output.length; i++) {
                this.currentRpm = this.currentRpm * 0.9997 + this.targetRpm * 0.0003;
                const activeRpm = this.currentRpm;

                if (activeRpm > 0.05) {
                    const baseFreq = (activeRpm / 60) * this.bladeCount;
                    const delta = (2 * Math.PI * baseFreq) / this.sampleRate;
                    this.phase = (this.phase + delta) % (2 * Math.PI);

                    // 1. Blade Thump (Fundamental + Harmonics)
                    const amplitude = Math.min(0.12, activeRpm / 200);
                    let harmonicSignal = Math.sin(this.phase) * 0.6;
                    harmonicSignal += Math.sin(this.phase * 2) * 0.2; // 2nd Harmonic
                    harmonicSignal += Math.sin(this.phase * 5) * 0.1; // Shaft frequency interaction

                    const thump = Math.pow(Math.abs(harmonicSignal), 0.8) * Math.sign(harmonicSignal);

                    // 2. Cavitation Noise (Filtered Noise)
                    // Cavitation gets stronger with higher RPM
                    const noiseRaw = (Math.random() * 2 - 1);
                    // Simple 1st order Low-pass filter to simulate water absorption and non-white noise
                    const filterAlpha = 0.15;
                    this.lastNoise = this.lastNoise + filterAlpha * (noiseRaw - this.lastNoise);

                    const cavitationIntensity = activeRpm > 180 ? (activeRpm - 180) / 400 : 0.01;
                    const noiseSignal = this.lastNoise * cavitationIntensity;

                    output[i] = (thump * amplitude * 0.8) + (noiseSignal * 0.5);
                } else {
                    output[i] = 0;
                    this.lastNoise = 0;
                }
            }
            return true;
        }
    }
    registerProcessor('sound-engine-processor', SoundEngineProcessor);
`;

let audioCtx, engineNode, engineGain, analyser, dataArray;\nlet scene, camera, renderer, terrain;\nconst targetAssets = new Map(); // Stores { audioGain, mesh } for each target
let isScanning = false;
let scanRadius = 0;
let currentRpmValue = 0;
let pingActiveIntensity = 0;

const simEngine = new SimulationEngine();
simEngine.addTarget(new SimulationTarget('target-01', {
    distance: 85,
    angle: Math.PI * 0.25,
    bearing: 45,
    velocity: -0.15,
    detected: false,
    rpm: 120,
    bladeCount: 3
}));
simEngine.addTarget(new SimulationTarget('target-02', {
    distance: 60,
    angle: Math.PI * 0.75,
    bearing: 135,
    velocity: 0.1,
    detected: false,
    rpm: 180,
    bladeCount: 5
}));

const lCanvas = document.getElementById('lofar-canvas');
const dCanvas = document.getElementById('demon-canvas');
const bCanvas = document.getElementById('btr-canvas');
const wCanvas = document.getElementById('waterfall-canvas');

const lCtx = lCanvas.getContext('2d');
const dCtx = dCanvas.getContext('2d');
const bCtx = bCanvas.getContext('2d');
const wCtx = wCanvas.getContext('2d');

const bTemp = document.createElement('canvas');
const wTemp = document.createElement('canvas');

function createTargetAudio(target) {
    const targetOsc = audioCtx.createOscillator();
    targetOsc.type = 'triangle';
    targetOsc.frequency.value = 40 + (Math.random() * 10); // Varied frequency

    const targetNoise = audioCtx.createBufferSource();
    const bSize = audioCtx.sampleRate * 2;
    const buffer = audioCtx.createBuffer(1, bSize, audioCtx.sampleRate);
    const dArr = buffer.getChannelData(0);
    for(let i=0; i<bSize; i++) dArr[i] = Math.random() * 2 - 1;
    targetNoise.buffer = buffer;
    targetNoise.loop = true;

    const targetFilter = audioCtx.createBiquadFilter();
    targetFilter.type = 'lowpass';
    targetFilter.frequency.value = 300 + (Math.random() * 200);

    const gain = audioCtx.createGain();
    gain.gain.value = 0.01;

    targetOsc.connect(targetFilter);
    targetNoise.connect(targetFilter);
    targetFilter.connect(gain).connect(analyser);

    targetOsc.start();
    targetNoise.start();
    return gain;
}

function createTargetMesh(target) {
    const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(1.5, 8, 8),
        new THREE.MeshBasicMaterial({ color: 0xff0000, transparent: true, opacity: 0 })
    );
    if (scene) scene.add(mesh);
    return mesh;
}

async function initSystems() {
    if (audioCtx) return;
    try {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const blob = new Blob([workletCode], { type: 'application/javascript' });
        await audioCtx.audioWorklet.addModule(URL.createObjectURL(blob));

        analyser = audioCtx.createAnalyser();
        analyser.fftSize = 2048;
        analyser.smoothingTimeConstant = 0.85; // Smoother display
        dataArray = new Uint8Array(analyser.frequencyBinCount);

        engineNode = new AudioWorkletNode(audioCtx, 'sound-engine-processor');
        engineGain = audioCtx.createGain();
        engineGain.gain.value = 0;
        engineNode.connect(engineGain).connect(analyser);
        engineGain.gain.linearRampToValueAtTime(1.0, audioCtx.currentTime + 0.5);

        simEngine.targets.forEach(target => {
            const assets = {
                audioGain: createTargetAudio(target),
                mesh: createTargetMesh(target)
            };
            targetAssets.set(target.id, assets);
        });

        initThreeJS();
        document.getElementById('setup-screen').classList.add('hidden');
        document.getElementById('engine-controls').classList.remove('hidden');
        resize();
        requestAnimationFrame(renderLoop);

        simEngine.onTick = updateTargetSimulation;
        simEngine.start(100);
    } catch (e) { console.error(e); }
}

function updateTargetSimulation(targets) {
    targets.forEach(target => {
        const assets = targetAssets.get(target.id);
        if (assets && assets.audioGain && audioCtx) {
            const vol = Math.max(0.005, (100 - target.distance) / 400) * 0.3;
            assets.audioGain.gain.setTargetAtTime(vol, audioCtx.currentTime, 0.1);
        }
    });

    // Update UI for the first target
    const target = targets[0];
    if (!target) return;

    const rangeEl = document.getElementById('target-range-text');
    const velEl = document.getElementById('target-vel-text');
    const brgEl = document.getElementById('target-brg-text');
    const sigEl = document.getElementById('sig-text');

    if (rangeEl) rangeEl.innerText = `${(target.distance * 50).toFixed(0)}m`;
    if (velEl) velEl.innerText = `${Math.abs(target.velocity * 20).toFixed(1)}kts`;
    if (brgEl) brgEl.innerText = `${target.bearing.toFixed(1)}°`;

    if (target.distance < 50) {
        sigEl.innerText = "HIGH";
        sigEl.className = "text-red-500 font-bold text-sm animate-pulse";
    } else {
        sigEl.innerText = "TRACKING";
        sigEl.className = "text-orange-400 font-bold text-sm";
    }
}

function initThreeJS() {
    const container = document.getElementById('sonar-viewport');
    if (!container) return;
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(60, container.clientWidth / container.clientHeight, 0.1, 1000);
    camera.position.set(0, 50, 80);
    camera.lookAt(0, 0, 0);
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(container.clientWidth, container.clientHeight);
    container.appendChild(renderer.domElement);

    const mat = new THREE.ShaderMaterial({
        uniforms: {
            uScanRadius: { value: 0 },
            uColor: { value: new THREE.Color(0x004444) },
            uActive: { value: 0.0 }
        },
        vertexShader: `varying float vDist; void main() { vDist = length(position.xz); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: `
            uniform float uScanRadius;
            uniform vec3 uColor;
            uniform float uActive;
            varying float vDist;
            void main() {
                float ring = smoothstep(uScanRadius - 10.0, uScanRadius, vDist) * (1.0 - smoothstep(uScanRadius, uScanRadius + 0.5, vDist));
                if(uActive < 0.5) discard;
                gl_FragColor = vec4(uColor * (0.1 + ring * 5.0), ring);
            }`,
        transparent: true, wireframe: true
    });
    terrain = new THREE.Mesh(new THREE.PlaneGeometry(200, 200, 30, 30).rotateX(-Math.PI/2), mat);
    scene.add(terrain);

    // Add meshes for any targets already initialized
    simEngine.targets.forEach(target => {
        const assets = targetAssets.get(target.id);
        if (assets && !assets.mesh) {
            assets.mesh = createTargetMesh(target);
        } else if (assets && assets.mesh) {
            scene.add(assets.mesh);
        }
    });

    scene.add(new THREE.GridHelper(200, 20, 0x002222, 0x001111));
}

function triggerPing() {
    if (isScanning || !audioCtx) return;
    isScanning = true; scanRadius = 0;
    pingActiveIntensity = 1.0;
    terrain.material.uniforms.uActive.value = 1.0;
    const status = document.getElementById('tactical-status');
    if (status) {
        status.innerText = "ACTIVE PINGING";
        status.classList.replace('text-green-500', 'text-red-500');
    }
    createPingTap(audioCtx.currentTime, 0.5, 1200, 900);
}

function createPingTap(time, vol, start, end) {
    if (!audioCtx) return;
    const osc = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    osc.connect(g).connect(analyser);
    osc.frequency.setValueAtTime(start, time);
    osc.frequency.exponentialRampToValueAtTime(end, time + 0.1);
    g.gain.setValueAtTime(0, time);
    g.gain.linearRampToValueAtTime(vol, time + 0.02);
    g.gain.linearRampToValueAtTime(0, time + 1.2);
    osc.start(time); osc.stop(time + 1.3);
}

function renderLoop() {
    requestAnimationFrame(renderLoop);

    if (isScanning && terrain) {
        scanRadius += 1.5;
        terrain.material.uniforms.uScanRadius.value = scanRadius;

        simEngine.targets.forEach(target => {
            if (scanRadius >= target.distance && !target.detected) {
                target.detected = true;
                createPingTap(audioCtx.currentTime, 0.4, 1000, 980);
                
                const assets = targetAssets.get(target.id);
                if (assets && assets.mesh) {
                    assets.mesh.position.set(
                        Math.cos(target.angle) * target.distance,
                        1,
                        Math.sin(target.angle) * target.distance
                    );
                    assets.mesh.material.opacity = 1;
                }

                const alert = document.getElementById('contact-alert');
                if (alert) alert.classList.remove('hidden');
                setTimeout(() => {
                    const alertEl = document.getElementById('contact-alert');
                    if(alertEl) alertEl.classList.add('hidden');
                }, 1000);
            }
        });

        if (scanRadius > 150) {
            isScanning = false;
            simEngine.targets.forEach(t => t.detected = false);
            pingActiveIntensity = 0;
            terrain.material.uniforms.uActive.value = 0.0;
            const status = document.getElementById('tactical-status');
            if (status) {
                status.innerText = "PASSIVE MODE";
                status.classList.remove('text-red-500');
                status.classList.add('text-green-500');
            }
        }
    }

    // Update target mesh opacities and positions (even when not scanning, though position only updates on ping)
    targetAssets.forEach((assets) => {
        if (assets.mesh && assets.mesh.material.opacity > 0) {
            assets.mesh.material.opacity *= 0.98;
        }
    });

    if (analyser && dataArray) {
        analyser.getByteFrequencyData(dataArray);
        drawLOFAR();
        drawDEMON();
        drawBTR();
        drawWaterfall();
    }
    if(renderer && scene && camera) renderer.render(scene, camera);
}

function drawLOFAR() {
    if (!lCtx || !lCanvas) return;
    lCtx.fillStyle = 'rgba(0, 5, 10, 0.9)';
    lCtx.fillRect(0, 0, lCanvas.width, lCanvas.height);

    // Grid lines
    lCtx.strokeStyle = 'rgba(0, 255, 204, 0.05)';
    lCtx.beginPath();
    for(let i=1; i<10; i++) {
        lCtx.moveTo(i * lCanvas.width/10, 0);
        lCtx.lineTo(i * lCanvas.width/10, lCanvas.height);
    }
    lCtx.stroke();

    lCtx.beginPath();
    lCtx.strokeStyle = '#00ffcc';
    lCtx.lineWidth = 1.2;
    const viewLength = dataArray.length * 0.7; // Limit high frequency view
    for(let i=0; i<viewLength; i++) {
        const x = (i / viewLength) * lCanvas.width;
        // LOFAR typically shows logarithmic or filtered power
        const h = (dataArray[i] / 255) * lCanvas.height;
        if(i===0) lCtx.moveTo(x, lCanvas.height - h);
        else lCtx.lineTo(x, lCanvas.height - h);
    }
    lCtx.stroke();

    // Labeling peak harmonics if RPM > 0
    if (currentRpmValue > 50) {
        const baseFreqIdx = Math.floor(((currentRpmValue / 60) * 5) / (audioCtx.sampleRate / analyser.fftSize));
        if (baseFreqIdx < viewLength) {
            const x = (baseFreqIdx / viewLength) * lCanvas.width;
            lCtx.fillStyle = 'rgba(0, 255, 204, 0.5)';
            lCtx.fillText("RPM PEAK", x + 2, lCanvas.height - 10);
        }
    }
}

function drawDEMON() {
    if (!dCtx || !dCanvas) return;
    dCtx.fillStyle = 'rgba(0, 5, 10, 0.8)';
    dCtx.fillRect(0, 0, dCanvas.width, dCanvas.height);
    dCtx.strokeStyle = '#ffaa00';
    dCtx.lineWidth = 2;
    const segments = 5;
    const spacing = dCanvas.width / (segments + 1);
    for(let j=1; j<=segments; j++) {
        const peakX = j * spacing;
        // Use low frequency bins for DEMON visualization
        const val = dataArray[j * 2] + (Math.random() * 20);
        const intensity = (val / 255) * dCanvas.height * 0.7;
        dCtx.beginPath();
        dCtx.moveTo(peakX, dCanvas.height);
        dCtx.lineTo(peakX, dCanvas.height - intensity);
        dCtx.stroke();
    }
    dCtx.fillStyle = '#00ffff';
    dCtx.font = '9px Arial';
    dCtx.fillText(`AUTO-ANALYSIS: ${currentRpmValue > 0 ? 'ENGINE ACTIVE' : 'IDLE'}`, 10, 15);
}

function drawBTR() {
    if (!bCtx || !bCanvas || !bTemp) return;
    const btCtx = bTemp.getContext('2d');
    btCtx.clearRect(0, 0, bTemp.width, bTemp.height);
    btCtx.drawImage(bCanvas, 0, 0);
    bCtx.clearRect(0, 0, bCanvas.width, bCanvas.height);
    bCtx.drawImage(bTemp, 0, 1);

    bCtx.fillStyle = '#00';
    bCtx.fillRect(0, 0, bCanvas.width, 1);

    simEngine.targets.forEach(target => {
        const targetX = (target.bearing / 360) * bCanvas.width;
        const targetIntensity = Math.max(0, 255 - target.distance * 2);
        bCtx.fillStyle = `rgb(0, ${targetIntensity}, ${targetIntensity * 0.5})`;
        bCtx.fillRect(targetX - 1, 0, 3, 1);
    });

    const selfNoiseIntensity = (currentRpmValue / 400) * 100;
    if (selfNoiseIntensity > 5) {
        const centerBearing = 180;
        const spread = 40 + (currentRpmValue / 10);
        const selfX = (centerBearing / 360) * bCanvas.width;
        const selfW = (spread / 360) * bCanvas.width;
        bCtx.fillStyle = `rgba(0, 100, 150, ${selfNoiseIntensity / 255})`;
        bCtx.fillRect(selfX - selfW/2, 0, selfW, 1);

        bCtx.fillStyle = `rgba(0, 80, 80, ${selfNoiseIntensity / 1000})`;
        bCtx.fillRect(0, 0, bCanvas.width, 1);
    }

    if (pingActiveIntensity > 0) {
        bCtx.fillStyle = `rgba(200, 255, 255, ${pingActiveIntensity})`;
        bCtx.fillRect(0, 0, bCanvas.width, 1);
        pingActiveIntensity *= 0.85;
    }
}

function drawWaterfall() {
    if (!wCtx || !wCanvas || !wTemp) return;
    const wtCtx = wTemp.getContext('2d');
    wtCtx.clearRect(0, 0, wTemp.width, wTemp.height);
    wtCtx.drawImage(wCanvas, 0, 0);
    wCtx.clearRect(0, 0, wCanvas.width, wCanvas.height);
    wCtx.drawImage(wTemp, 0, 1);
    const totalSamples = dataArray.length * 0.8;
    const bw = wCanvas.width / totalSamples;
    for(let i=0; i < totalSamples; i++) {
        const val = dataArray[i];
        if(val > 15) {
            let r = val > 220 ? 255 : (val > 180 ? (val-180)*3 : 0);
            let g = val * 0.7;
            let b = val * 0.4;
            wCtx.fillStyle = `rgb(${r}, ${g}, ${b})`;
            wCtx.fillRect(i * bw, 0, bw + 1, 1);
        } else {
            wCtx.fillStyle = '#000';
            wCtx.fillRect(i * bw, 0, bw + 1, 1);
        }
    }
}

function resize() {
    if (!renderer || !camera) return;
    const dpr = window.devicePixelRatio || 1;
    const v = document.getElementById('sonar-viewport');
    if (!v) return;
    renderer.setSize(v.clientWidth, v.clientHeight);
    camera.aspect = v.clientWidth / v.clientHeight;
    camera.updateProjectionMatrix();
    [lCanvas, dCanvas, bCanvas, wCanvas].forEach(c => {
        if(c) {
            c.width = c.clientWidth * dpr;
            c.height = c.clientHeight * dpr;
        }
    });
    bTemp.width = bCanvas.width; bTemp.height = bCanvas.height;
    wTemp.width = wCanvas.width; wTemp.height = wCanvas.height;
}

window.addEventListener('resize', resize);
document.getElementById('start-btn').onclick = initSystems;
document.getElementById('ping-btn').onclick = triggerPing;

document.getElementById('rpm-slider').oninput = (e) => {
    const rpm = parseFloat(e.target.value);
    currentRpmValue = rpm;
    document.getElementById('rpm-display').innerText = `${rpm} RPM`;
    if (engineNode) {
        engineNode.port.postMessage({ type: 'SET_RPM', value: rpm });
    }
};

setInterval(() => {
    const clock = document.getElementById('clock');
    if (clock) clock.innerText = new Date().toTimeString().split(' ')[0];
}, 1000);
