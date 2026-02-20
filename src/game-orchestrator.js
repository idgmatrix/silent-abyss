import { SimulationEngine } from './simulation.js';
import { AudioSystem } from './audio-system.js';
import { TacticalView } from './tactical-view.js';
import { SonarVisuals } from './sonar-visuals.js';
import { WorldModel } from './world-model.js';
import { WebGPUFFTProcessor } from './compute/webgpu-fft.js';
import { ContactManager } from './contact-manager.js';
import { DepthProfileDisplay } from './depth-profile-display.js';
import { CampaignManager } from './campaign-manager.js';
import { CAMPAIGN_MISSIONS } from './data/missions.js';
import { UIManager } from './ui-manager.js';

export class GameOrchestrator {
    constructor() {
        // State
        this.currentRpmValue = 60;
        this.renderRequest = null;

        // Reusable render context objects to avoid GC pressure
        this.depthRenderContext = {
            ownDepth: 0,
            targetDepth: 0,
            modifiers: null
        };

        this.sonarDrawOptions = {
            ownShipSignature: { rpm: 0, bladeCount: 0, bpfHz: 0 },
            sourceMode: 'COMPOSITE',
            pingTransient: { active: false, recent: false, sinceLastPing: Infinity },
            pingEchoes: [],
            ownShipCourseRad: 0
        };

        // Subsystems
        this.audioSys = new AudioSystem();
        this.tacticalView = new TacticalView();
        this.sonarVisuals = new SonarVisuals();
        this.simEngine = new SimulationEngine();
        this.contactManager = new ContactManager({ lostTimeout: 10 });
        this.campaignManager = new CampaignManager(CAMPAIGN_MISSIONS);

        this.worldModel = new WorldModel(this.simEngine, this.tacticalView, {
            onTargetUpdate: (targets) => {
                targets.forEach(t => this.audioSys.updateTargetVolume(t.id, t.distance));
                this.audioSys.updateOwnShipFocusGain();
                this.tacticalView.updateTargetOpacities();
            },
            onScanUpdate: (radius, active) => {
                this.tacticalView.setScanExUniforms(radius, active);
            },
            onScanComplete: () => {
                window.dispatchEvent(new CustomEvent('sonar-scan-complete'));
            },
            onPingEcho: (volume, distance) => {
                this.audioSys.createPingEcho(volume, distance);
            },
            onSonarContact: (target, isPassive) => {
                this.tacticalView.updateTargetPosition(target.id, target.x, target.z, isPassive, target.speed);
                if (!isPassive) {
                    window.dispatchEvent(new CustomEvent('sonar-contact', { detail: { id: target.id } }));
                }
            }
        });

        this.depthProfileDisplay = new DepthProfileDisplay(this.worldModel.environment);
        this.webgpuFft = new WebGPUFFTProcessor({ fftSize: 1024, smoothing: 0.82 });

        // UI Manager
        this.uiManager = new UIManager(this);

        // Bind loop
        this.renderLoop = this.renderLoop.bind(this);
        this.handleTargetSelected = this.handleTargetSelected.bind(this);
    }

