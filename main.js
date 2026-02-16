import { SimulationEngine, SimulationTarget } from './simulation.js';
import { AudioSystem } from './audio-system.js';
import { TacticalView } from './tactical-view.js';
import { SonarVisuals } from './sonar-visuals.js';

// State
let isScanning = false;
let scanRadius = 0;
let currentRpmValue = 0;
let pingActiveIntensity = 0;
let selectedTargetId = null;
let renderRequest = null;
let clockInterval = null;

// Subsystems
const audioSys = new AudioSystem();
const tacticalView = new TacticalView();
const sonarVisuals = new SonarVisuals();
const simEngine = new SimulationEngine();

// Targets Setup
function seedTargets() {
    simEngine.targets = []; // Ensure clean state
    simEngine.addTarget(new SimulationTarget('target-01', {
        // Merchant Vessel (SHIP)
        x: -90,
        z: 30,
        course: 0.2,
        speed: 0.8,
        type: 'SHIP',
        rpm: 120,
        bladeCount: 3,
        isPatrolling: false
    }));

    simEngine.addTarget(new SimulationTarget('target-02', {
        // Stealthy Submarine (SUBMARINE)
        distance: 60,
        angle: Math.PI * 0.75,
        speed: 0.3,
        type: 'SUBMARINE',
        rpm: 80,
        bladeCount: 7,
        isPatrolling: true,
        patrolRadius: 80
    }));

    simEngine.addTarget(new SimulationTarget('target-03', {
        // Erratic Whale (BIOLOGICAL)
        distance: 40,
        angle: -Math.PI * 0.25,
        type: 'BIOLOGICAL',
        isPatrolling: true,
        patrolRadius: 30
    }));

    simEngine.addTarget(new SimulationTarget('target-04', {
        // Volcanic Vent (STATIC)
        x: 70,
        z: -80,
        type: 'STATIC',
        isPatrolling: false
    }));

    simEngine.addTarget(new SimulationTarget('target-05', {
        // School of biologicals
        distance: 110,
        angle: Math.PI * 0.4,
        type: 'BIOLOGICAL',
        isPatrolling: true,
        patrolRadius: 15
    }));

    simEngine.addTarget(new SimulationTarget('target-06', {
        // Derelict wreck
        x: -120,
        z: -40,
        type: 'STATIC',
        isPatrolling: false
    }));

    simEngine.addTarget(new SimulationTarget('target-07', {
        // Inbound Torpedo
        distance: 140,
        angle: Math.PI * 1.1,
        type: 'TORPEDO',
        isPatrolling: true,
        patrolRadius: 200,
        targetCourse: Math.PI * 2.1 // Move towards center-ish
    }));
}

// UI Elements
let rpmDisplay, statusDisplay, rangeEl, velEl, brgEl, sigEl, classEl, targetIdEl, contactAlertEl;

function cacheDomElements() {
    rpmDisplay = document.getElementById('rpm-display');
    statusDisplay = document.getElementById('tactical-status');
    rangeEl = document.getElementById('target-range-text');
    velEl = document.getElementById('target-vel-text');
    brgEl = document.getElementById('target-brg-text');
    sigEl = document.getElementById('sig-text');
    classEl = document.getElementById('target-class-text');
    targetIdEl = document.getElementById('target-id-text');
    contactAlertEl = document.getElementById('contact-alert');
}

