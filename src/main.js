import { SimulationEngine, SimulationTarget } from './simulation.js';
import { AudioSystem } from './audio-system.js';
import { TacticalView } from './tactical-view.js';
import { SonarVisuals } from './sonar-visuals.js';
import { WorldModel } from './world-model.js';

// State
let currentRpmValue = 0;
let renderRequest = null;
let clockInterval = null;

// Subsystems
const audioSys = new AudioSystem();
const tacticalView = new TacticalView();
const sonarVisuals = new SonarVisuals();
const simEngine = new SimulationEngine();
const worldModel = new WorldModel(simEngine, audioSys, tacticalView, sonarVisuals);

// UI Elements
let rpmDisplay, statusDisplay, rangeEl, velEl, brgEl, sigEl, classEl, targetIdEl, contactAlertEl, depthEl;

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
    depthEl = document.querySelector('header div div span.text-white'); // Matches DEPTH display
}

async function initSystems() {
    cacheDomElements();
    await audioSys.init();
    worldModel.seedTargets();
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

    simEngine.onTick = (targets, dt) => {
        worldModel.update(dt);
        if (depthEl) {
            depthEl.innerText = `${worldModel.getOwnShipDepth().toFixed(0)}m`;
        }
    };

    simEngine.start(100);

    // Event listeners from worldModel
    window.addEventListener('sonar-contact', (e) => {
        if (contactAlertEl) contactAlertEl.classList.remove('hidden');
        setTimeout(() => {
            if(contactAlertEl) contactAlertEl.classList.add('hidden');
        }, 1000);
    });

    window.addEventListener('sonar-scan-complete', () => {
        if (statusDisplay) {
            statusDisplay.innerText = "PASSIVE MODE";
            statusDisplay.classList.remove('text-red-500');
            statusDisplay.classList.add('text-green-500');
        }
    });

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
    worldModel.triggerPing();

    if (statusDisplay) {
        statusDisplay.innerText = "ACTIVE PINGING";
        statusDisplay.classList.replace('text-green-500', 'text-red-500');
    }
}

function renderLoop(now) {
    renderRequest = requestAnimationFrame(renderLoop);

    // Update simulation
    simEngine.update(now);

    // Render Tactical View
    tacticalView.render(simEngine.targets, worldModel.ownShipCourse);

    // Render Visuals
    const data = audioSys.getFrequencyData();
    const ctx = audioSys.getContext();
    if (ctx && data) {
        const selectedTarget = worldModel.getSelectedTarget();
        const activeRpm = selectedTarget ? selectedTarget.rpm : currentRpmValue;

        sonarVisuals.draw(data, simEngine.targets, activeRpm, worldModel.pingActiveIntensity, ctx.sampleRate, audioSys.analyser.fftSize, selectedTarget);
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
    worldModel.selectedTargetId = e.detail.id;
    console.log("Target Selected:", worldModel.selectedTargetId);

    // Update Audio Focus
    audioSys.setFocusedTarget(worldModel.selectedTargetId);

    if (!worldModel.selectedTargetId) {
        if (targetIdEl) targetIdEl.innerText = "OWN-SHIP";
        return;
    }

    const target = simEngine.targets.find(t => t.id === worldModel.selectedTargetId);
    if (target) {
        if (targetIdEl) targetIdEl.innerText = worldModel.selectedTargetId.toUpperCase();
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
