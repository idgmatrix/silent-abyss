import { getAcousticSourcePreset, listAcousticSourcePresets } from './data/acoustic-source-presets.js';
import { getClassProfile, getSignature } from './data/ship-signatures.js';

const FAMILY_LABELS = {
    AIRCRAFT: 'AIRCRAFT',
    SHIP: 'SURFACE VESSEL',
    SUBMARINE: 'SUBMARINE',
    BIOLOGICAL: 'MARINE LIFE',
    ENVIRONMENTAL: 'ENVIRONMENTAL',
};

const FAMILY_ORDER = ['AIRCRAFT', 'SHIP', 'SUBMARINE', 'BIOLOGICAL', 'ENVIRONMENTAL'];

const GLOBAL_ENV_PARAMS = [
    { key: 'seaState', label: 'Sea State', min: 0, max: 9, step: 1 },
    { key: 'shippingLaneDensity', label: 'Shipping Density', min: 0, max: 1, step: 0.01 },
    { key: 'precipitationLevel', label: 'Precipitation', min: 0, max: 1, step: 0.01 },
    { key: 'iceCoverage', label: 'Ice Coverage', min: 0, max: 1, step: 0.01 },
    { key: 'seismicActivity', label: 'Seismic Activity', min: 0, max: 1, step: 0.01 },
    { key: 'ventActivity', label: 'Vent Activity', min: 0, max: 1, step: 0.01 },
];

const PROPULSION_PARAMS = [
    { key: 'rpm', label: 'RPM', min: 0, max: 400, step: 1 },
    { key: 'bladeCount', label: 'Blade Count', min: 1, max: 12, step: 1 },
    { key: 'load', label: 'Load', min: 0, max: 1, step: 0.01 },
    { key: 'rpmJitter', label: 'RPM Jitter', min: 0, max: 1, step: 0.01 },
    { key: 'cavitationLevel', label: 'Cavitation', min: 0, max: 1, step: 0.01 },
];

const BIO_CALL_OPTIONS = [
    ['chirp', 'Chirp'],
    ['snapping_shrimp', 'Snapping Shrimp'],
    ['blue_whale', 'Blue Whale'],
    ['fin_whale', 'Fin Whale'],
    ['humpback_song', 'Humpback'],
    ['minke_pulse', 'Minke'],
    ['sperm_whale_click', 'Sperm Whale'],
    ['orca_call', 'Orca'],
    ['beluga_call', 'Beluga'],
    ['dolphin_whistle', 'Dolphin Whistle'],
    ['dolphin_school', 'Dolphin School'],
    ['fish_chorus', 'Fish Chorus'],
    ['herring_school', 'Herring School'],
];

const AIR_CALL_OPTIONS = [
    ['helicopter_rotor', 'Helicopter Rotor'],
    ['fixed_wing_aircraft', 'Fixed-Wing'],
    ['jet_aircraft', 'Jet'],
];

const ENV_CALL_OPTIONS = [
    ['ambient_ocean', 'Ambient Ocean'],
    ['precipitation', 'Precipitation'],
    ['ice_noise', 'Ice Noise'],
    ['geological_noise', 'Geological'],
];

