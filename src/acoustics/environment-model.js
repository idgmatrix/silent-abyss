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
                bottomDepth: 4000
            },
            COASTAL: {
                surfaceTemp: 15,
                thermoclineDepth: 50,
                isothermalDepth: 150,
                bottomDepth: 300
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
}
