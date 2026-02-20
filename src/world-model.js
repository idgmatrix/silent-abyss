import { TrackState, SimulationTarget } from './simulation.js';
import { EnvironmentModel } from './acoustics/environment-model.js';
import { buildScenarioTargets, getDefaultScenario } from './data/scenario-loader.js';
import { bearingDegFromDelta, forwardFromCourse, normalizeCourseRadians } from './coordinate-system.js';

export class WorldModel {
    constructor(simEngine, spatialService, callbacks = {}) {
        this.simEngine = simEngine;
        this.spatialService = spatialService; // Must provide getTerrainHeight(x, z)

        this.callbacks = {
            onTargetUpdate: callbacks.onTargetUpdate || (() => {}),
            onScanUpdate: callbacks.onScanUpdate || (() => {}),
            onScanComplete: callbacks.onScanComplete || (() => {}),
            onPingEcho: callbacks.onPingEcho || (() => {}),
            onSonarContact: callbacks.onSonarContact || (() => {})
        };

        this.environment = new EnvironmentModel();

        this.selectedTargetId = null;
        this.isScanning = false;
        this.scanRadius = 0;
        this.pingActiveIntensity = 0;
        this.currentPulseId = 0;
        this.ownShipCourse = 0;
        this.ownShipRudderDeg = 0;
        this.ownShipTurnRate = 0;
        this.ownShipThrottleCmd = 0; // -1 astern .. +1 ahead
        this.ownShipForwardSpeed = 0; // signed local-forward speed (visual units/s)
        this.ownShipPosition = { x: 0, z: 0 };
        this.elapsedTime = 0; // Simulation time in seconds
        this.lastPingTime = -Infinity;
        this.pendingEchoes = []; // { bearing, intensity, arrivalTime }

        // Configuration
        this.detectionThreshold = 6.0; // dB
        this.lostTrackTimeout = 10.0; // 10 seconds
        this.losSampleCount = 10;
        this.passiveOcclusionAttenuation = 25.0; // dB loss
        this.shadowZoneAttenuation = 15.0; // dB loss (Thermocline shadow)
        this.multiPathStrength = 3.0; // dB variation
        this.multiPathFrequency = 0.5;
        this.maxOwnShipTurnRate = 0.35; // rad/s at full rudder
        this.maxAheadSpeed = 2.8; // increased from 0.28
        this.maxAsternSpeed = 1.6; // increased from 0.16
    }

    seedTargets() {
        this.simEngine.targets = []; // Ensure clean state
        const scenario = getDefaultScenario();
        const targetConfigs = buildScenarioTargets(scenario, () => this.simEngine.random());

        targetConfigs.forEach((config) => {
            this.simEngine.addTarget(new SimulationTarget(config.id, config));
        });
    }

    update(dt) {
        this.elapsedTime += dt;
        this.updateOwnShipManeuver(dt);

        // Decay visuals
        if (this.pingActiveIntensity > 0) {
            this.pingActiveIntensity *= 0.85;
        }

        this.processPassiveDetection();
        this.processClassification(dt);
        if (this.isScanning) {
            this.processActiveScanning();
        }

        // Notify that targets have been updated (for audio volume, etc.)
        this.callbacks.onTargetUpdate(this.simEngine.targets);
    }

    updateOwnShipManeuver(dt) {
        const maxRudderDeg = 30;
        const rudderNorm = Math.max(-1, Math.min(1, this.ownShipRudderDeg / maxRudderDeg));
        const targetTurnRate = rudderNorm * this.maxOwnShipTurnRate;
        const response = Math.min(1, Math.max(0, dt * 2.6));
        this.ownShipTurnRate += (targetTurnRate - this.ownShipTurnRate) * response;

        const throttle = Math.max(-1, Math.min(1, this.ownShipThrottleCmd));
        const targetSpeed = throttle >= 0
            ? throttle * this.maxAheadSpeed
            : throttle * this.maxAsternSpeed;
        const speedResponse = Math.min(1, Math.max(0, dt * 1.9));
        this.ownShipForwardSpeed += (targetSpeed - this.ownShipForwardSpeed) * speedResponse;

        this.ownShipCourse = normalizeCourseRadians(this.ownShipCourse + this.ownShipTurnRate * dt);

        const forward = forwardFromCourse(this.ownShipCourse);
        this.ownShipPosition.x += forward.x * this.ownShipForwardSpeed * dt;
        this.ownShipPosition.z += forward.z * this.ownShipForwardSpeed * dt;
    }

    getRangeToTarget(target) {
        return Math.hypot(target.x - this.ownShipPosition.x, target.z - this.ownShipPosition.z);
    }

    getBearingToTarget(target) {
        const dx = target.x - this.ownShipPosition.x;
        const dz = target.z - this.ownShipPosition.z;
        return bearingDegFromDelta(dx, dz);
    }