const TEST_PRESETS = [
    {
        id: 'single-merchant',
        name: 'Single merchant',
        sources: [
            { id: 'merchant-surface-vessel', patch: { rangeKm: 4.2, bearingDeg: 40, speedKt: 16, rpm: 132, cavitationLevel: 0.14 } },
        ],
        environment: { seaState: 2, precipitationLevel: 0, shippingLaneDensity: 0.25, iceCoverage: 0, seismicActivity: 0.08, ventActivity: 0.04 },
        selected: 'merchant-surface-vessel',
    },
    {
        id: 'sub-battery-vs-snorkel',
        name: 'Sub battery vs snorkel',
        sources: [
            { id: 'diesel-electric-submarine-battery', patch: { rangeKm: 5.1, bearingDeg: 328, speedKt: 4, depthM: 140, rpm: 52, cavitationLevel: 0.04 } },
            { id: 'diesel-electric-submarine-snorkeling', patch: { rangeKm: 5.8, bearingDeg: 18, speedKt: 7, depthM: 24, rpm: 112, cavitationLevel: 0.18 } },
        ],
        environment: { seaState: 2, precipitationLevel: 0, shippingLaneDensity: 0.15, iceCoverage: 0, seismicActivity: 0.08, ventActivity: 0.04 },
        selected: 'diesel-electric-submarine-battery',
    },
    {
        id: 'whale-plus-merchant',
        name: 'Whale + merchant',
        sources: [
            { id: 'merchant-surface-vessel', patch: { rangeKm: 5.5, bearingDeg: 62, speedKt: 14, rpm: 124 } },
            { id: 'blue-whale', patch: { rangeKm: 5.1, bearingDeg: 71, speedKt: 3, depthM: 35, bioRate: 0.24 } },
        ],
        environment: { seaState: 3, precipitationLevel: 0, shippingLaneDensity: 0.28, iceCoverage: 0, seismicActivity: 0.08, ventActivity: 0.04 },
        selected: 'blue-whale',
    },
    {
        id: 'high-sea-state-precip',
        name: 'High sea state + precipitation',
        sources: [
            { id: 'merchant-surface-vessel', patch: { rangeKm: 6.2, bearingDeg: 132, speedKt: 18, cavitationLevel: 0.22 } },
            { id: 'rain', patch: { rangeKm: 7.5, bearingDeg: 180, bioRate: 0.72 } },
        ],
        environment: { seaState: 7, precipitationLevel: 0.82, shippingLaneDensity: 0.3, iceCoverage: 0, seismicActivity: 0.08, ventActivity: 0.04 },
        selected: 'rain',
    },
    {
        id: 'convergence-zone',
        name: 'Convergence zone',
        sources: [
            { id: 'merchant-surface-vessel', patch: { rangeKm: 4.8, bearingDeg: 250, speedKt: 15, rpm: 128 } },
            { id: 'ocean-ambient-sea-state', patch: { rangeKm: 6.4, bearingDeg: 200, bioRate: 0.44 } },
        ],
        environment: { seaState: 2, precipitationLevel: 0, shippingLaneDensity: 0.2, iceCoverage: 0, seismicActivity: 0.08, ventActivity: 0.04, profile: 'DEEP_OCEAN' },
        selected: 'merchant-surface-vessel',
    },
];

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function humanizePresetId(id) {
    return id
        .split('-')
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ');
}

function formatValue(value, step = 0.01) {
    if (!Number.isFinite(value)) return '--';
    if (step >= 1) return `${Math.round(value)}`;
    if (step >= 0.1) return value.toFixed(1);
    return value.toFixed(2);
}

function getFamilyKey(preset) {
    return preset?.type || 'SHIP';
}

function speedUnitsToKnots(speed) {
    return (Number(speed) || 0) * 20;
}

function knotsToSpeedUnits(knots) {
    return (Number(knots) || 0) / 20;
}

export class DevAudioPanel {
    constructor(orchestrator) {
        this.orch = orchestrator;
        this.root = null;
        this.panelEl = null;
        this.browserEl = null;
        this.controlsEl = null;
        this.statusEl = null;
        this.presetSelectEl = null;
        this.isOpen = false;
        this.isActive = false;
        this.isolate = false;
        this.selectedSourceId = null;
        this.snapshotTargets = null;
        this.snapshotEnvironment = null;
        this.sweep = { active: false, param: 'rpm', durationSec: 8, lastValue: null };
        this.onKeyDown = this.onKeyDown.bind(this);
        this.onPanelClick = this.onPanelClick.bind(this);
        this.onPanelChange = this.onPanelChange.bind(this);
        this.onPanelInput = this.onPanelInput.bind(this);
        this.sourceIds = listAcousticSourcePresets();
        this.sourceStates = new Map();
        this.environmentState = {
            seaState: 2,
            shippingLaneDensity: 0.35,
            precipitationLevel: 0,
            iceCoverage: 0,
            seismicActivity: 0.08,
            ventActivity: 0.04,
            profile: 'DEEP_OCEAN',
        };

        this.sourceIds.forEach((id, index) => {
            this.sourceStates.set(id, this.createDefaultSourceState(id, index));
        });
        this.selectedSourceId = this.sourceIds[0] || null;
    }

