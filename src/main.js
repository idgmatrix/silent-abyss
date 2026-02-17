import { SimulationEngine } from './simulation.js';
import { AudioSystem } from './audio-system.js';
import { TacticalView } from './tactical-view.js';
import { SonarVisuals } from './sonar-visuals.js';
import { WorldModel } from './world-model.js';
import { WebGPUFFTProcessor } from './compute/webgpu-fft.js';
import { ContactManager } from './contact-manager.js';
import { DepthProfileDisplay } from './depth-profile-display.js';

// State
let currentRpmValue = 60;
let renderRequest = null;
let clockInterval = null;

// Subsystems
const audioSys = new AudioSystem();
const tacticalView = new TacticalView();
const sonarVisuals = new SonarVisuals();
const simEngine = new SimulationEngine();
const contactManager = new ContactManager({ lostTimeout: 10 });
const worldModel = new WorldModel(simEngine, tacticalView, {
    onTargetUpdate: (targets) => {
        targets.forEach(t => audioSys.updateTargetVolume(t.id, t.distance));
        audioSys.updateOwnShipFocusGain();
        tacticalView.updateTargetOpacities();
    },
    onScanUpdate: (radius, active) => {
        tacticalView.setScanExUniforms(radius, active);
    },
    onScanComplete: () => {
        window.dispatchEvent(new CustomEvent('sonar-scan-complete'));
    },
    onPingEcho: (volume, distance) => {
        audioSys.createPingEcho(volume, distance);
    },
    onSonarContact: (target, isPassive) => {
        tacticalView.updateTargetPosition(target.id, target.x, target.z, isPassive, target.speed);
        if (!isPassive) {
            window.dispatchEvent(new CustomEvent('sonar-contact', { detail: { id: target.id } }));
        }
    }
});
const depthProfileDisplay = new DepthProfileDisplay(worldModel.environment);
const webgpuFft = new WebGPUFFTProcessor({ fftSize: 1024, smoothing: 0.82 });

// UI Elements
let rpmDisplay, statusDisplay, rangeEl, velEl, brgEl, sigEl, classEl, targetIdEl, contactAlertEl, depthEl;
let contactListEl, contactFilterEl, contactSortEl, contactPinBtn, contactRelabelInput, contactRelabelBtn;
let contactClearLostBtn, solutionBearingInput, solutionRangeInput, solutionCourseInput, solutionSpeedInput;
let solutionSaveBtn, solutionConfidenceEl;

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
    contactListEl = document.getElementById('contact-list');
    contactFilterEl = document.getElementById('contact-filter');
    contactSortEl = document.getElementById('contact-sort');
    contactPinBtn = document.getElementById('contact-pin-btn');
    contactRelabelInput = document.getElementById('contact-relabel-input');
    contactRelabelBtn = document.getElementById('contact-relabel-btn');
    contactClearLostBtn = document.getElementById('contact-clear-lost');
    solutionBearingInput = document.getElementById('solution-bearing');
    solutionRangeInput = document.getElementById('solution-range');
    solutionCourseInput = document.getElementById('solution-course');
    solutionSpeedInput = document.getElementById('solution-speed');
    solutionSaveBtn = document.getElementById('solution-save-btn');
    solutionConfidenceEl = document.getElementById('solution-confidence');
}

function getTargetById(targetId) {
    return simEngine.targets.find((t) => t.id === targetId) || null;
}

function setSelectedTarget(targetId) {
    const normalized = targetId || null;
    worldModel.selectedTargetId = normalized;
    tacticalView.selectedTargetId = normalized;
    contactManager.setSelectedTarget(normalized);
    audioSys.setFocusedTarget(normalized);

    if (!normalized) {
        if (targetIdEl) targetIdEl.innerText = 'OWN-SHIP';
        if (solutionConfidenceEl) solutionConfidenceEl.innerText = 'CONF: --';
        return;
    }

    const target = getTargetById(normalized);
    const selectedContact = contactManager.getSelectedContact();
    if (target) {
        if (targetIdEl) {
            targetIdEl.innerText = selectedContact?.alias
                ? `${selectedContact.alias} (${selectedContact.label})`
                : selectedContact?.label || normalized.toUpperCase();
        }
        updateDashboard(target);
        populateManualSolutionInputs(target, selectedContact);
    }
}