    setOwnShipRudderAngleDeg(angleDeg) {
        const angle = Number(angleDeg);
        if (!Number.isFinite(angle)) return;
        this.ownShipRudderDeg = Math.max(-30, Math.min(30, angle));
    }

    centerOwnShipRudder() {
        this.ownShipRudderDeg = 0;
    }

    setOwnShipThrottleNormalized(value) {
        const v = Number(value);
        if (!Number.isFinite(v)) return;
        this.ownShipThrottleCmd = Math.max(-1, Math.min(1, v));
    }

    stopOwnShipThrottle() {
        this.ownShipThrottleCmd = 0;
    }

    getOwnShipHeadingDeg() {
        const heading = (normalizeCourseRadians(this.ownShipCourse) * 180 / Math.PI);
        return (heading + 360) % 360;
    }

    getOwnShipThrottleNormalized() {
        return this.ownShipThrottleCmd;
    }

    getOwnShipForwardSpeed() {
        return this.ownShipForwardSpeed;
    }

    processPassiveDetection() {
        const ownShipDepth = this.getOwnShipDepth();

        this.simEngine.targets.forEach(target => {
            const targetDepth = this.getTargetDepth(target);
            const ambientNoise = this.environment.getAmbientNoise(targetDepth);
            const rangeMeters = Math.max(1.0, this.getRangeToTarget(target) * 10);
            const modifiers = this.environment.getAcousticModifiers(ownShipDepth, targetDepth, rangeMeters);

            // Normalized Source Level (SL) from target
            const sl = target.getAcousticSignature();

            // Transmission Loss (TL) = 20 * log10(Range) - Spherical Spreading
            const transmissionLoss = 20 * Math.log10(rangeMeters);

            // Passive Sonar Equation: SNR = SL - TL - NL
            let snr = sl - transmissionLoss - ambientNoise;
            snr += modifiers.snrModifierDb;

            // Layer crossing attenuation (Thermocline shadow zone)
            if (this.environment.isThermoclineBetween(ownShipDepth, targetDepth)) {
                snr -= this.shadowZoneAttenuation;
            }

            // Multipath interference
            const multiPathEffect = Math.sin(this.getRangeToTarget(target) * this.multiPathFrequency) * this.multiPathStrength;
            snr += multiPathEffect;

            // Terrain Occlusion
            const hasLineOfSight = this.checkLineOfSight(target);
            if (!hasLineOfSight) {
                snr -= this.passiveOcclusionAttenuation;
            }

            target.snr = snr; // Store current SNR for UI
            target.environmentEffects = modifiers;
            target.bearing = this.getBearingToTarget(target);
            target.distance = this.getRangeToTarget(target);

            const isDetected = snr > this.detectionThreshold;

            if (isDetected) {
                target.state = TrackState.TRACKED;
                target.lastDetectedTime = this.elapsedTime;
                this.callbacks.onSonarContact(target, true);
            } else if (target.state === TrackState.TRACKED) {
                // If we were tracking but SNR dropped, move to LOST
                if (this.elapsedTime - target.lastDetectedTime > this.lostTrackTimeout) {
                    target.state = TrackState.LOST;
                }
            }
        });
    }

    processClassification(dt) {
        this.simEngine.targets.forEach(target => {
            if (target.state === TrackState.UNDETECTED || target.state === TrackState.LOST) {
                target.classification.state = TrackState.UNDETECTED;
                target.classification.progress = 0;
                return;
            }

            // Classification requires a certain SNR to start identifying features
            const classificationThreshold = this.detectionThreshold + 2.0;
            const isSelected = target.id === this.selectedTargetId;

            if (target.snr > classificationThreshold) {
                // If tracked and SNR is good, advance classification
                // If selected, it advances faster (focused analysis)
                const rate = isSelected ? 0.06 : 0.015;
                target.classification.progress = Math.min(1.0, target.classification.progress + rate * dt);

                if (target.classification.progress > 0.2 && target.classification.progress < 0.6) {
                    target.classification.state = TrackState.AMBIGUOUS;
                } else if (target.classification.progress >= 0.6 && target.classification.progress < 0.95) {
                    target.classification.state = TrackState.CLASSIFIED;
                    target.classification.identifiedClass = target.classId;
                } else if (target.classification.progress >= 0.95) {
                    target.classification.state = TrackState.CONFIRMED;
                    target.classification.confirmed = true;
                }
            } else {
                // Decay progress if SNR is too low
                target.classification.progress = Math.max(0, target.classification.progress - 0.01 * dt);

                // If progress drops too low, revert state
                if (target.classification.progress < 0.1) {
                    target.classification.state = TrackState.UNDETECTED;
                }
            }
        });
    }

    getOwnShipDepth() {
        if (!this.spatialService || typeof this.spatialService.getTerrainHeight !== 'function') {
            return 5.0;
        }

        const height = this.spatialService.getTerrainHeight(this.ownShipPosition.x, this.ownShipPosition.z);
        return Math.max(1.0, -height - 5.0);
    }