    init() {
        this.mount();
        window.addEventListener('keydown', this.onKeyDown);

        const params = new URLSearchParams(window.location.search);
        if (params.get('debugAudio') === '1') {
            this.toggle(true);
        }
    }

    async cleanup() {
        window.removeEventListener('keydown', this.onKeyDown);
        if (this.isActive) {
            await this.deactivateAuditionMode();
        }
        if (this.panelEl) {
            this.panelEl.removeEventListener('click', this.onPanelClick);
            this.panelEl.removeEventListener('change', this.onPanelChange);
            this.panelEl.removeEventListener('input', this.onPanelInput);
        }
    }

    createDefaultSourceState(id, index) {
        const preset = getAcousticSourcePreset(id);
        const family = getFamilyKey(preset);
        const classProfile = preset?.classId ? getClassProfile(preset.classId) : null;
        const classSignature = preset?.classId ? getSignature(preset.classId) : null;
        const classDefaults = classProfile?.defaults || {};
        const classBladeCount = Number.isFinite(classSignature?.blades) ? classSignature.blades : undefined;
        const defaultSpeedUnits = Number.isFinite(preset?.speed)
            ? preset.speed
            : Number.isFinite(classDefaults.speed)
                ? classDefaults.speed
                : family === 'AIRCRAFT'
                    ? 4
                    : family === 'BIOLOGICAL'
                        ? 0.3
                        : 0.6;
        const defaultRpm = Number.isFinite(preset?.rpm)
            ? preset.rpm
            : Number.isFinite(classDefaults.rpm)
                ? classDefaults.rpm
                : family === 'AIRCRAFT'
                    ? 180
                    : 0;
        const defaultBladeCount = Number.isFinite(preset?.bladeCount)
            ? preset.bladeCount
            : Number.isFinite(classDefaults.bladeCount)
                ? classDefaults.bladeCount
                : Number.isFinite(classBladeCount)
                    ? classBladeCount
                    : 4;
        return {
            id,
            enabled: false,
            name: humanizePresetId(id),
            family,
            rangeKm: family === 'ENVIRONMENTAL' ? 6 : family === 'AIRCRAFT' ? 8 : family === 'BIOLOGICAL' ? 5.5 : 4.5,
            bearingDeg: (index * 29) % 360,
            speedKt: clamp(speedUnitsToKnots(defaultSpeedUnits), 0, family === 'AIRCRAFT' ? 360 : 40),
            depthM: family === 'SUBMARINE' ? 140 : family === 'BIOLOGICAL' ? 35 : family === 'SHIP' ? 8 : 10,
            altitudeM: family === 'AIRCRAFT' ? 300 : 0,
            rpm: defaultRpm,
            bladeCount: defaultBladeCount,
            load: Number.isFinite(preset?.load) ? preset.load : 0.45,
            rpmJitter: Number.isFinite(preset?.rpmJitter) ? preset.rpmJitter : 0.08,
            cavitationLevel: Number.isFinite(preset?.cavitationLevel) ? preset.cavitationLevel : 0.12,
            bioType: preset?.bioType || 'chirp',
            bioRate: Number.isFinite(preset?.bioRate) ? preset.bioRate : 0.35,
            sourceLevelOffset: Number.isFinite(preset?.sourceLevelOffset) ? preset.sourceLevelOffset : 0,
        };
    }