    async init() {
        this.uiManager.init();
        this.campaignManager.load();
        this.uiManager.renderCampaignPanel();

        this.depthProfileDisplay.environment = this.worldModel.environment;
        this.depthProfileDisplay.init('depth-profile-canvas');

        await this.webgpuFft.init();
        await this.audioSys.init();

        this.audioSys.setComputeProcessor(this.webgpuFft);
        this.sonarVisuals.setFFTProcessor(this.webgpuFft);
        this.audioSys.setRpm(this.currentRpmValue);

        this.worldModel.seedTargets();
        await this.tacticalView.init('tactical-viewport');
        this.sonarVisuals.init();

        // Initialize Targets in subsystems
        for (const target of this.simEngine.targets) {
            await this.audioSys.createTargetAudio(target);
            this.tacticalView.addTarget(target);
        }

        this.contactManager.update(this.simEngine.targets, this.worldModel.elapsedTime);
        this.uiManager.renderContactRegistry();

        const rpmDisplay = document.getElementById('rpm-display');
        if (rpmDisplay) rpmDisplay.innerText = `${this.currentRpmValue} RPM`;

        const rpmSlider = document.getElementById('rpm-slider');
        if (rpmSlider) rpmSlider.value = this.currentRpmValue;

        const setupScreen = document.getElementById('setup-screen');
        const engineControls = document.getElementById('engine-controls');
        if (setupScreen) setupScreen.classList.add('hidden');
        if (engineControls) engineControls.classList.remove('hidden');

        this.uiManager.setupLeftSonarPanelHeightSync();

        this.simEngine.onTick = (targets, dt) => {
            this.worldModel.update(dt);
            this.contactManager.update(targets, this.worldModel.elapsedTime);

            const selectedTarget = this.worldModel.getSelectedTarget();
            const selectedAcousticContext = this.worldModel.getAcousticContextForTarget(selectedTarget);

            this.campaignManager.evaluate({
                targets,
                contacts: this.contactManager.getContacts(),
                selectedTargetId: this.worldModel.selectedTargetId,
                selectedTarget,
                selectedAcousticContext,
                elapsedTime: this.worldModel.elapsedTime
            });

            this.uiManager.renderContactRegistry();
            this.uiManager.renderCampaignPanel();
            this.uiManager.updateOwnShipStatus();
        };

        this.simEngine.start(100);

        // Event listeners from worldModel
        window.addEventListener('sonar-contact', () => {
            const contactAlertEl = document.getElementById('contact-alert');
            if (contactAlertEl) contactAlertEl.classList.remove('hidden');
            setTimeout(() => {
                if(contactAlertEl) contactAlertEl.classList.add('hidden');
            }, 1000);
        });

        window.addEventListener('sonar-scan-complete', () => {
            this.uiManager.updateStatusDisplay("PASSIVE MODE", "text-green-500");
        });

        // Final layout sync after DOM updates
        setTimeout(() => {
            this.uiManager.syncLeftSonarPanelHeights();
            this.sonarVisuals.resize();
            this.tacticalView.resize();
            this.depthProfileDisplay.resize();
        }, 50);

        const tacticalViewport = document.getElementById('tactical-viewport');
        if (tacticalViewport) {
            tacticalViewport.addEventListener('targetSelected', this.handleTargetSelected);
        }

        if (this.renderRequest) cancelAnimationFrame(this.renderRequest);
        this.renderRequest = requestAnimationFrame(this.renderLoop);
    }

    stop() {
        console.log("Cleaning up systems...");
        if (this.renderRequest) cancelAnimationFrame(this.renderRequest);

        const tacticalViewport = document.getElementById('tactical-viewport');
        if (tacticalViewport) {
            tacticalViewport.removeEventListener('targetSelected', this.handleTargetSelected);
        }

        this.simEngine.dispose();
        this.contactManager.reset();
        this.audioSys.dispose();
        this.tacticalView.dispose();
        this.sonarVisuals.dispose();
        this.webgpuFft.dispose();
        this.uiManager.cleanup();

        // Reset UI state
        const setupScreen = document.getElementById('setup-screen');
        if (setupScreen) setupScreen.classList.remove('hidden');

        const engineControls = document.getElementById('engine-controls');
        if (engineControls) engineControls.classList.add('hidden');

        this.uiManager.updateStatusDisplay("SYSTEMS OFFLINE", "");
        this.uiManager.renderContactRegistry();
    }

