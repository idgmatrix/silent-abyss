/**
 * EnvironmentModel handles the physical properties of the water column.
 * It provides depth-dependent sound speed profiles, temperature gradients,
 * and ambient noise characteristics.
 */
export class EnvironmentModel {
    constructor() {
        // Standard profiles
        this.profiles = {
            DEEP_OCEAN: {
                surfaceTemp: 20, // Celsius
                thermoclineDepth: 200, // Meters
                isothermalDepth: 1000,
                bottomDepth: 4000,
                surfaceDuctDepth: 60,
                convergenceZoneStart: 900,
                convergenceZoneInterval: 800,
                convergenceZoneWidth: 120
            },
            COASTAL: {
                surfaceTemp: 15,
                thermoclineDepth: 50,
                isothermalDepth: 150,
                bottomDepth: 300,
                surfaceDuctDepth: 35,
                convergenceZoneStart: 450,
                convergenceZoneInterval: 450,
                convergenceZoneWidth: 80
            }
        };

        this.currentProfile = this.profiles.DEEP_OCEAN;
        this.seaState = 2; // Moderate sea state for balanced detection
        this.shippingLaneDensity = 0.35;
        this.precipitationLevel = 0;
        this.iceCoverage = 0;
        this.biologicActivity = 0.2;
        this.seismicActivity = 0.08;
        this.ventActivity = 0.04;
    }

    /**
     * Calculates Sound Speed (m/s) at a given depth using Wilson's simplified formula or similar.
     * Speed increases with Temperature, Salinity, and Pressure (Depth).
     * @param {number} depth - Depth in meters
     * @returns {number} Sound speed in m/s
     */
    getSoundSpeed(depth) {
        const temp = this.getTemperature(depth);
        const salinity = 35; // Parts per thousand (simplified constant)

        // Medwin's formula (simplified for common use)
        // c = 1449.2 + 4.6T - 0.055T^2 + 0.00029T^3 + (1.34 - 0.01T)(S - 35) + 0.016z
        const speed = 1449.2 +
                      (4.6 * temp) -
                      (0.055 * Math.pow(temp, 2)) +
                      (0.00029 * Math.pow(temp, 3)) +
                      ((1.34 - 0.01 * temp) * (salinity - 35)) +
                      (0.016 * depth);

        return speed;
    }

    /**
     * Estimates water temperature at depth based on profile.
     * @param {number} depth - Depth in meters
     * @returns {number} Temperature in Celsius
     */
    getTemperature(depth) {
        const { surfaceTemp, thermoclineDepth, isothermalDepth } = this.currentProfile;

        if (depth < thermoclineDepth) {
            // Mixed layer - slight decrease
            return surfaceTemp - (depth / thermoclineDepth) * 1.0;
        } else if (depth < isothermalDepth) {
            // Main thermocline - rapid decrease
            const thermoclineWidth = isothermalDepth - thermoclineDepth;
            const progress = (depth - thermoclineDepth) / thermoclineWidth;
            return (surfaceTemp - 1.0) - (progress * 15.0); // Drops to ~4C
        } else {
            // Deep isothermal layer - stable cold
            return 4.0;
        }
    }

    /**
     * Calculates ambient noise level in dB relative to 1uPa.
     * Combines shipping noise, sea state / wind noise, and thermal noise.
     * @param {number} depth - Depth in meters
     * @param {number} frequency - Center frequency in Hz (optional)
     * @returns {number} Noise level in dB
     */
    getAmbientNoise(depth, frequency = 1000) {
        const f = Math.max(1, Number(frequency) || 1000);
        const depthMeters = Math.max(0, Number(depth) || 0);

        // Knudsen-like sea-state noise: flatter at LF, rolls down above ~1 kHz.
        const seaStateLevel = 48 + 5.5 * this.seaState;
        const seaStateShape = f < 300 ? 0 : -20 * Math.log10(f / 300);

        // Distant shipping dominates LF background.
        const shippingBandWeight = f <= 200 ? 1.0 : f <= 800 ? 0.45 : 0.12;
        const shippingNoise = (44 + 18 * this.shippingLaneDensity) * shippingBandWeight;

        // Seismic and vent sources are mostly LF and nearly isotropic.
        const seismicNoise = f < 20 ? 18 * this.seismicActivity : 6 * this.seismicActivity;
        const ventNoise = f < 120 ? 10 * this.ventActivity : 4 * this.ventActivity;

        // Tropical biologics and precipitation raise masking in the mid/high bands.
        const shrimpMask = f > 1500 ? 16 * this.biologicActivity * (0.4 + this.seaState / 9) : 0;
        const precipitationMask = f > 800 ? 20 * this.precipitationLevel * Math.log10(f / 700 + 1) : 0;
        const iceMask = this.iceCoverage > 0 ? (f < 1200 ? 14 * this.iceCoverage : 6 * this.iceCoverage) : 0;

        // Slight deep-water reduction in direct surface-driven ambient energy.
        const depthFactor = depthMeters > 500 ? -3 : depthMeters > 150 ? -1.5 : 0;

        return seaStateLevel + seaStateShape + shippingNoise + seismicNoise + ventNoise + shrimpMask + precipitationMask + iceMask + depthFactor;
    }