    mount() {
        this.root = document.getElementById('dev-audio-panel-root');
        if (!this.root) return;

        this.root.innerHTML = `
            <aside class="dev-audio-panel" id="dev-audio-panel">
                <div class="dev-audio-header">
                    <div>
                        <h2>Acoustic Source Lab</h2>
                        <p>F9 toggles the panel. Opening enters dev audition mode.</p>
                    </div>
                    <div class="dev-audio-toolbar">
                        <button type="button" data-action="toggle-isolate">Isolate Off</button>
                        <button type="button" data-action="close-panel">Close</button>
                    </div>
                </div>
                <div class="dev-audio-body">
                    <div class="dev-audio-column">
                        <section class="dev-audio-section dev-audio-presets">
                            <h3 class="dev-audio-section-title">Test Scenario Presets</h3>
                            <label>
                                Scenario
                                <select id="dev-audio-preset-select">
                                    ${TEST_PRESETS.map((preset) => `<option value="${preset.id}">${preset.name}</option>`).join('')}
                                </select>
                            </label>
                            <div class="dev-audio-toolbar" style="margin-top:8px;">
                                <button type="button" data-action="apply-preset">Load Preset</button>
                                <button type="button" data-action="clear-sources">Clear All</button>
                            </div>
                            <div class="dev-audio-note" style="margin-top:8px;">
                                Only enabled sources are instantiated as contacts and routed into the sonar analysis path.
                            </div>
                        </section>
                        <section class="dev-audio-section">
                            <h3 class="dev-audio-section-title">Source Browser</h3>
                            <div id="dev-audio-source-browser"></div>
                        </section>
                    </div>
                    <div class="dev-audio-column">
                        <section class="dev-audio-section">
                            <h3 class="dev-audio-section-title">Selected Source</h3>
                            <div id="dev-audio-panel-status" class="dev-audio-note"></div>
                            <div id="dev-audio-source-controls" class="dev-audio-controls" style="margin-top:10px;"></div>
                        </section>
                    </div>
                </div>
            </aside>
        `;

        this.panelEl = this.root.querySelector('#dev-audio-panel');
        this.browserEl = this.root.querySelector('#dev-audio-source-browser');
        this.controlsEl = this.root.querySelector('#dev-audio-source-controls');
        this.statusEl = this.root.querySelector('#dev-audio-panel-status');
        this.presetSelectEl = this.root.querySelector('#dev-audio-preset-select');

        this.panelEl.addEventListener('click', this.onPanelClick);
        this.panelEl.addEventListener('change', this.onPanelChange);
        this.panelEl.addEventListener('input', this.onPanelInput);

        this.render();
    }

    onKeyDown(event) {
        if (event.key !== 'F9') return;
        event.preventDefault();
        this.toggle();
    }

    async toggle(forceOpen = !this.isOpen) {
        if (forceOpen === this.isOpen) return;

        if (forceOpen) {
            await this.activateAuditionMode();
            this.isOpen = true;
            this.panelEl?.classList.add('is-open');
        } else {
            this.isOpen = false;
            this.panelEl?.classList.remove('is-open');
            await this.deactivateAuditionMode();
        }
        this.render();
    }

    captureEnvironmentSnapshot() {
        const env = this.orch.worldModel.environment;
        return {
            seaState: env.seaState,
            shippingLaneDensity: env.shippingLaneDensity,
            precipitationLevel: env.precipitationLevel,
            iceCoverage: env.iceCoverage,
            seismicActivity: env.seismicActivity,
            ventActivity: env.ventActivity,
            profile: Object.entries(env.profiles).find(([, value]) => value === env.currentProfile)?.[0] || 'DEEP_OCEAN',
        };
    }

    async activateAuditionMode() {
        if (this.isActive) return;
        this.snapshotTargets = this.orch.snapshotCurrentTargets();
        this.snapshotEnvironment = this.captureEnvironmentSnapshot();
        this.environmentState = { ...this.snapshotEnvironment };
        await this.orch.setActiveTargets([]);
        this.applyEnvironmentState();
        this.orch.audioSys.setIsolationTarget(null);
        this.isActive = true;
        await this.syncAllEnabledSources();
    }

