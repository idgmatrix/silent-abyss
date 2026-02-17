import { TrackState, SimulationTarget } from './simulation.js';
import { EnvironmentModel } from './acoustics/environment-model.js';

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
        this.detectionThreshold = 8.0; // dB
        this.lostTrackTimeout = 5.0; // 5 seconds
        this.losSampleCount = 10;
        this.passiveOcclusionAttenuation = 25.0; // dB loss
        this.shadowZoneAttenuation = 15.0; // dB loss (Thermocline shadow)
        this.multiPathStrength = 3.0; // dB variation
        this.multiPathFrequency = 0.5;
    }

    seedTargets() {
        this.simEngine.targets = []; // Ensure clean state
        this.simEngine.addTarget(new SimulationTarget('target-01', {
            // Merchant Vessel (SHIP)
            x: -90,
            z: 30,
            course: 0.2,
            speed: 0.8,
            type: 'SHIP',
            rpm: 120,
            bladeCount: 3,
            isPatrolling: false,
            seed: this.simEngine.random()
        }));

        this.simEngine.addTarget(new SimulationTarget('target-02', {
            // Stealthy Submarine (SUBMARINE)
            distance: 60,
            angle: Math.PI * 0.75,
            speed: 0.3,
            type: 'SUBMARINE',
            rpm: 80,
            bladeCount: 7,
            isPatrolling: true,
            patrolRadius: 80,
            seed: this.simEngine.random()
        }));

        this.simEngine.addTarget(new SimulationTarget('target-03', {
            // Erratic Whale (BIOLOGICAL)
            distance: 40,
            angle: -Math.PI * 0.25,
            type: 'BIOLOGICAL',
            isPatrolling: true,
            patrolRadius: 30,
            seed: this.simEngine.random()
        }));

        this.simEngine.addTarget(new SimulationTarget('target-04', {
            // Volcanic Vent (STATIC)
            x: 70,
            z: -80,
            type: 'STATIC',
            isPatrolling: false,
            seed: this.simEngine.random()
        }));

        this.simEngine.addTarget(new SimulationTarget('target-05', {
            // School of biologicals
            distance: 110,
            angle: Math.PI * 0.4,
            type: 'BIOLOGICAL',
            isPatrolling: true,
            patrolRadius: 15,
            seed: this.simEngine.random()
        }));

        this.simEngine.addTarget(new SimulationTarget('target-06', {
            // Derelict wreck
            x: -120,
            z: -40,
            type: 'STATIC',
            isPatrolling: false,
            seed: this.simEngine.random()
        }));

        this.simEngine.addTarget(new SimulationTarget('target-07', {
            // Inbound Torpedo
            distance: 140,
            angle: Math.PI * 1.1,
            type: 'TORPEDO',
            isPatrolling: true,
            patrolRadius: 200,
            targetCourse: Math.PI * 2.1, // Move towards center-ish
            seed: this.simEngine.random()
        }));
    }

    update(dt) {
        this.elapsedTime += dt;
        this.ownShipCourse = (this.elapsedTime / 10) * Math.PI * 2;

        // Decay visuals
        if (this.pingActiveIntensity > 0) {
            this.pingActiveIntensity *= 0.85;
        }

        this.processPassiveDetection();
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