    getTargetDepth(target) {
        if (!this.spatialService || typeof this.spatialService.getTerrainHeight !== 'function') {
            return 10.0;
        }

        const height = this.spatialService.getTerrainHeight(target.x, target.z);
        return Math.max(1.0, -height - 2.0);
    }

    processActiveScanning() {
        this.scanRadius += 15.0;
        this.callbacks.onScanUpdate(this.scanRadius, true);
        const ownShipDepth = this.getOwnShipDepth();

        this.simEngine.targets.forEach(target => {
            if (this.scanRadius >= this.getRangeToTarget(target) && target.lastPulseId !== this.currentPulseId) {
                target.lastPulseId = this.currentPulseId;
                const hasLineOfSight = this.checkLineOfSight(target);
                if (!hasLineOfSight) {
                    return;
                }

                target.state = TrackState.TRACKED;
                target.lastDetectedTime = this.elapsedTime;
                target.reactToPing();

                const targetDepth = this.getTargetDepth(target);
                const rangeMeters = Math.max(1.0, this.getRangeToTarget(target) * 10);
                const modifiers = this.environment.getAcousticModifiers(ownShipDepth, targetDepth, rangeMeters);
                const echoVol = (0.6 * (1.0 - this.getRangeToTarget(target) / 200)) * modifiers.echoGain;
                this.callbacks.onPingEcho(echoVol, this.getRangeToTarget(target));
                this.callbacks.onSonarContact(target, false);

                // Schedule visual echo return — two-way travel time at ~1500 m/s
                const twoWayDelaySec = (rangeMeters * 2) / 1500;
                const echoIntensity = Math.max(0.25, 1.0 - this.getRangeToTarget(target) / 200) * modifiers.echoGain;
                this.pendingEchoes.push({
                    bearing: this.getBearingToTarget(target),
                    intensity: echoIntensity,
                    arrivalTime: this.elapsedTime + twoWayDelaySec
                });
            }
        });

        if (this.scanRadius > 150) {
            this.isScanning = false;
            this.pingActiveIntensity = 0;
            this.callbacks.onScanUpdate(this.scanRadius, false);
            this.callbacks.onScanComplete();
        }
    }

    checkLineOfSight(target) {
        if (!this.spatialService || typeof this.spatialService.getTerrainHeight !== 'function') {
            return true;
        }

        const startX = this.ownShipPosition.x;
        const startZ = this.ownShipPosition.z;
        const endX = target.x;
        const endZ = target.z;

        // Terrain is at `height`. Ship is at `height + 5.0`.
        const ownShipYPos = this.spatialService.getTerrainHeight(startX, startZ) + 5.0;
        const targetYPos = this.spatialService.getTerrainHeight(endX, endZ) + 2.0;

        for (let i = 1; i < this.losSampleCount; i++) {
            const t = i / this.losSampleCount;
            const sx = startX + (endX - startX) * t;
            const sz = startZ + (endZ - startZ) * t;
            const losY = ownShipYPos + (targetYPos - ownShipYPos) * t;
            const terrainY = this.spatialService.getTerrainHeight(sx, sz);

            if (terrainY > losY) {
                return false;
            }
        }

        return true;
    }

    triggerPing() {
        if (this.isScanning) return;
        this.isScanning = true;
        this.scanRadius = 0;
        this.currentPulseId++;
        this.lastPingTime = this.elapsedTime;
        this.pingActiveIntensity = 1.0;
        this.callbacks.onScanUpdate(0, true);
    }

    getPingTransientState(recentWindowSec = 2.5) {
        const active = this.isScanning || this.pingActiveIntensity > 0.06;
        const sinceLastPing = this.elapsedTime - this.lastPingTime;
        const recent = Number.isFinite(sinceLastPing) && sinceLastPing >= 0 && sinceLastPing <= recentWindowSec;
        return {
            active,
            recent,
            sinceLastPing
        };
    }

    getAndFlushArrivedEchoes() {
        const arrived = this.pendingEchoes.filter(e => this.elapsedTime >= e.arrivalTime);
        this.pendingEchoes = this.pendingEchoes.filter(e => this.elapsedTime < e.arrivalTime);
        return arrived;
    }

    getSelectedTarget() {
        return this.simEngine.targets.find(t => t.id === this.selectedTargetId);
    }

    getAcousticContextForTarget(target) {
        if (!target) return null;
        const ownShipDepth = this.getOwnShipDepth();
        const targetDepth = this.getTargetDepth(target);
        const rangeMeters = Math.max(1.0, target.distance * 10);
        const modifiers = this.environment.getAcousticModifiers(ownShipDepth, targetDepth, rangeMeters);

        return {
            ownShipDepth,
            targetDepth,
            rangeMeters,
            modifiers
        };
    }
}