    async deactivateAuditionMode() {
        if (!this.isActive) return;
        this.stopSweep();
        this.isolate = false;
        this.orch.audioSys.setIsolationTarget(null);
        if (this.snapshotEnvironment) {
            this.environmentState = { ...this.snapshotEnvironment };
            this.applyEnvironmentState();
        }
        await this.orch.setActiveTargets(this.snapshotTargets || []);
        this.snapshotTargets = null;
        this.snapshotEnvironment = null;
        this.isActive = false;
    }

    async syncAllEnabledSources() {
        for (const sourceId of this.sourceIds) {
            const state = this.sourceStates.get(sourceId);
            if (state?.enabled) {
                await this.orch.addTarget(this.buildTargetConfig(sourceId));
            }
        }
        this.refreshIsolationState();
    }

    buildTargetConfig(sourceId) {
        const state = this.sourceStates.get(sourceId);
        const preset = getAcousticSourcePreset(sourceId);
        const own = this.orch.worldModel.ownShipPosition;
        const rangeUnits = Math.max(0, state.rangeKm) * 20;
        const bearingRad = (state.bearingDeg * Math.PI) / 180;
        const x = own.x + Math.sin(bearingRad) * rangeUnits;
        const z = own.z - Math.cos(bearingRad) * rangeUnits;

        return {
            id: this.runtimeTargetId(sourceId),
            soundPreset: sourceId,
            type: preset.type,
            x,
            z,
            speed: knotsToSpeedUnits(state.speedKt),
            rpm: state.rpm,
            bladeCount: state.bladeCount,
            shaftRate: state.rpm / 60,
            load: state.load,
            rpmJitter: state.rpmJitter,
            cavitationLevel: state.cavitationLevel,
            bioType: state.bioType,
            bioRate: state.bioRate,
            depth: preset.type === 'AIRCRAFT' ? undefined : state.depthM,
            altitude: preset.type === 'AIRCRAFT' ? state.altitudeM : undefined,
            sourceLevelOffset: state.sourceLevelOffset,
            isPatrolling: false,
            classId: preset.classId,
        };
    }

    runtimeTargetId(sourceId) {
        return `dev-${sourceId}`;
    }

    getSelectedState() {
        return this.selectedSourceId ? this.sourceStates.get(this.selectedSourceId) || null : null;
    }

    async onPanelClick(event) {
        const checkboxEl = event.target.closest('[data-enable-source]');
        if (checkboxEl) {
            return;
        }

        const actionEl = event.target.closest('[data-action]');
        if (actionEl) {
            const action = actionEl.getAttribute('data-action');
            if (action === 'close-panel') {
                await this.toggle(false);
                return;
            }
            if (action === 'toggle-isolate') {
                this.isolate = !this.isolate;
                this.refreshIsolationState();
                this.render();
                return;
            }
            if (action === 'apply-preset') {
                await this.applyTestPreset(this.presetSelectEl?.value);
                return;
            }
            if (action === 'clear-sources') {
                await this.clearAllSources();
                return;
            }
            if (action === 'toggle-sweep') {
                if (this.sweep.active) {
                    this.stopSweep();
                } else {
                    this.startSweep();
                }
                this.renderSelectedSourceControls();
                return;
            }
        }

        const rowEl = event.target.closest('[data-select-source]');
        if (rowEl) {
            this.selectedSourceId = rowEl.getAttribute('data-select-source');
            this.refreshIsolationState();
            this.renderSelectedSourceControls();
            this.renderSourceBrowser();
        }
    }

    async onPanelChange(event) {
        const target = event.target;
        if (!(target instanceof HTMLElement)) return;

        if (target.matches('[data-enable-source]')) {
            const sourceId = target.getAttribute('data-enable-source');
            const state = this.sourceStates.get(sourceId);
            if (!state) return;
            state.enabled = !!target.checked;
            this.selectedSourceId = sourceId;
            if (this.isActive) {
                if (state.enabled) {
                    await this.orch.addTarget(this.buildTargetConfig(sourceId));
                } else {
                    this.orch.removeTarget(this.runtimeTargetId(sourceId));
                }
                this.refreshIsolationState();
            }
            this.render();
            return;
        }

        if (target.matches('[data-select-param]')) {
            const param = target.getAttribute('data-select-param');
            this.updateEnumParam(param, target.value);
            return;
        }

        if (target.matches('[data-sweep-param]')) {
            this.sweep.param = target.value;
            this.renderSelectedSourceControls();
        }
    }

