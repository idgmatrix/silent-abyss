import { TrackState, SimulationTarget } from './simulation.js';
import { EnvironmentModel } from './acoustics/environment-model.js';
import { getSignature } from './data/ship-signatures.js';

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
        this.elapsedTime = 0; // Simulation time in seconds

        // Configuration
        this.detectionThreshold = 6.0; // dB
        this.lostTrackTimeout = 10.0; // 10 seconds
        this.losSampleCount = 10;
        this.passiveOcclusionAttenuation = 25.0; // dB loss
        this.shadowZoneAttenuation = 15.0; // dB loss (Thermocline shadow)
        this.multiPathStrength = 3.0; // dB variation
        this.multiPathFrequency = 0.5;
    }

    seedTargets() {
        this.simEngine.targets = []; // Ensure clean state

        // 1. Initial manual targets (The "Cast")
        const coreTargets = [
            { id: 'target-01', x: -60, z: 20, course: 0.2, speed: 0.8, type: 'SHIP', classId: 'cargo-vessel', rpm: 120, bladeCount: 3, isPatrolling: false },
            { id: 'target-02', distance: 45, angle: Math.PI * 0.75, speed: 0.3, type: 'SUBMARINE', classId: 'triumph-class', rpm: 80, bladeCount: 7, isPatrolling: true, patrolRadius: 60 },
            { id: 'target-03', distance: 30, angle: -Math.PI * 0.25, type: 'BIOLOGICAL', isPatrolling: true, patrolRadius: 30 },
            { id: 'target-04', x: 40, z: -50, type: 'STATIC', isPatrolling: false },
            { id: 'target-05', distance: 80, angle: Math.PI * 0.4, type: 'BIOLOGICAL', isPatrolling: true, patrolRadius: 15 },
            { id: 'target-06', x: -90, z: -30, type: 'STATIC', isPatrolling: false },
            { id: 'target-07', distance: 90, angle: Math.PI * 1.6, type: 'SHIP', classId: 'fishery-trawler', speed: 1.2, rpm: 180, isPatrolling: true, patrolRadius: 80 }
        ];

        coreTargets.forEach(config => {
            this.simEngine.addTarget(new SimulationTarget(config.id, {
                ...config,
                seed: this.simEngine.random()
            }));
        });

        // 2. Procedural targets to fill the ocean
        const types = ['SHIP', 'SUBMARINE', 'BIOLOGICAL', 'STATIC'];
        const shipClasses = ['cargo-vessel', 'fishery-trawler', 'oil-tanker'];
        const subClasses = ['triumph-class', 'kilo-class'];

        for (let i = 8; i <= 15; i++) {
            const type = types[Math.floor(this.simEngine.random() * types.length)];
            const dist = 30 + this.simEngine.random() * 120;
            const angle = this.simEngine.random() * Math.PI * 2;
            
            let config = {
                id: `target-${i < 10 ? '0' + i : i}`,
                distance: dist,
                angle: angle,
                type: type,
                isPatrolling: type !== 'STATIC',
                seed: this.simEngine.random()
            };

            if (type === 'SHIP') {
                config.classId = shipClasses[Math.floor(this.simEngine.random() * shipClasses.length)];
                config.speed = 0.5 + this.simEngine.random() * 1.0;
                config.rpm = 100 + this.simEngine.random() * 150;
                config.bladeCount = 3 + Math.floor(this.simEngine.random() * 3);
            } else if (type === 'SUBMARINE') {
                config.classId = subClasses[Math.floor(this.simEngine.random() * subClasses.length)];
                config.speed = 0.2 + this.simEngine.random() * 0.4;
                config.rpm = 60 + this.simEngine.random() * 60;
                config.bladeCount = 7;
            }

            this.simEngine.addTarget(new SimulationTarget(config.id, config));
        }
    }

    update(dt) {
        this.elapsedTime += dt;
        this.ownShipCourse = (this.elapsedTime / 10) * Math.PI * 2;

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

    processPassiveDetection() {
        const ownShipDepth = this.getOwnShipDepth();

        this.simEngine.targets.forEach(target => {
            const targetDepth = this.getTargetDepth(target);
            const ambientNoise = this.environment.getAmbientNoise(targetDepth);

            // Normalized Source Level (SL) from target
            const sl = target.getAcousticSignature();

            // Transmission Loss (TL) = 20 * log10(Range) - Spherical Spreading
            const rangeMeters = Math.max(1.0, target.distance * 10);
            const transmissionLoss = 20 * Math.log10(rangeMeters);

            // Passive Sonar Equation: SNR = SL - TL - NL
            let snr = sl - transmissionLoss - ambientNoise;

            // Layer crossing attenuation (Thermocline shadow zone)
            if (this.environment.isThermoclineBetween(ownShipDepth, targetDepth)) {
                snr -= this.shadowZoneAttenuation;
            }

            // Multipath interference
            const multiPathEffect = Math.sin(target.distance * this.multiPathFrequency) * this.multiPathStrength;
            snr += multiPathEffect;

            // Terrain Occlusion
            const hasLineOfSight = this.checkLineOfSight(target);
            if (!hasLineOfSight) {
                snr -= this.passiveOcclusionAttenuation;
            }

            target.snr = snr; // Store current SNR for UI

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

        const height = this.spatialService.getTerrainHeight(0, 0);
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

        this.simEngine.targets.forEach(target => {
            if (this.scanRadius >= target.distance && target.lastPulseId !== this.currentPulseId) {
                target.lastPulseId = this.currentPulseId;
                const hasLineOfSight = this.checkLineOfSight(target);
                if (!hasLineOfSight) {
                    return;
                }

                target.state = TrackState.TRACKED;
                target.lastDetectedTime = this.elapsedTime;
                target.reactToPing();

                const echoVol = 0.6 * (1.0 - target.distance / 200);
                this.callbacks.onPingEcho(echoVol, target.distance);
                this.callbacks.onSonarContact(target, false);
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

        const startX = 0;
        const startZ = 0;
        const endX = target.x;
        const endZ = target.z;

        const ownShipY = this.spatialService.getTerrainHeight(startX, startZ) + 5.0;
        const targetY = this.spatialService.getTerrainHeight(endX, endZ) + 2.0;

        for (let i = 1; i < this.losSampleCount; i++) {
            const t = i / this.losSampleCount;
            const sx = startX + (endX - startX) * t;
            const sz = startZ + (endZ - startZ) * t;
            const losY = ownShipY + (targetY - ownShipY) * t;
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
        this.pingActiveIntensity = 1.0;
        this.callbacks.onScanUpdate(0, true);
    }

    getSelectedTarget() {
        return this.simEngine.targets.find(t => t.id === this.selectedTargetId);
    }
}