function populateManualSolutionInputs(target, contact) {
    if (!solutionBearingInput || !solutionRangeInput || !solutionCourseInput || !solutionSpeedInput) return;

    const manual = contact?.manualSolution;
    if (manual) {
        solutionBearingInput.value = manual.bearing.toFixed(1);
        solutionRangeInput.value = manual.range.toFixed(0);
        solutionCourseInput.value = manual.course.toFixed(1);
        solutionSpeedInput.value = manual.speed.toFixed(1);
    } else if (target) {
        solutionBearingInput.value = target.bearing.toFixed(1);
        solutionRangeInput.value = (target.distance * 50).toFixed(0);
        solutionCourseInput.value = (((target.course * 180) / Math.PI + 360) % 360).toFixed(1);
        solutionSpeedInput.value = Math.abs(target.velocity * 20).toFixed(1);
    }

    if (solutionConfidenceEl) {
        const confidence = contact?.manualConfidence;
        solutionConfidenceEl.innerText = Number.isFinite(confidence) && confidence > 0
            ? `CONF: ${confidence}%`
            : 'CONF: --';
    }
}

function renderContactRegistry() {
    if (!contactListEl) return;
    const contacts = contactManager.getContacts({
        filterMode: contactFilterEl?.value,
        sortMode: contactSortEl?.value
    });

    if (contacts.length === 0) {
        contactListEl.innerHTML = '<div class="text-[9px] text-cyan-700">NO TRACKED CONTACTS</div>';
        return;
    }

    contactListEl.innerHTML = contacts.map((contact) => {
        const selectedClass = worldModel.selectedTargetId === contact.targetId ? ' selected' : '';
        const pin = contact.pinned ? 'PIN ' : '';
        const alias = contact.alias ? `${contact.alias} ` : '';
        const merge = contact.mergedGroupId ? ` ${contact.mergedGroupId}` : '';
        const confidence = contact.manualConfidence > 0 ? ` | CONF ${contact.manualConfidence}%` : '';
        return (
            `<button class="contact-item${selectedClass}" data-target-id="${contact.targetId}">` +
            `<div>${pin}${alias}${contact.label} | ${contact.status}${merge}</div>` +
            `<div class="meta">${contact.type} | BRG ${contact.bearing.toFixed(1)} | RNG ${contact.rangeMeters.toFixed(0)}m${confidence}</div>` +
            '</button>'
        );
    }).join('');
}

function bindContactUiHandlers() {
    if (contactFilterEl) {
        contactFilterEl.onchange = () => renderContactRegistry();
    }
    if (contactSortEl) {
        contactSortEl.onchange = () => renderContactRegistry();
    }

    if (contactListEl) {
        contactListEl.onclick = (event) => {
            if (!(event.target instanceof Element)) return;
            const button = event.target.closest('[data-target-id]');
            if (!button) return;
            const targetId = button.getAttribute('data-target-id');
            setSelectedTarget(targetId);
            renderContactRegistry();
        };
    }

    if (contactPinBtn) {
        contactPinBtn.onclick = () => {
            if (!worldModel.selectedTargetId) return;
            contactManager.togglePin(worldModel.selectedTargetId);
            renderContactRegistry();
        };
    }

    if (contactRelabelBtn) {
        contactRelabelBtn.onclick = () => {
            if (!worldModel.selectedTargetId || !contactRelabelInput) return;
            const result = contactManager.relabel(worldModel.selectedTargetId, contactRelabelInput.value);
            if (result.ok) {
                contactRelabelInput.value = '';
                setSelectedTarget(worldModel.selectedTargetId);
                renderContactRegistry();
            }
        };
    }

    if (contactClearLostBtn) {
        contactClearLostBtn.onclick = () => {
            const removedIds = contactManager.clearLostContacts();
            if (removedIds.includes(worldModel.selectedTargetId)) {
                setSelectedTarget(null);
            }
            renderContactRegistry();
        };
    }

    if (solutionSaveBtn) {
        solutionSaveBtn.onclick = () => {
            if (!worldModel.selectedTargetId) return;
            const target = getTargetById(worldModel.selectedTargetId);
            if (!target) return;

            const confidence = contactManager.setManualSolution(
                worldModel.selectedTargetId,
                {
                    bearing: solutionBearingInput?.value,
                    range: solutionRangeInput?.value,
                    course: solutionCourseInput?.value,
                    speed: solutionSpeedInput?.value
                },
                target
            );

            if (solutionConfidenceEl) {
                solutionConfidenceEl.innerText = Number.isFinite(confidence) ? `CONF: ${confidence}%` : 'CONF: --';
            }
            renderContactRegistry();
        };
    }
}

