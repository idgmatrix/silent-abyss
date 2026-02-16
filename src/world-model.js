import { TrackState, SimulationTarget } from './simulation.js';
import { EnvironmentModel } from './acoustics/environment-model.js';

export class WorldModel {
    constructor(simEngine, audioSys, tacticalView, sonarVisuals) {
        this.simEngine = simEngine;
        this.audioSys = audioSys;
        this.tacticalView = tacticalView;
        this.sonarVisuals = sonarVisuals;

        this.environment = new EnvironmentModel();

        this.selectedTargetId = null;
        this.isScanning = false;
        this.scanRadius = 0;
        this.pingActiveIntensity = 0;
        this.currentPulseId = 0;
        this.ownShipCourse = 0;
        this.elapsedTime = 0; // Simulation time in seconds

        // Configuration
        this.detectionThreshold = 1.5;
        this.lostTrackTimeout = 5.0; // 5 seconds
        this.losSampleCount = 10;
        this.passiveOcclusionAttenuation = 0.15;
        this.shadowZoneAttenuation = 0.4; // More aggressive attenuation for layer crossing
        this.multiPathStrength = 0.2;
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

        // Update Audio Volume/Focus
        this.simEngine.targets.forEach(t => {
            this.audioSys.updateTargetVolume(t.id, t.distance);
        });

        this.tacticalView.updateTargetOpacities();
    }

    processPassiveDetection() {
        const ownShipDepth = this.getOwnShipDepth();

        this.simEngine.targets.forEach(target => {
            const targetDepth = this.getTargetDepth(target);
            const ambientNoise = this.environment.getAmbientNoise(targetDepth);

            // Normalized signature with distance-based transmission loss
            const sig = target.getAcousticSignature();
            const transmissionLoss = Math.pow(target.distance / 10, 1.5);

            // SNR calculation incorporating environmental background noise
            let snr = sig / (transmissionLoss * (ambientNoise / 60) + 1);

            // Layer crossing attenuation (Thermocline shadow zone)
            if (this.environment.isThermoclineBetween(ownShipDepth, targetDepth)) {
                snr *= this.shadowZoneAttenuation;
            }

            const multiPathFactor = 1 + Math.sin(target.distance * this.multiPathFrequency) * this.multiPathStrength;
            snr *= multiPathFactor;

            const hasLineOfSight = this.checkLineOfSight(target);
            if (!hasLineOfSight) {
                snr *= this.passiveOcclusionAttenuation;
            }
            target.snr = snr; // Store current SNR for UI

            const isDetected = snr > this.detectionThreshold;

            if (isDetected) {
                target.state = TrackState.TRACKED;
                target.lastDetectedTime = this.elapsedTime;
                this.tacticalView.updateTargetPosition(target.id, target.x, target.z, true);
            } else if (target.state === TrackState.TRACKED) {
                // If we were tracking but SNR dropped, move to LOST
                if (this.elapsedTime - target.lastDetectedTime > this.lostTrackTimeout) {
                    target.state = TrackState.LOST;
                }
            }
        });
    }

    getOwnShipDepth() {
        if (!this.tacticalView || typeof this.tacticalView.getTerrainHeight !== 'function') {
            return 5.0; // Default shallow depth
        }

        const height = this.tacticalView.getTerrainHeight(0, 0);
        // Assuming surface is at 0, depth is distance below surface
        return Math.max(1.0, -height - 5.0); // 5m above seabed
    }

    getTargetDepth(target) {
        if (!this.tacticalView || typeof this.tacticalView.getTerrainHeight !== 'function') {
            return 10.0;
        }

        const height = this.tacticalView.getTerrainHeight(target.x, target.z);
        return Math.max(1.0, -height - 2.0); // 2m above seabed
    }

    processActiveScanning() {
        this.scanRadius += 15.0;
        this.tacticalView.setScanExUniforms(this.scanRadius, true);

        this.simEngine.targets.forEach(target => {
            // If scanning past target and it's not already tracked by active scan this pulse
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
                this.audioSys.createPingEcho(echoVol, target.distance);
                this.tacticalView.updateTargetPosition(target.id, target.x, target.z);

                // Trigger UI Event
                window.dispatchEvent(new CustomEvent('sonar-contact', { detail: { id: target.id } }));
            }
        });

        if (this.scanRadius > 150) {
            this.isScanning = false;
            this.pingActiveIntensity = 0;
            this.tacticalView.setScanExUniforms(this.scanRadius, false);
            window.dispatchEvent(new CustomEvent('sonar-scan-complete'));
        }
    }

    checkLineOfSight(target) {
        if (!this.tacticalView || typeof this.tacticalView.getTerrainHeight !== 'function') {
            return true;
        }

        const startX = 0;
        const startZ = 0;
        const endX = target.x;
        const endZ = target.z;

        const ownShipY = this.tacticalView.getTerrainHeight(startX, startZ) + 5.0;
        const targetY = this.tacticalView.getTerrainHeight(endX, endZ) + 2.0;

        for (let i = 1; i < this.losSampleCount; i++) {
            const t = i / this.losSampleCount;
            const sx = startX + (endX - startX) * t;
            const sz = startZ + (endZ - startZ) * t;
            const losY = ownShipY + (targetY - ownShipY) * t;
            const terrainY = this.tacticalView.getTerrainHeight(sx, sz);

            if (terrainY > losY) {
                return false;
            }
        }

        return true;
    }

    triggerPing() {
        if (this.isScanning || !this.audioSys.getContext()) return;
        this.isScanning = true;
        this.scanRadius = 0;
        this.currentPulseId++;
        this.pingActiveIntensity = 1.0;
        this.tacticalView.setScanExUniforms(0, true);
        this.audioSys.createPingTap(0.5, 1200, 900);
    }

    getSelectedTarget() {
        return this.simEngine.targets.find(t => t.id === this.selectedTargetId);
    }
}
