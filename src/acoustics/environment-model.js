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
        // Knudsen Curves approximation
        // Sea state noise (increases with wind/state)
        const seaStateNoise = 40 + (20 * Math.log10(this.seaState + 1));

        // Shipping noise (dominant at lower frequencies)
        const shippingNoise = frequency < 500 ? 60 : 40;

        // Depth attenuation (noise is slightly lower deep down due to surface distance)
        const depthFactor = depth > 500 ? -3 : 0;

        return shippingNoise + seaStateNoise + depthFactor;
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

        return {
            snrModifierDb,
            echoGain,
            notes,
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