async function initSystems() {
    cacheDomElements();
    bindContactUiHandlers();
    depthProfileDisplay.environment = worldModel.environment;
    depthProfileDisplay.init('depth-profile-canvas');
    await webgpuFft.init();
    await audioSys.init();
    audioSys.setComputeProcessor(webgpuFft);
    sonarVisuals.setFFTProcessor(webgpuFft);
    audioSys.setRpm(currentRpmValue);
    worldModel.seedTargets();
    await tacticalView.init('tactical-viewport');
    sonarVisuals.init();

    // Initialize Targets in subsystems
    for (const target of simEngine.targets) {
        await audioSys.createTargetAudio(target);
        tacticalView.addTarget(target);
    }
    contactManager.update(simEngine.targets, worldModel.elapsedTime);
    renderContactRegistry();

    if (rpmDisplay) rpmDisplay.innerText = `${currentRpmValue} RPM`;
    const rpmSlider = document.getElementById('rpm-slider');
    if (rpmSlider) rpmSlider.value = currentRpmValue;

    const setupScreen = document.getElementById('setup-screen');
    const engineControls = document.getElementById('engine-controls');
    if (setupScreen) setupScreen.classList.add('hidden');
    if (engineControls) engineControls.classList.remove('hidden');

    simEngine.onTick = (targets, dt) => {
        worldModel.update(dt);
        contactManager.update(targets, worldModel.elapsedTime);
        renderContactRegistry();
        if (depthEl) {
            depthEl.innerText = `${worldModel.getOwnShipDepth().toFixed(0)}m`;
        }
    };

    simEngine.start(100);

    // Event listeners from worldModel
    window.addEventListener('sonar-contact', () => {
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
        depthProfileDisplay.resize();
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
    contactManager.reset();
    audioSys.dispose();
    tacticalView.dispose();
    sonarVisuals.dispose();
    webgpuFft.dispose();

    // Reset UI state
    document.getElementById('setup-screen').classList.remove('hidden');
    document.getElementById('engine-controls').classList.add('hidden');
    if (statusDisplay) statusDisplay.innerText = "SYSTEMS OFFLINE";
    renderContactRegistry();
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

    if (classEl) {
        if (target.classification && target.classification.confirmed) {
            classEl.innerText = target.classification.identifiedClass?.toUpperCase() || target.type;
            classEl.className = "text-green-500 font-bold";
        } else if (target.classification && target.classification.state === 'CLASSIFIED') {
            classEl.innerText = "ANALYZING...";
            classEl.className = "text-orange-400";
        } else {
            classEl.innerText = target.type;
            classEl.className = "text-white";
        }
    }

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
    if (worldModel.isScanning || !audioSys.getContext()) return;

    worldModel.triggerPing();
    audioSys.createPingTap(0.5, 1200, 900);

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
    const timeDomainData = audioSys.getTimeDomainData();
    const ctx = audioSys.getContext();

    const selectedTarget = worldModel.getSelectedTarget();
    const acousticContext = worldModel.getAcousticContextForTarget(selectedTarget);
    if (selectedTarget) {
        updateDashboard(selectedTarget);
    }

    depthProfileDisplay.render({
        ownDepth: worldModel.getOwnShipDepth(),
        targetDepth: acousticContext?.targetDepth,
        modifiers: acousticContext?.modifiers
    });

    if (ctx && data) {
        const activeRpm = selectedTarget ? selectedTarget.rpm : currentRpmValue;

        sonarVisuals.draw(
            data,
            simEngine.targets,
            activeRpm,
            worldModel.pingActiveIntensity,
            ctx.sampleRate,
            audioSys.analyser.fftSize,
            selectedTarget,
            timeDomainData
        );
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
    setSelectedTarget(e.detail.id);
    renderContactRegistry();
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