    async onPanelInput(event) {
        const target = event.target;
        if (!(target instanceof HTMLElement)) return;
        if (!target.matches('[data-range-param]')) return;

        const key = target.getAttribute('data-range-param');
        const value = Number(target.value);
        if (!Number.isFinite(value)) return;

        await this.updateNumericParam(key, value);
    }

    async updateNumericParam(key, value) {
        const selected = this.getSelectedState();
        if (!selected) return;

        if (key === 'durationSec') {
            this.sweep.durationSec = value;
            this.renderSelectedSourceControls();
            return;
        }

        if (GLOBAL_ENV_PARAMS.some((param) => param.key === key)) {
            this.environmentState[key] = value;
            this.applyEnvironmentState();
            this.renderSelectedSourceControls();
            return;
        }

        selected[key] = value;
        if (this.isActive && selected.enabled) {
            this.orch.updateTarget(this.runtimeTargetId(selected.id), this.buildTargetConfig(selected.id));
            if (this.isolate) {
                this.refreshIsolationState();
            }
        }
        this.renderSelectedSourceControls();
        this.renderSourceBrowser();
    }

    updateEnumParam(key, value) {
        const selected = this.getSelectedState();
        if (!selected) return;
        if (key === 'bioType') {
            selected.bioType = value;
            if (this.isActive && selected.enabled) {
                this.orch.updateTarget(this.runtimeTargetId(selected.id), this.buildTargetConfig(selected.id));
            }
            this.renderSelectedSourceControls();
        }
    }

    applyEnvironmentState() {
        const env = this.orch.worldModel.environment;
        Object.assign(env, {
            seaState: this.environmentState.seaState,
            shippingLaneDensity: this.environmentState.shippingLaneDensity,
            precipitationLevel: this.environmentState.precipitationLevel,
            iceCoverage: this.environmentState.iceCoverage,
            seismicActivity: this.environmentState.seismicActivity,
            ventActivity: this.environmentState.ventActivity,
        });
        if (this.environmentState.profile && env.profiles[this.environmentState.profile]) {
            env.currentProfile = env.profiles[this.environmentState.profile];
        }
    }

    refreshIsolationState() {
        if (!this.isolate || !this.selectedSourceId) {
            this.orch.audioSys.setIsolationTarget(null);
            return;
        }
        const selected = this.sourceStates.get(this.selectedSourceId);
        if (!selected?.enabled) {
            this.orch.audioSys.setIsolationTarget(null);
            return;
        }
        const runtimeId = this.runtimeTargetId(this.selectedSourceId);
        this.orch.setSelectedTarget(runtimeId);
        this.orch.audioSys.setIsolationTarget(runtimeId);
    }

    async clearAllSources() {
        this.stopSweep();
        for (const sourceId of this.sourceIds) {
            const state = this.sourceStates.get(sourceId);
            if (!state) continue;
            state.enabled = false;
            if (this.isActive) {
                this.orch.removeTarget(this.runtimeTargetId(sourceId));
            }
        }
        this.orch.audioSys.setIsolationTarget(null);
        this.render();
    }

    async applyTestPreset(presetId) {
        const preset = TEST_PRESETS.find((item) => item.id === presetId);
        if (!preset) return;

        await this.clearAllSources();

        if (preset.environment) {
            this.environmentState = { ...this.environmentState, ...preset.environment };
            this.applyEnvironmentState();
        }

        for (const item of preset.sources) {
            const state = this.sourceStates.get(item.id);
            if (!state) continue;
            Object.assign(state, item.patch || {});
            state.enabled = true;
            if (this.isActive) {
                await this.orch.addTarget(this.buildTargetConfig(item.id));
            }
        }

        this.selectedSourceId = preset.selected || preset.sources[0]?.id || this.selectedSourceId;
        this.isolate = false;
        this.refreshIsolationState();
        this.render();
    }

