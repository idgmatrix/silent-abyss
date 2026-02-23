export class UIManager {
    constructor(orchestrator) {
        this.orch = orchestrator;

        // Cache states to avoid unnecessary DOM updates
        this.lastContactHTML = '';
        this.lastCampaignHTML = '';
        this.lastDepthText = '';
        this.lastHeadingText = '';
        this.lastRpmText = '';
        this.lastStatusText = '';
        this.lastStatusClass = '';
        this.leftSonarWindowResizeHandler = null;

        // UI Elements Cache
        this.elements = {};
    }

    init() {
        this.cacheDomElements();
        this.bindGlobalHandlers();
        this.bindContactUiHandlers();
        this.bindCampaignUiHandlers();
        this.bindDemonControlUiHandlers();
        this.bindManeuverUiHandlers();
        this.bindViewModeHandlers();
        this.syncLeftSonarPanelHeights();

        // Theme selectors
        const themeSelect = document.getElementById('btr-theme-select');
        if (themeSelect) {
            themeSelect.onchange = (e) => this.orch.sonarVisuals.setTheme(e.target.value);
        }

        const btrBearingReferenceSelect = document.getElementById('btr-bearing-reference-select');
        if (btrBearingReferenceSelect) {
            btrBearingReferenceSelect.onchange = (e) => {
                this.orch.sonarVisuals.setBtrBearingReference(e.target.value);
            };
            this.orch.sonarVisuals.setBtrBearingReference(btrBearingReferenceSelect.value);
        }

        const waterfallThemeSelect = document.getElementById('waterfall-theme-select');
        if (waterfallThemeSelect) {
            waterfallThemeSelect.onchange = (e) => this.orch.sonarVisuals.setWaterfallTheme(e.target.value);
        }

        // Clock
        this.startClock();
    }

    cleanup() {
        if (this.clockInterval) clearInterval(this.clockInterval);
        if (this.leftSonarWindowResizeHandler) {
            window.removeEventListener('resize', this.leftSonarWindowResizeHandler);
            this.leftSonarWindowResizeHandler = null;
        }

    }

    cacheDomElements() {
        const ids = [
            'rpm-display', 'tactical-status', 'target-range-text', 'target-vel-text',
            'target-brg-text', 'sig-text', 'target-class-text', 'target-id-text',
            'contact-alert', 'depth-text', 'contact-list', 'contact-filter', 'contact-sort',
            'contact-pin-btn', 'contact-relabel-input', 'contact-relabel-btn',
            'contact-clear-lost', 'solution-bearing', 'solution-range', 'solution-course',
            'solution-speed', 'solution-save-btn', 'solution-confidence', 'mission-select',
            'mission-reset-btn', 'mission-title', 'mission-status', 'mission-briefing',
            'mission-objectives', 'demon-focus-width-slider', 'demon-focus-width-value',
            'demon-self-noise-toggle', 'demon-stability-slider', 'demon-stability-value',
            'demon-controls-toggle', 'demon-controls-content', 'rudder-slider',
            'rudder-angle-display', 'rudder-port-btn', 'rudder-starboard-btn',
            'rudder-center-btn', 'heading-display', 'throttle-slider', 'throttle-display',
            'throttle-astern-btn', 'throttle-ahead-btn', 'throttle-stop-btn', 'rpm-slider',
            'btr-bearing-reference-select', 'terrain-point-cloud-toggle', 'atmosphere-preset-select',
            'snap-to-contact-2d-toggle', 'compare-prediction-2d-toggle',
            'enhanced-2d-visuals-toggle', 'visual-mode-select'
        ];

        ids.forEach(id => {
            this.elements[id] = document.getElementById(id);
        });
    }

    // Helper for safe element access
    getEl(id) {
        return this.elements[id];
    }

    updateElementText(el, text) {
        if (el && el.textContent !== text) {
            el.textContent = text;
        }
    }

    updateElementTextAndClass(el, text, className) {
        if (!el) return;
        if (el.textContent !== text) el.textContent = text;
        if (className !== undefined && el.className !== className) el.className = className;
    }

    bindGlobalHandlers() {
        const startBtn = document.getElementById('start-btn');
        if (startBtn) startBtn.onclick = () => this.orch.init();

        const pingBtn = document.getElementById('ping-btn');
        if (pingBtn) pingBtn.onclick = () => this.triggerPing();

        const rpmSlider = this.getEl('rpm-slider');
        if (rpmSlider) {
            rpmSlider.oninput = (e) => {
                const rpm = parseFloat(e.target.value);
                this.orch.setRpm(rpm); // Delegate to orchestrator/audioSys

                const rpmText = `${rpm} RPM`;
                if (this.lastRpmText !== rpmText) {
                    const disp = this.getEl('rpm-display');
                    if(disp) disp.innerText = rpmText;
                    this.lastRpmText = rpmText;
                }
            };
        }
    }

    bindViewModeHandlers() {
        document.querySelectorAll('input[name="view-mode"]').forEach(el => {
            el.onchange = (e) => {
                this.orch.tacticalView.setViewMode(e.target.value);
            };
        });

        const terrainPointCloudToggle = this.getEl('terrain-point-cloud-toggle');
        if (terrainPointCloudToggle) {
            terrainPointCloudToggle.onchange = (e) => {
                this.orch.tacticalView.setTerrainRenderStyle(e.target.checked ? 'point-cloud' : 'default');
            };
            this.orch.tacticalView.setTerrainRenderStyle(terrainPointCloudToggle.checked ? 'point-cloud' : 'default');
        }

        const atmospherePresetSelect = this.getEl('atmosphere-preset-select');
        if (atmospherePresetSelect) {
            atmospherePresetSelect.onchange = (e) => {
                this.orch.tacticalView.setAtmospherePreset(e.target.value);
            };
            atmospherePresetSelect.value = this.orch.tacticalView.getAtmospherePreset();
            this.orch.tacticalView.setAtmospherePreset(atmospherePresetSelect.value);
        }

        const snap2dToggle = this.getEl('snap-to-contact-2d-toggle');
        if (snap2dToggle) {
            snap2dToggle.checked = !!this.orch.tacticalView.snapToContactEnabled;
            snap2dToggle.onchange = (e) => {
                this.orch.tacticalView.setSnapToContactEnabled(!!e.target.checked);
            };
        }

        const comparePredToggle = this.getEl('compare-prediction-2d-toggle');
        if (comparePredToggle) {
            comparePredToggle.checked = !!this.orch.tacticalView.predictionCompareEnabled;
            comparePredToggle.onchange = (e) => {
                this.orch.tacticalView.setPredictionCompareEnabled(!!e.target.checked);
            };
        }

        const enhanced2dToggle = this.getEl('enhanced-2d-visuals-toggle');
        if (enhanced2dToggle) {
            enhanced2dToggle.checked = !!this.orch.tacticalView.enhanced2DVisuals;
            enhanced2dToggle.onchange = (e) => {
                const enabled = !!e.target.checked;
                this.orch.tacticalView.setEnhanced2DVisualsEnabled(enabled);
                this.orch.sonarVisuals.setEnhancedVisualsEnabled(enabled);
            };
        }

        const visualModeSelect = this.getEl('visual-mode-select');
        if (visualModeSelect) {
            visualModeSelect.value = this.orch.tacticalView.visualMode || 'stealth';
            visualModeSelect.onchange = (e) => {
                const mode = e.target.value;
                this.orch.tacticalView.setVisualMode(mode);
                this.orch.sonarVisuals.setVisualMode(mode);
            };
        }
    }

    triggerPing() {
        if (this.orch.worldModel.isScanning || !this.orch.audioSys.getContext()) return;

        this.orch.worldModel.triggerPing();
        this.orch.audioSys.createPingTap(0.5, 1200, 900);

        this.updateStatusDisplay("ACTIVE PINGING", "text-red-500");
    }

    updateDashboard(target) {
        if (!target) return;

        this.updateElementText(this.getEl('target-range-text'), `${(target.distance * 50).toFixed(0)}m`);
        this.updateElementText(this.getEl('target-vel-text'), `${Math.abs(target.velocity * 20).toFixed(1)}kts`);
        this.updateElementText(this.getEl('target-brg-text'), `${target.bearing.toFixed(1)}° (T)`);

        const classEl = this.getEl('target-class-text');
        if (classEl) {
            if (target.classification && target.classification.confirmed) {
                this.updateElementTextAndClass(
                    classEl,
                    target.classification.identifiedClass?.toUpperCase() || target.type,
                    "text-green-500 font-bold"
                );
            } else if (target.classification && target.classification.state === 'CLASSIFIED') {
                this.updateElementTextAndClass(classEl, "ANALYZING...", "text-orange-400");
            } else {
                this.updateElementTextAndClass(classEl, target.type, "text-white");
            }
        }

        const sigEl = this.getEl('sig-text');
        if (target.distance < 50) {
            if(sigEl) {
                this.updateElementTextAndClass(sigEl, "HIGH", "text-red-500 font-bold text-sm animate-pulse");
            }
        } else {
            if(sigEl) {
                this.updateElementTextAndClass(sigEl, "TRACKING", "text-orange-400 font-bold text-sm");
            }
        }
    }

    updateStatusDisplay(text, className) {
        const statusDisplay = this.getEl('tactical-status');
        if (statusDisplay && (this.lastStatusText !== text || this.lastStatusClass !== className)) {
            statusDisplay.innerText = text;
            statusDisplay.className = className;
            this.lastStatusText = text;
            this.lastStatusClass = className;
        }
    }

    updateOwnShipStatus() {
        const depthEl = this.getEl('depth-text');
        const depthText = `${this.orch.worldModel.getOwnShipDepth().toFixed(0)}m`;
        if (this.lastDepthText !== depthText) {
            this.updateElementText(depthEl, depthText);
            this.lastDepthText = depthText;
        }

        const headingDisplayEl = this.getEl('heading-display');
        if (headingDisplayEl) {
            const heading = this.orch.worldModel.getOwnShipHeadingDeg();
            const headingText = `${Math.round(heading).toString().padStart(3, '0')}\u00B0`;
            if (this.lastHeadingText !== headingText) {
                headingDisplayEl.innerText = headingText;
                this.lastHeadingText = headingText;
            }
        }

        // Also update RPM display if it wasn't updated by slider
        const rpmDisplay = this.getEl('rpm-display');
        const currentRpm = this.orch.currentRpmValue;
        if (rpmDisplay) {
             const rpmText = `${currentRpm} RPM`;
             if (this.lastRpmText !== rpmText) {
                 rpmDisplay.innerText = rpmText;
                 this.lastRpmText = rpmText;
             }
        }
    }

    updateTargetIdDisplay(targetId, target, contact) {
        const targetIdEl = this.getEl('target-id-text');
        const solutionConfidenceEl = this.getEl('solution-confidence');

        if (!targetId) {
            if (targetIdEl) targetIdEl.innerText = 'OWN-SHIP';
            if (solutionConfidenceEl) solutionConfidenceEl.innerText = 'CONF: --';
            return;
        }

        if (target && targetIdEl) {
            targetIdEl.innerText = contact?.alias
                ? `${contact.alias} (${contact.label})`
                : contact?.label || targetId.toUpperCase();
        }
    }

    populateManualSolutionInputs(target, contact) {
        const solutionBearingInput = this.getEl('solution-bearing');
        const solutionRangeInput = this.getEl('solution-range');
        const solutionCourseInput = this.getEl('solution-course');
        const solutionSpeedInput = this.getEl('solution-speed');
        const solutionConfidenceEl = this.getEl('solution-confidence');

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

    renderContactRegistry() {
        const contactListEl = this.getEl('contact-list');
        const contactFilterEl = this.getEl('contact-filter');
        const contactSortEl = this.getEl('contact-sort');

        if (!contactListEl) return;

        const contacts = this.orch.contactManager.getContacts({
            filterMode: contactFilterEl?.value,
            sortMode: contactSortEl?.value
        });

        let html = '';
        if (contacts.length === 0) {
            html = '<div class="text-[9px] text-cyan-700">NO TRACKED CONTACTS</div>';
        } else {
            html = contacts.map((contact) => {
                const selectedClass = this.orch.worldModel.selectedTargetId === contact.targetId ? ' selected' : '';
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

        if (html !== this.lastContactHTML) {
            contactListEl.innerHTML = html;
            this.lastContactHTML = html;
        }
    }

    bindContactUiHandlers() {
        const contactFilterEl = this.getEl('contact-filter');
        const contactSortEl = this.getEl('contact-sort');
        const contactListEl = this.getEl('contact-list');
        const contactPinBtn = this.getEl('contact-pin-btn');
        const contactRelabelBtn = this.getEl('contact-relabel-btn');
        const contactClearLostBtn = this.getEl('contact-clear-lost');
        const solutionSaveBtn = this.getEl('solution-save-btn');

        if (contactFilterEl) {
            contactFilterEl.onchange = () => this.renderContactRegistry();
        }
        if (contactSortEl) {
            contactSortEl.onchange = () => this.renderContactRegistry();
        }

        if (contactListEl) {
            contactListEl.onclick = (event) => {
                if (!(event.target instanceof Element)) return;
                const button = event.target.closest('[data-target-id]');
                if (!button) return;
                const targetId = button.getAttribute('data-target-id');
                this.orch.setSelectedTarget(targetId);
                this.renderContactRegistry();
            };
        }

        if (contactPinBtn) {
            contactPinBtn.onclick = () => {
                if (!this.orch.worldModel.selectedTargetId) return;
                this.orch.contactManager.togglePin(this.orch.worldModel.selectedTargetId);
                this.renderContactRegistry();
            };
        }

        if (contactRelabelBtn) {
            contactRelabelBtn.onclick = () => {
                const contactRelabelInput = this.getEl('contact-relabel-input');
                if (!this.orch.worldModel.selectedTargetId || !contactRelabelInput) return;
                const result = this.orch.contactManager.relabel(this.orch.worldModel.selectedTargetId, contactRelabelInput.value);
                if (result.ok) {
                    contactRelabelInput.value = '';
                    this.orch.setSelectedTarget(this.orch.worldModel.selectedTargetId);
                    this.renderContactRegistry();
                }
            };
        }

        if (contactClearLostBtn) {
            contactClearLostBtn.onclick = () => {
                const removedIds = this.orch.contactManager.clearLostContacts();
                if (removedIds.includes(this.orch.worldModel.selectedTargetId)) {
                    this.orch.setSelectedTarget(null);
                }
                this.renderContactRegistry();
            };
        }

        if (solutionSaveBtn) {
            solutionSaveBtn.onclick = () => {
                if (!this.orch.worldModel.selectedTargetId) return;
                const target = this.orch.getTargetById(this.orch.worldModel.selectedTargetId);
                if (!target) return;

                const confidence = this.orch.contactManager.setManualSolution(
                    this.orch.worldModel.selectedTargetId,
                    {
                        bearing: this.getEl('solution-bearing')?.value,
                        range: this.getEl('solution-range')?.value,
                        course: this.getEl('solution-course')?.value,
                        speed: this.getEl('solution-speed')?.value
                    },
                    target
                );

                const solutionConfidenceEl = this.getEl('solution-confidence');
                if (solutionConfidenceEl) {
                    solutionConfidenceEl.innerText = Number.isFinite(confidence) ? `CONF: ${confidence}%` : 'CONF: --';
                }
                this.renderContactRegistry();
            };
        }
    }

    renderCampaignPanel() {
        const missionSelectEl = this.getEl('mission-select');
        const missionTitleEl = this.getEl('mission-title');
        const missionStatusEl = this.getEl('mission-status');
        const missionBriefingEl = this.getEl('mission-briefing');
        const missionObjectivesEl = this.getEl('mission-objectives');

        if (!missionSelectEl) return;
        const unlocked = this.orch.campaignManager.getUnlockedMissions();
        const active = this.orch.campaignManager.getActiveMission();

        const currentOptionCount = unlocked.length;
        if (missionSelectEl.children.length !== currentOptionCount) {
            missionSelectEl.innerHTML = unlocked
                .map((mission) => `<option value="${mission.id}">${mission.name}</option>`)
                .join('');
        }

        if (active && missionSelectEl.value !== active.id) {
            missionSelectEl.value = active.id;
        }

        if (!active) {
            this.updateElementText(missionTitleEl, '--');
            this.updateElementText(missionStatusEl, 'NO MISSION');
            this.updateElementText(missionBriefingEl, '--');
            if (missionObjectivesEl && missionObjectivesEl.innerHTML !== '') {
                missionObjectivesEl.innerHTML = '';
            }
            return;
        }

        const complete = this.orch.campaignManager.isMissionCompleted(active.id);
        this.updateElementText(missionTitleEl, active.name);
        this.updateElementText(missionStatusEl, complete ? 'STATUS: COMPLETED' : 'STATUS: IN PROGRESS');
        this.updateElementText(missionBriefingEl, active.briefing);

        if (missionObjectivesEl) {
            const objectivesHtml = active.objectives
                .map((objective) => {
                    const done = this.orch.campaignManager.getObjectiveState(active.id, objective.id);
                    return `<div>${done ? '[x]' : '[ ]'} ${objective.description}</div>`;
                })
                .join('');

            if (objectivesHtml !== this.lastCampaignHTML) {
                missionObjectivesEl.innerHTML = objectivesHtml;
                this.lastCampaignHTML = objectivesHtml;
            }
        }
    }

    bindCampaignUiHandlers() {
        const missionSelectEl = this.getEl('mission-select');
        const missionResetBtn = this.getEl('mission-reset-btn');

        if (missionSelectEl) {
            missionSelectEl.onchange = (event) => {
                const missionId = event.target.value;
                if (this.orch.campaignManager.setActiveMission(missionId)) {
                    this.renderCampaignPanel();
                }
            };
        }

        if (missionResetBtn) {
            missionResetBtn.onclick = () => {
                this.orch.campaignManager.reset();
                this.renderCampaignPanel();
            };
        }
    }

    bindDemonControlUiHandlers() {
        const demonFocusWidthSliderEl = this.getEl('demon-focus-width-slider');
        const demonFocusWidthValueEl = this.getEl('demon-focus-width-value');
        const demonSelfNoiseToggleEl = this.getEl('demon-self-noise-toggle');
        const demonStabilitySliderEl = this.getEl('demon-stability-slider');
        const demonStabilityValueEl = this.getEl('demon-stability-value');
        const demonControlsToggleEl = this.getEl('demon-controls-toggle');
        const demonControlsContentEl = this.getEl('demon-controls-content');

        if (demonFocusWidthSliderEl) {
            const applyFocusWidth = () => {
                const value = Number.parseFloat(demonFocusWidthSliderEl.value);
                this.orch.sonarVisuals.setDemonFocusWidth(value);
                if (demonFocusWidthValueEl) {
                    demonFocusWidthValueEl.innerText = `${value.toFixed(1)}Hz`;
                }
            };
            demonFocusWidthSliderEl.oninput = applyFocusWidth;
            applyFocusWidth();
        }

        if (demonSelfNoiseToggleEl) {
            const applySelfNoise = () => {
                this.orch.sonarVisuals.setSelfNoiseSuppressionEnabled(!!demonSelfNoiseToggleEl.checked);
            };
            demonSelfNoiseToggleEl.onchange = applySelfNoise;
            applySelfNoise();
        }

        if (demonStabilitySliderEl) {
            const applyStability = () => {
                const sliderValue = Number.parseInt(demonStabilitySliderEl.value, 10);
                const normalized = Number.isFinite(sliderValue) ? sliderValue / 100 : 0.55;
                this.orch.sonarVisuals.setDemonResponsiveness(normalized);
                if (demonStabilityValueEl) {
                    demonStabilityValueEl.innerText = `${sliderValue}`;
                }
            };
            demonStabilitySliderEl.oninput = applyStability;
            applyStability();
        }

        if (demonControlsToggleEl && demonControlsContentEl) {
            demonControlsToggleEl.addEventListener('click', () => {
                demonControlsContentEl.classList.toggle('hidden');
                const isHidden = demonControlsContentEl.classList.contains('hidden');
                demonControlsToggleEl.innerHTML = isHidden ? '&#9654;' : '&#9660;';
            });
        }
    }

    bindManeuverUiHandlers() {
        const rudderSliderEl = this.getEl('rudder-slider');
        const rudderAngleDisplayEl = this.getEl('rudder-angle-display');
        const rudderPortBtnEl = this.getEl('rudder-port-btn');
        const rudderStarboardBtnEl = this.getEl('rudder-starboard-btn');
        const rudderCenterBtnEl = this.getEl('rudder-center-btn');

        const throttleSliderEl = this.getEl('throttle-slider');
        const throttleDisplayEl = this.getEl('throttle-display');
        const throttleAsternBtnEl = this.getEl('throttle-astern-btn');
        const throttleAheadBtnEl = this.getEl('throttle-ahead-btn');
        const throttleStopBtnEl = this.getEl('throttle-stop-btn');

        const applyRudder = (value) => {
            const angle = Number.parseInt(value, 10);
            const safe = Number.isFinite(angle) ? Math.max(-30, Math.min(30, angle)) : 0;
            this.orch.worldModel.setOwnShipRudderAngleDeg(safe);
            if (rudderAngleDisplayEl) {
                rudderAngleDisplayEl.innerText = `${safe > 0 ? '+' : ''}${safe}\u00B0`;
            }
            if (rudderSliderEl && Number.parseInt(rudderSliderEl.value, 10) !== safe) {
                rudderSliderEl.value = `${safe}`;
            }
        };

        if (rudderSliderEl) {
            rudderSliderEl.oninput = () => applyRudder(rudderSliderEl.value);
            applyRudder(rudderSliderEl.value);
        }

        if (rudderPortBtnEl) {
            rudderPortBtnEl.onclick = () => applyRudder(-20);
        }

        if (rudderStarboardBtnEl) {
            rudderStarboardBtnEl.onclick = () => applyRudder(20);
        }

        if (rudderCenterBtnEl) {
            rudderCenterBtnEl.onclick = () => {
                this.orch.worldModel.centerOwnShipRudder();
                applyRudder(0);
            };
        }

        const applyThrottle = (value) => {
            const percent = Number.parseInt(value, 10);
            const safe = Number.isFinite(percent) ? Math.max(-100, Math.min(100, percent)) : 0;
            this.orch.worldModel.setOwnShipThrottleNormalized(safe / 100);
            if (throttleSliderEl && Number.parseInt(throttleSliderEl.value, 10) !== safe) {
                throttleSliderEl.value = `${safe}`;
            }
            if (throttleDisplayEl) {
                if (safe === 0) throttleDisplayEl.innerText = 'STOP';
                else if (safe > 0) throttleDisplayEl.innerText = `AHD ${safe}%`;
                else throttleDisplayEl.innerText = `AST ${Math.abs(safe)}%`;
            }
        };

        if (throttleSliderEl) {
            throttleSliderEl.oninput = () => applyThrottle(throttleSliderEl.value);
            applyThrottle(throttleSliderEl.value);
        }
        if (throttleAsternBtnEl) {
            throttleAsternBtnEl.onclick = () => applyThrottle(-60);
        }
        if (throttleAheadBtnEl) {
            throttleAheadBtnEl.onclick = () => applyThrottle(60);
        }
        if (throttleStopBtnEl) {
            throttleStopBtnEl.onclick = () => {
                this.orch.worldModel.stopOwnShipThrottle();
                applyThrottle(0);
            };
        }
    }

    syncLeftSonarPanelHeights() {
        const leftColumn = document.getElementById('left-column');
        if (leftColumn) {
            const panels = leftColumn.querySelectorAll(':scope > .panel');
            if (panels[2]) panels[2].style.removeProperty('height');
            if (panels[3]) panels[3].style.removeProperty('height');
        }

        // Left sidebar layout is CSS-driven; keep canvases in sync after layout changes.
        this.orch.sonarVisuals.resize();
    }

    setupLeftSonarPanelHeightSync() {
        if (this.leftSonarWindowResizeHandler) {
            window.removeEventListener('resize', this.leftSonarWindowResizeHandler);
        }
        this.leftSonarWindowResizeHandler = () => this.syncLeftSonarPanelHeights();
        window.addEventListener('resize', this.leftSonarWindowResizeHandler);
        this.syncLeftSonarPanelHeights();
    }

    startClock() {
        if (this.clockInterval) clearInterval(this.clockInterval);
        this.clockInterval = setInterval(() => {
            const clock = document.getElementById('clock');
            if (clock) clock.innerText = new Date().toTimeString().split(' ')[0];
        }, 1000);
    }
}
