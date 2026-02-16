import { SimulationEngine, SimulationTarget } from './simulation.js';
import { AudioSystem } from './audio-system.js';
import { TacticalView } from './tactical-view.js';
import { SonarVisuals } from './sonar-visuals.js';

// State
let isScanning = false;
let scanRadius = 0;
let currentRpmValue = 0;
let pingActiveIntensity = 0;

// Subsystems
const audioSys = new AudioSystem();
const tacticalView = new TacticalView();
const sonarVisuals = new SonarVisuals();
const simEngine = new SimulationEngine();

// Targets Setup
simEngine.addTarget(new SimulationTarget('target-01', {
    // Crossing target (West to East). Coordinates: x (+East/-West), z (+South/-North)
    x: -90,
    z: 30,
    course: 0.2, // Radians. 0 = East.
    speed: 0.8,  // ~16 kts
    turnRate: 0.05,
    detected: false,
    rpm: 120,
    bladeCount: 3,
    isPatrolling: false,
    patrolRadius: 100
}));
simEngine.addTarget(new SimulationTarget('target-02', {
    // Patrolling target
    distance: 60,
    angle: Math.PI * 0.75,
    speed: 0.5, // ~10 kts
    turnRate: 0.15,
    detected: false,
    rpm: 180,
    bladeCount: 5,
    isPatrolling: true,
    patrolRadius: 80
}));

// UI Elements
const rpmDisplay = document.getElementById('rpm-display');
const statusDisplay = document.getElementById('tactical-status');

async function initSystems() {
    await audioSys.init();
    tacticalView.init('tactical-viewport');
    sonarVisuals.init();

    // Initialize Targets in subsystems
    simEngine.targets.forEach(target => {
        audioSys.createTargetAudio(target.id);
        tacticalView.addTarget(target.id);
    });

    document.getElementById('setup-screen').classList.add('hidden');
    document.getElementById('engine-controls').classList.remove('hidden');

    simEngine.onTick = (targets) => {
        // Update Audio Distances
        targets.forEach(t => {
            audioSys.updateTargetVolume(t.id, t.distance);
        });
        updateDashboard(targets[0]);
    };

    simEngine.start(100);

    // Final layout sync after DOM updates
    setTimeout(() => {
        sonarVisuals.resize();
        tacticalView.resize();
    }, 50);

    requestAnimationFrame(renderLoop);
}

function updateDashboard(target) {
    if (!target) return;
    const rangeEl = document.getElementById('target-range-text');
    const velEl = document.getElementById('target-vel-text');
    const brgEl = document.getElementById('target-brg-text');
    const sigEl = document.getElementById('sig-text');

    if (rangeEl) rangeEl.innerText = `${(target.distance * 50).toFixed(0)}m`;
    if (velEl) velEl.innerText = `${Math.abs(target.velocity * 20).toFixed(1)}kts`;
    if (brgEl) brgEl.innerText = `${target.bearing.toFixed(1)}° (T)`;

    if (target.distance < 50) {
        if(sigEl) {
            sigEl.innerText = "HIGH";
            sigEl.className = "text-red-500 font-bold text-sm animate-pulse";
        }
    } else {
        if(sigEl) {
            sigEl.innerText = "TRACKING";
            sigEl.className = "text-orange-400 font-bold text-sm";
        }
    }
}

function triggerPing() {
    if (isScanning || !audioSys.getContext()) return;
    isScanning = true;
    scanRadius = 0;
    pingActiveIntensity = 1.0;

    tacticalView.setScanExUniforms(0, true);

    if (statusDisplay) {
        statusDisplay.innerText = "ACTIVE PINGING";
        statusDisplay.classList.replace('text-green-500', 'text-red-500');
    }

    audioSys.createPingTap(0.5, 1200, 900);
}

function renderLoop() {
    requestAnimationFrame(renderLoop);

    // Update Scanning logic
    if (isScanning) {
        scanRadius += 1.5;
        tacticalView.setScanExUniforms(scanRadius, true);

        simEngine.targets.forEach(target => {
            if (scanRadius >= target.distance && !target.detected) {
                target.detected = true;
                audioSys.createPingTap(0.4, 1000, 980);

                tacticalView.updateTargetPosition(target.id, target.x, target.z);

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
            tacticalView.setScanExUniforms(scanRadius, false);

            if (statusDisplay) {
                statusDisplay.innerText = "PASSIVE MODE";
                statusDisplay.classList.remove('text-red-500');
                statusDisplay.classList.add('text-green-500');
            }
        }
    }

    // Decay visual intensity
    if (pingActiveIntensity > 0) {
        pingActiveIntensity *= 0.85;
    }
    tacticalView.updateTargetOpacities();

    // Render Tactical View
    const ownShipCourse = (performance.now() / 10000) * Math.PI * 2;
    tacticalView.render(simEngine.targets, ownShipCourse);

    // Render Visuals
    const data = audioSys.getFrequencyData();
    const ctx = audioSys.getContext();
    if (ctx && data) {
         sonarVisuals.draw(data, simEngine.targets, currentRpmValue, pingActiveIntensity, ctx.sampleRate, audioSys.analyser.fftSize);
    }
}

// Event Listeners
document.getElementById('start-btn').onclick = initSystems;
document.getElementById('ping-btn').onclick = triggerPing;

document.getElementById('rpm-slider').oninput = (e) => {
    const rpm = parseFloat(e.target.value);
    currentRpmValue = rpm;
    if(rpmDisplay) rpmDisplay.innerText = `${rpm} RPM`;
    audioSys.setRpm(rpm);
};

// View Mode Switching
document.querySelectorAll('input[name="view-mode"]').forEach(el => {
    el.onchange = (e) => {
        tacticalView.setViewMode(e.target.value);
    };
});

// Target Selection
document.getElementById('tactical-viewport').addEventListener('targetSelected', (e) => {
    const targetId = e.detail.id;
    console.log("Target Selected:", targetId);
    const target = simEngine.targets.find(t => t.id === targetId);
    if (target) {
        const targetIdEl = document.getElementById('target-id-text');
        if (targetIdEl) targetIdEl.innerText = targetId.toUpperCase();
        updateDashboard(target);
    }
});

// Clock
setInterval(() => {
    const clock = document.getElementById('clock');
    if (clock) clock.innerText = new Date().toTimeString().split(' ')[0];
}, 1000);