    getActiveNumericParams() {
        const selected = this.getSelectedState();
        const preset = selected ? getAcousticSourcePreset(selected.id) : null;
        if (!selected || !preset) return [];

        const base = [
            { key: 'rangeKm', label: 'Range', min: 0.5, max: 20, step: 0.1 },
            { key: 'bearingDeg', label: 'Bearing', min: 0, max: 359, step: 1 },
            { key: preset.type === 'AIRCRAFT' ? 'altitudeM' : 'depthM', label: preset.type === 'AIRCRAFT' ? 'Altitude' : 'Depth', min: 0, max: preset.type === 'AIRCRAFT' ? 1500 : 800, step: 1 },
            { key: 'speedKt', label: 'Speed', min: 0, max: preset.type === 'AIRCRAFT' ? 360 : 40, step: 0.5 },
        ];

        if (preset.type === 'SHIP' || preset.type === 'SUBMARINE' || preset.type === 'AIRCRAFT') {
            base.push(...PROPULSION_PARAMS);
        }

        if (preset.type === 'BIOLOGICAL' || preset.type === 'AIRCRAFT' || preset.type === 'ENVIRONMENTAL') {
            base.push({ key: 'bioRate', label: 'Bio Rate', min: 0, max: 1, step: 0.01 });
        }

        if (preset.type === 'ENVIRONMENTAL') {
            base.push(...GLOBAL_ENV_PARAMS);
        }

        return base;
    }

    startSweep() {
        const params = this.getActiveNumericParams();
        if (params.length === 0) return;
        if (!params.some((param) => param.key === this.sweep.param)) {
            this.sweep.param = params[0].key;
        }
        this.sweep.active = true;
        this.sweep.startedAt = performance.now();
        this.sweep.lastValue = null;
    }

    stopSweep() {
        this.sweep.active = false;
        this.sweep.lastValue = null;
    }

    update(now) {
        if (!this.isOpen || !this.isActive || !this.sweep.active) return;

        const param = this.getActiveNumericParams().find((item) => item.key === this.sweep.param);
        if (!param) return;

        const elapsed = (now - this.sweep.startedAt) / 1000;
        const phase = (elapsed / Math.max(0.5, this.sweep.durationSec)) % 2;
        const triangle = phase <= 1 ? phase : 2 - phase;
        const nextValue = param.min + (param.max - param.min) * triangle;

        if (this.sweep.lastValue !== null && Math.abs(nextValue - this.sweep.lastValue) < Math.max(param.step, 0.01) * 0.5) {
            return;
        }

        this.sweep.lastValue = nextValue;
        this.updateNumericParam(param.key, nextValue);
    }

    render() {
        if (!this.panelEl) return;
        this.renderSourceBrowser();
        this.renderSelectedSourceControls();
        const selected = this.getSelectedState();
        this.statusEl.textContent = selected
            ? `${selected.name} // ${selected.enabled ? 'enabled' : 'disabled'} // audition mode ${this.isActive ? 'active' : 'standby'}`
            : 'No source selected';

        const isolateBtn = this.panelEl.querySelector('[data-action="toggle-isolate"]');
        if (isolateBtn) {
            isolateBtn.textContent = this.isolate ? 'Isolate On' : 'Isolate Off';
        }
    }

