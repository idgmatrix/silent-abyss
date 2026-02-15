export class SimulationTarget {
    constructor(id, config = {}) {
        this.id = id;
        this.distance = config.distance ?? 85;
        this.angle = config.angle ?? Math.PI * 0.25;
        this.bearing = config.bearing ?? 45;
        this.velocity = config.velocity ?? -0.15;
        this.detected = config.detected ?? false;
        this.rpm = config.rpm ?? 120;
        this.bladeCount = config.bladeCount ?? 3;
    }

    update(dt) {
        // dt is in seconds. The original code ran every 100ms (0.1s)
        // and used a factor of 0.1 in the calculation.
        // To maintain same speed: distance += velocity * 0.1 every 0.1s
        // Means distance += velocity * dt
        this.distance += this.velocity * dt;

        // Bounce off boundaries
        if (this.distance < 10 || this.distance > 95) {
            this.velocity *= -1;
        }

        // Update angle/bearing
        // Original: angle += 0.002 every 0.1s -> 0.02 rad/s
        this.angle += 0.02 * dt;
        this.bearing = (this.angle * 180 / Math.PI) % 360;
        if (this.bearing < 0) this.bearing += 360;
    }
}

export class SimulationEngine {
    constructor() {
        this.targets = [];
        this.onTick = null;
        this.lastUpdateTime = 0;
        this.intervalId = null;
    }

    addTarget(target) {
        this.targets.push(target);
    }

    start(tickRate = 100) {
        if (this.intervalId) return;

        this.lastUpdateTime = performance.now();
        this.intervalId = setInterval(() => {
            const now = performance.now();
            const dt = (now - this.lastUpdateTime) / 1000;
            this.lastUpdateTime = now;
            this.tick(dt);
        }, tickRate);
    }

    stop() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
    }

    tick(dt) {
        for (const target of this.targets) {
            target.update(dt);
        }

        if (this.onTick) {
            this.onTick(this.targets, dt);
        }
    }
}