async function initSystems() {
    cacheDomElements();
    await audioSys.init();
    seedTargets();
    tacticalView.init('tactical-viewport');
    sonarVisuals.init();

    // Initialize Targets in subsystems
    simEngine.targets.forEach(target => {
        audioSys.createTargetAudio(target);
        tacticalView.addTarget(target);
    });

    const setupScreen = document.getElementById('setup-screen');
    const engineControls = document.getElementById('engine-controls');
    if (setupScreen) setupScreen.classList.add('hidden');
    if (engineControls) engineControls.classList.remove('hidden');

    simEngine.onTick = (targets) => {
        // Update Passive Detection Logic (Moved from render loop)
        targets.forEach(target => {
            const sig = target.getAcousticSignature();
            // Path loss: Inverse square law (simplified for this sim)
            const snr = sig / (Math.pow(target.distance / 10, 1.5) + 1);
            target.passiveSNR = snr;
            target.isPassivelyDetected = snr > 1.5; // Detection threshold

            if (target.isPassivelyDetected) {
                tacticalView.updateTargetPosition(target.id, target.x, target.z, true);
            }
        });

        // Update Audio Distances
        targets.forEach(t => {
            audioSys.updateTargetVolume(t.id, t.distance);
        });

        // Update Dashboard with selected target or default to first target if none selected
        const targetToDisplay = selectedTargetId ? targets.find(t => t.id === selectedTargetId) : targets[0];
        if (targetToDisplay) {
            updateDashboard(targetToDisplay);
        }
    };

    simEngine.start(100);

    // Final layout sync after DOM updates
    setTimeout(() => {
        sonarVisuals.resize();
        tacticalView.resize();
    }, 50);

    // Theme selector
    const themeSelect = document.getElementById('btr-theme-select');
    if (themeSelect) {
        themeSelect.onchange = (e) => sonarVisuals.setTheme(e.target.value);
    }

    const waterfallThemeSelect = document.getElementById('waterfall-theme-select');
    if (waterfallThemeSelect) {
        waterfallThemeSelect.onchange = (e) => sonarVisuals.setWaterfallTheme(e.target.value);
    }

    const tacticalViewport = document.getElementById('tactical-viewport');
    if (tacticalViewport) {
        tacticalViewport.addEventListener('targetSelected', handleTargetSelected);
    }

    if (renderRequest) cancelAnimationFrame(renderRequest);
    renderRequest = requestAnimationFrame(renderLoop);

    // Ensure clock is running
    startClock();
}

window.cleanupSystems = () => {
    console.log("Cleaning up systems...");
    if (renderRequest) cancelAnimationFrame(renderRequest);
    if (clockInterval) clearInterval(clockInterval);

    const tacticalViewport = document.getElementById('tactical-viewport');
    if (tacticalViewport && handleTargetSelected) {
        tacticalViewport.removeEventListener('targetSelected', handleTargetSelected);
    }

    simEngine.dispose();
    audioSys.dispose();
    tacticalView.dispose();
    sonarVisuals.dispose();

    // Reset UI state
    document.getElementById('setup-screen').classList.remove('hidden');
    document.getElementById('engine-controls').classList.add('hidden');
    if (statusDisplay) statusDisplay.innerText = "SYSTEMS OFFLINE";
};

// Also cleanup on page unload
window.addEventListener('beforeunload', () => {
    window.cleanupSystems();
});

function updateDashboard(target) {
    if (!target) return;

    if (rangeEl) rangeEl.innerText = `${(target.distance * 50).toFixed(0)}m`;
    if (velEl) velEl.innerText = `${Math.abs(target.velocity * 20).toFixed(1)}kts`;
    if (brgEl) brgEl.innerText = `${target.bearing.toFixed(1)}° (T)`;
    if (classEl) classEl.innerText = target.type;

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
    renderRequest = requestAnimationFrame(renderLoop);

    // Update Scanning logic
    if (isScanning) {
        scanRadius += 1.5;
        tacticalView.setScanExUniforms(scanRadius, true);

        simEngine.targets.forEach(target => {
            if (scanRadius >= target.distance && !target.detected) {
                target.detected = true;
                audioSys.createPingTap(0.4, 1000, 980);

                tacticalView.updateTargetPosition(target.id, target.x, target.z);

                if (contactAlertEl) contactAlertEl.classList.remove('hidden');
                setTimeout(() => {
                    if(contactAlertEl) contactAlertEl.classList.add('hidden');
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
        const selectedTarget = simEngine.targets.find(t => t.id === selectedTargetId);
        const activeRpm = selectedTarget ? selectedTarget.rpm : currentRpmValue;

        sonarVisuals.draw(data, simEngine.targets, activeRpm, pingActiveIntensity, ctx.sampleRate, audioSys.analyser.fftSize, selectedTarget);
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
const handleTargetSelected = (e) => {
    selectedTargetId = e.detail.id;
    console.log("Target Selected:", selectedTargetId);

    // Update Audio Focus
    audioSys.setFocusedTarget(selectedTargetId);

    if (!selectedTargetId) {
        if (targetIdEl) targetIdEl.innerText = "OWN-SHIP";
        // Reset dashboard or show own-ship stats?
        // For now, let's just clear the display or show a default.
        return;
    }

    const target = simEngine.targets.find(t => t.id === selectedTargetId);
    if (target) {
        if (targetIdEl) targetIdEl.innerText = selectedTargetId.toUpperCase();
        updateDashboard(target);
    }
};

// Clock
function startClock() {
    if (clockInterval) clearInterval(clockInterval);
    clockInterval = setInterval(() => {
        const clock = document.getElementById('clock');
        if (clock) clock.innerText = new Date().toTimeString().split(' ')[0];
    }, 1000);
}

startClock();
