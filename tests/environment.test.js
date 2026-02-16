import { describe, it, expect } from 'vitest';
import { EnvironmentModel } from '../src/acoustics/environment-model.js';

describe('EnvironmentModel', () => {
    const env = new EnvironmentModel();

    it('should calculate realistic temperature at different depths', () => {
        const surfaceTemp = env.getTemperature(0);
        const deepTemp = env.getTemperature(2000);

        expect(surfaceTemp).toBeGreaterThan(15); // Warm at surface
        expect(deepTemp).toBe(4.0); // Cold in deep isothermal layer
    });

    it('should calculate sound speed using temperature and pressure', () => {
        const surfaceSpeed = env.getSoundSpeed(0);
        const deepSpeed = env.getSoundSpeed(2000);

        // Sound speed normally increases with depth/pressure despite lower temp
        // In this simplified model, let's verify it's within range 1400-1600 m/s
        expect(surfaceSpeed).toBeGreaterThan(1450);
        expect(surfaceSpeed).toBeLessThan(1550);
        expect(deepSpeed).toBeGreaterThan(1450);
        expect(deepSpeed).toBeLessThan(1600);
    });

    it('should correctly identify thermocline crossing', () => {
        // Default thermocline is at 200m
        expect(env.isThermoclineBetween(10, 50)).toBe(false);
        expect(env.isThermoclineBetween(10, 300)).toBe(true);
        expect(env.isThermoclineBetween(300, 500)).toBe(false);
    });

    it('should calculate ambient noise based on depth and sea state', () => {
        const surfaceNoise = env.getAmbientNoise(10);
        const deepNoise = env.getAmbientNoise(1000);

        expect(deepNoise).toBeLessThan(surfaceNoise); // Slightly quieter deep down
    });
});
