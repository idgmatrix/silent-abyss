export class BufferPool {
    constructor() {
        /**
         * Map of buffer length to array of available Float32Arrays.
         * @type {Map<number, Float32Array[]>}
         */
        this.pools = new Map();
    }

    /**
     * Acquire a Float32Array of the specified length.
     * If a buffer is available in the pool, it is returned (containing old data).
     * Otherwise, a new Float32Array is allocated (zeroed).
     *
     * @param {number} length
     * @returns {Float32Array}
     */
    acquire(length) {
        let pool = this.pools.get(length);
        if (!pool) {
            pool = [];
            this.pools.set(length, pool);
        }

        if (pool.length > 0) {
            return pool.pop();
        }

        return new Float32Array(length);
    }

    /**
     * Release a buffer back to the pool for reuse.
     * Use this when the buffer is no longer needed.
     *
     * @param {Float32Array} buffer
     */
    release(buffer) {
        if (!buffer || !(buffer instanceof Float32Array)) return;

        const length = buffer.length;
        let pool = this.pools.get(length);
        if (!pool) {
            pool = [];
            this.pools.set(length, pool);
        }
        pool.push(buffer);
    }

    /**
     * Clears all pooled buffers. Useful for memory cleanup.
     */
    clear() {
        this.pools.clear();
    }
}

// Global instance for general use
export const float32Pool = new BufferPool();