    renderLoop(now) {
        this.renderRequest = requestAnimationFrame(this.renderLoop);

        // Update simulation
        this.simEngine.update(now);

        // Render Tactical View
        this.tacticalView.render(
            this.simEngine.targets,
            this.worldModel.ownShipCourse,
            this.worldModel.getOwnShipForwardSpeed(),
            this.worldModel.ownShipPosition
        );

        // Render Visuals
        const ctx = this.audioSys.getContext();
        const selectedTarget = this.worldModel.getSelectedTarget();
        const analysisMode = selectedTarget ? 'selected' : 'composite';

        // Update Depth Profile Context
        this.depthRenderContext.ownDepth = this.worldModel.getOwnShipDepth();
        if (selectedTarget) {
            this.depthRenderContext.targetDepth = this.worldModel.getTargetDepth(selectedTarget);
            const rangeMeters = Math.max(1.0, selectedTarget.distance * 10);
            this.depthRenderContext.modifiers = this.worldModel.environment.getAcousticModifiers(
                this.depthRenderContext.ownDepth,
                this.depthRenderContext.targetDepth,
                rangeMeters
            );
        } else {
            this.depthRenderContext.targetDepth = undefined;
            this.depthRenderContext.modifiers = null;
        }

        this.depthProfileDisplay.render(this.depthRenderContext);

        // Sonar Visuals
        const data = this.audioSys.getAnalysisFrequencyData(analysisMode);

        if (ctx && data) {
            const timeDomainData = this.audioSys.getAnalysisTimeDomainData(analysisMode);
            const activeRpm = selectedTarget ? selectedTarget.rpm : this.currentRpmValue;

            // Update Sonar Draw Options
            const osSig = this.audioSys.getOwnShipSignature();
            this.sonarDrawOptions.ownShipSignature.rpm = osSig.rpm;
            this.sonarDrawOptions.ownShipSignature.bladeCount = osSig.bladeCount;
            this.sonarDrawOptions.ownShipSignature.bpfHz = osSig.bpfHz;

            this.sonarDrawOptions.sourceMode = analysisMode === 'selected' ? 'SELECTED' : 'COMPOSITE';

            const pt = this.worldModel.getPingTransientState(2.5);
            this.sonarDrawOptions.pingTransient.active = pt.active;
            this.sonarDrawOptions.pingTransient.recent = pt.recent;
            this.sonarDrawOptions.pingTransient.sinceLastPing = pt.sinceLastPing;

            // getAndFlushArrivedEchoes returns an array. We update the reference.
            this.sonarDrawOptions.pingEchoes = this.worldModel.getAndFlushArrivedEchoes();
            this.sonarDrawOptions.ownShipCourseRad = this.worldModel.ownShipCourse;

            this.sonarVisuals.draw(
                data,
                this.simEngine.targets,
                activeRpm,
                this.worldModel.pingActiveIntensity,
                ctx.sampleRate,
                this.audioSys.analyser.fftSize,
                selectedTarget,
                timeDomainData,
                this.sonarDrawOptions
            );
        }

        if (selectedTarget) {
            this.uiManager.updateDashboard(selectedTarget);
        }
    }

    setRpm(rpm) {
        this.currentRpmValue = rpm;
        this.audioSys.setRpm(rpm);
    }

    getTargetById(targetId) {
        return this.simEngine.targets.find((t) => t.id === targetId) || null;
    }

    handleTargetSelected(e) {
        this.setSelectedTarget(e.detail.id);
        this.uiManager.renderContactRegistry();
    }

    setSelectedTarget(targetId) {
        const normalized = targetId || null;
        this.worldModel.selectedTargetId = normalized;
        this.tacticalView.selectedTargetId = normalized;
        this.contactManager.setSelectedTarget(normalized);
        this.audioSys.setFocusedTarget(normalized);

        const target = this.getTargetById(normalized);
        const selectedContact = this.contactManager.getSelectedContact();

        this.uiManager.updateTargetIdDisplay(targetId, target, selectedContact);

        if (target) {
            this.uiManager.updateDashboard(target);
            this.uiManager.populateManualSolutionInputs(target, selectedContact);
        }
    }
}