    renderSourceBrowser() {
        if (!this.browserEl) return;

        const grouped = new Map(FAMILY_ORDER.map((key) => [key, []]));
        this.sourceIds.forEach((sourceId) => {
            const preset = getAcousticSourcePreset(sourceId);
            grouped.get(getFamilyKey(preset))?.push(sourceId);
        });

        this.browserEl.innerHTML = FAMILY_ORDER.map((family) => {
            const items = grouped.get(family) || [];
            if (items.length === 0) return '';
            return `
                <div class="dev-audio-source-group">
                    <div class="dev-audio-source-group-label">${FAMILY_LABELS[family]}</div>
                    ${items.map((sourceId) => {
                        const state = this.sourceStates.get(sourceId);
                        return `
                            <div
                                class="dev-audio-source-item${this.selectedSourceId === sourceId ? ' is-selected' : ''}"
                                data-select-source="${sourceId}"
                            >
                                <input type="checkbox" data-enable-source="${sourceId}" ${state.enabled ? 'checked' : ''}>
                                <div class="dev-audio-source-name">${state.name}</div>
                                <div class="dev-audio-source-state${state.enabled ? '' : ' is-off'}">${state.enabled ? 'Live' : 'Off'}</div>
                            </div>
                        `;
                    }).join('')}
                </div>
            `;
        }).join('');
    }

    renderSliderControl(param, value) {
        return `
            <div class="dev-audio-param">
                <div class="dev-audio-param-head">
                    <span>${param.label}</span>
                    <span>${formatValue(value, param.step)}</span>
                </div>
                <input
                    type="range"
                    min="${param.min}"
                    max="${param.max}"
                    step="${param.step}"
                    value="${clamp(value, param.min, param.max)}"
                    data-range-param="${param.key}"
                >
            </div>
        `;
    }

    renderSelectedSourceControls() {
        if (!this.controlsEl) return;
        const selected = this.getSelectedState();
        if (!selected) {
            this.controlsEl.innerHTML = '<div class="dev-audio-note">No source selected.</div>';
            return;
        }

        const preset = getAcousticSourcePreset(selected.id);
        const numericParams = this.getActiveNumericParams();
        const callOptions = preset.type === 'AIRCRAFT'
            ? AIR_CALL_OPTIONS
            : preset.type === 'ENVIRONMENTAL'
                ? ENV_CALL_OPTIONS
                : preset.type === 'BIOLOGICAL'
                    ? BIO_CALL_OPTIONS
                    : [];

        if (!numericParams.some((param) => param.key === this.sweep.param) && numericParams[0]) {
            this.sweep.param = numericParams[0].key;
        }

        this.controlsEl.innerHTML = `
            <div class="dev-audio-grid">
                <label>
                    Source
                    <div class="dev-audio-pill">${selected.name}</div>
                </label>
                <label>
                    Runtime
                    <div class="dev-audio-pill">${selected.enabled ? 'Instantiated' : 'Disabled'}</div>
                </label>
            </div>
            <div style="margin-top:10px;">
                ${numericParams.map((param) => {
                    const currentValue = GLOBAL_ENV_PARAMS.some((item) => item.key === param.key)
                        ? this.environmentState[param.key]
                        : selected[param.key];
                    return this.renderSliderControl(param, currentValue);
                }).join('')}
            </div>
            ${callOptions.length > 0 ? `
                <div class="dev-audio-section" style="margin-top:10px;">
                    <div class="dev-audio-section-title">Call Type</div>
                    <label>
                        Profile
                        <select data-select-param="bioType">
                            ${callOptions.map(([value, label]) => `
                                <option value="${value}" ${selected.bioType === value ? 'selected' : ''}>${label}</option>
                            `).join('')}
                        </select>
                    </label>
                </div>
            ` : ''}
            <div class="dev-audio-section" style="margin-top:12px;">
                <div class="dev-audio-section-title">Parameter Sweep</div>
                <label>
                    Sweep Parameter
                    <select data-sweep-param="true">
                        ${numericParams.map((param) => `
                            <option value="${param.key}" ${this.sweep.param === param.key ? 'selected' : ''}>${param.label}</option>
                        `).join('')}
                    </select>
                </label>
                <div style="margin-top:8px;">
                    ${this.renderSliderControl({ key: 'durationSec', label: 'Sweep Period (s)', min: 1, max: 20, step: 0.5 }, this.sweep.durationSec)}
                </div>
                <div class="dev-audio-toolbar" style="margin-top:8px;">
                    <button type="button" data-action="toggle-sweep">${this.sweep.active ? 'Stop Sweep' : 'Start Sweep'}</button>
                </div>
            </div>
        `;
    }
}
