import { TrackState, SimulationTarget } from './simulation.js';

export class WorldModel {
    constructor(simEngine, audioSys, tacticalView, sonarVisuals) {
        this.simEngine = simEngine;
        this.audioSys = audioSys;
        this.tacticalView = tacticalView;
        this.sonarVisuals = sonarVisuals;

        this.selectedTargetId = null;
        this.isScanning = false;
        this.scanRadius = 0;
        this.pingActiveIntensity = 0;
        this.ownShipCourse = 0;
        this.elapsedTime = 0; // Simulation time in seconds

        // Configuration
        this.detectionThreshold = 1.5;
        this.lostTrackTimeout = 5.0; // 5 seconds
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

        this.tacticalView.updateTargetOpacities();
    }

    processPassiveDetection() {
        this.simEngine.targets.forEach(target => {
            const sig = target.getAcousticSignature();
            const snr = sig / (Math.pow(target.distance / 10, 1.5) + 1);
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

    processActiveScanning() {
        this.scanRadius += 4.5;
        this.tacticalView.setScanExUniforms(this.scanRadius, true);

        this.simEngine.targets.forEach(target => {
            // If scanning past target and it's not already tracked by active scan this pulse
            // We use a temporary flag or checking if it was just detected in this scan
            // For simplicity, let's say active scan always moves it to TRACKED
            if (this.scanRadius >= target.distance && target.state !== TrackState.TRACKED) {
                target.state = TrackState.TRACKED;
                target.lastDetectedTime = this.elapsedTime;

                this.audioSys.createPingTap(0.4, 1000, 980);
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

    triggerPing() {
        if (this.isScanning || !this.audioSys.getContext()) return;
        this.isScanning = true;
        this.scanRadius = 0;
        this.pingActiveIntensity = 1.0;
        this.tacticalView.setScanExUniforms(0, true);
        this.audioSys.createPingTap(0.5, 1200, 900);
    }

    getSelectedTarget() {
        return this.simEngine.targets.find(t => t.id === this.selectedTargetId);
    }
}