    /**
     * Determines if a refraction layer exists between two depths.
     * Used for shadow zone calculations.
     * @param {number} depthA
     * @param {number} depthB
     * @returns {boolean}
     */
    isThermoclineBetween(depthA, depthB) {
        const minDepth = Math.min(depthA, depthB);
        const maxDepth = Math.max(depthA, depthB);
        return minDepth < this.currentProfile.thermoclineDepth && maxDepth > this.currentProfile.thermoclineDepth;
    }

    /**
     * Gets the intensity of the thermocline refraction gradient.
     */
    getRefractionGradient() {
        return 0.5; // Placeholder for ray-bending intensity
    }

    isInSurfaceDuct(depth) {
        const d = Math.max(0, Number(depth) || 0);
        return d <= this.currentProfile.surfaceDuctDepth;
    }

    getConvergenceZoneBand(rangeMeters) {
        const range = Math.max(0, Number(rangeMeters) || 0);
        const start = this.currentProfile.convergenceZoneStart;
        const interval = this.currentProfile.convergenceZoneInterval;
        const width = this.currentProfile.convergenceZoneWidth;

        if (range < start) {
            return { inBand: false, bandIndex: -1, offset: range - start };
        }

        const relative = range - start;
        const bandIndex = Math.max(0, Math.round(relative / interval));
        const center = start + bandIndex * interval;
        const offset = range - center;
        const inBand = Math.abs(offset) <= width;

        return { inBand, bandIndex, offset };
    }

    getAcousticModifiers(ownDepth, targetDepth, rangeMeters) {
        const own = Math.max(0, Number(ownDepth) || 0);
        const target = Math.max(0, Number(targetDepth) || 0);
        const range = Math.max(1, Number(rangeMeters) || 1);

        let snrModifierDb = 0;
        let echoGain = 1;
        let notes = [];
        let highFreqLossDb = 0;
        let lowFreqLossDb = 0;

        const ownInDuct = this.isInSurfaceDuct(own);
        const targetInDuct = this.isInSurfaceDuct(target);
        const ductActive = ownInDuct && targetInDuct && range >= 200 && range <= 2200;

        if (ductActive) {
            // Surface duct channels acoustic energy near the surface.
            snrModifierDb += 4.5;
            echoGain *= 1.16;
            notes.push('surface-duct');
        }

        const convergence = this.getConvergenceZoneBand(range);
        const deepEnough = own >= this.currentProfile.surfaceDuctDepth || target >= this.currentProfile.surfaceDuctDepth;
        if (deepEnough && convergence.inBand) {
            // Convergence zone can improve long-range detectability in repeating bands.
            snrModifierDb += 3.0;
            echoGain *= 1.1;
            notes.push(`cz-${convergence.bandIndex + 1}`);
        }

        if (this.isThermoclineBetween(own, target)) {
            const crossingDepth = this.currentProfile.thermoclineDepth;
            const crossingSeverity = Math.min(1, Math.abs(own - target) / Math.max(40, crossingDepth));
            highFreqLossDb += 4 + 8 * crossingSeverity;
            lowFreqLossDb += 1.5 * crossingSeverity;
            snrModifierDb -= 1.5 + 2.5 * crossingSeverity;
            notes.push('thermocline');
        }

        // Lloyd's mirror / surface interference is strongest for shallow geometry.
        const shallowPath = Math.max(0, this.currentProfile.surfaceDuctDepth - Math.max(own, target));
        if (shallowPath > 0) {
            const mirrorPhase = (range / 180) + shallowPath / 40;
            const mirrorDb = Math.sin(mirrorPhase) * (1.2 + shallowPath / 120);
            snrModifierDb += mirrorDb;
            notes.push('lloyds-mirror');
        }

        // Bottom bounce at longer range helps LF returns but costs HF detail.
        const bottomClearance = this.currentProfile.bottomDepth - Math.max(own, target);
        if (range > 2200 && bottomClearance > 100) {
            lowFreqLossDb -= 1.5;
            highFreqLossDb += 3.0;
            echoGain *= 1.05;
            notes.push('bottom-bounce');
        }

        return {
            snrModifierDb,
            echoGain,
            notes,
            highFreqLossDb,
            lowFreqLossDb,
            ductActive,
            convergenceBand: convergence.inBand ? convergence.bandIndex + 1 : null
        };
    }

    sampleWaterColumn(depthStep = 25, maxDepth = null) {
        const step = Math.max(5, depthStep);
        const limit = Math.max(step, maxDepth ?? this.currentProfile.bottomDepth);
        const samples = [];

        for (let depth = 0; depth <= limit; depth += step) {
            samples.push({
                depth,
                temperature: this.getTemperature(depth),
                soundSpeed: this.getSoundSpeed(depth),
                inSurfaceDuct: this.isInSurfaceDuct(depth)
            });
        }

        return samples;
    }
}
