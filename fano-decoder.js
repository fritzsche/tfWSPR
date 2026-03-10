/**
 * Optimized Fano Decoder
 * Uses TypedArrays to minimize GC and memory overhead.
 */
export class FanoDecoder {
    constructor(poly1 = 0xf2d05351 >>> 0, poly2 = 0xe4613c47 >>> 0, maxBits = 100) {
        this.POLY1 = poly1
        this.POLY2 = poly2

        // Pre-allocate buffers to avoid allocations during hot loops
        this._initBuffers(maxBits)
    }

    _initBuffers(nbits) {
        const size = nbits + 1
        this.encstate = new Uint32Array(size)
        this.gamma = new Int32Array(size)
        this.tm0 = new Int32Array(size) // Flattened tm[0]
        this.tm1 = new Int32Array(size) // Flattened tm[1]
        this.i_node = new Uint8Array(size)
        this.metrics = new Int32Array(size * 4) // Flattened [m0, m1, m2, m3]
        this.maxBits = nbits
    }

    // Faster parity check using XOR reduction instead of full popcount
    _getParity(encstate) {
       // const state = BigInt(encstate);
        let v1 = encstate & Number(this.POLY1)
        v1 ^= v1 >>> 16; v1 ^= v1 >>> 8; v1 ^= v1 >>> 4
        const p1 = (0x6996 >>> (v1 & 0xf)) & 1

        let v2 = encstate & Number(this.POLY2)
        v2 ^= v2 >>> 16; v2 ^= v2 >>> 8; v2 ^= v2 >>> 4
        const p2 = (0x6996 >>> (v2 & 0xf)) & 1

        return (p1 << 1) | p2
    }

    decode(symbols, nbits, mettab, delta, maxCyclesPerBit) {
        // Resize buffers only if current nbits exceeds pre-allocated size
        if (nbits > this.maxBits) this._initBuffers(nbits)

        const { metrics, encstate, gamma, tm0, tm1, i_node } = this
        const m0_tab = mettab[0]
        const m1_tab = mettab[1]

        // 1. Pre-compute metrics (Flattened access)
        for (let j = 0; j < nbits; j++) {
            const s0 = symbols[j << 1]
            const s1 = symbols[(j << 1) | 1]
            const base = j << 2

            metrics[base] = m0_tab[s0] + m0_tab[s1] // 00
            metrics[base + 1] = m0_tab[s0] + m1_tab[s1] // 01
            metrics[base + 2] = m1_tab[s0] + m0_tab[s1] // 10
            metrics[base + 3] = m1_tab[s0] + m1_tab[s1] // 11
        }

        let ptr = 0
        let t = 0
        const maxCycles = maxCyclesPerBit * nbits
        let cycle = 0

        // Initialize root node
        encstate[0] = 0
        gamma[0] = 0
        let lsym = this._getParity(0)
        let m0 = metrics[lsym]
        let m1 = metrics[3 ^ lsym]

        if (m0 > m1) {
            tm0[0] = m0; tm1[0] = m1
        } else {
            tm0[0] = m1; tm1[0] = m0
            encstate[0] = 1
        }
        i_node[0] = 0

        const tailIdx = nbits - 31

        // 2. Main Fano Loop
        for (cycle = 1; cycle <= maxCycles; cycle++) {
            // ngamma = current_gamma + current_metric_for_this_branch
            let ngamma = gamma[ptr] + (i_node[ptr] === 0 ? tm0[ptr] : tm1[ptr])

            if (ngamma >= t) {
                if (gamma[ptr] < t + delta) {
                    while (ngamma >= t + delta) t += delta
                }

                const nextPtr = ptr + 1
                if (nextPtr >= nbits) {
                    ptr = nextPtr
                    break
                }

                gamma[nextPtr] = ngamma
                const nextState = (encstate[ptr] << 1) >>> 0
                encstate[nextPtr] = nextState
                ptr = nextPtr

                let lsym = this._getParity(nextState)
                const mBase = ptr << 2

                if (ptr >= tailIdx) {
                    tm0[ptr] = metrics[mBase + lsym]
                } else {
                    let m0 = metrics[mBase + lsym]
                    let m1 = metrics[mBase + (3 ^ lsym)]
                    if (m0 > m1) {
                        tm0[ptr] = m0; tm1[ptr] = m1
                    } else {
                        tm0[ptr] = m1; tm1[ptr] = m0
                        encstate[ptr] = nextState | 1
                    }
                }
                i_node[ptr] = 0
                continue
            }

            // Look backward
            let backward = true
            while (backward) {
                if (ptr === 0 || gamma[ptr - 1] < t) {
                    t -= delta
                    if (i_node[ptr] !== 0) {
                        i_node[ptr] = 0
                        encstate[ptr] ^= 1
                    }
                    backward = false
                } else {
                    ptr--
                    if (ptr < tailIdx && i_node[ptr] !== 1) {
                        i_node[ptr]++
                        encstate[ptr] ^= 1
                        backward = false
                    }
                }
            }
        }

        const success = (ptr >= nbits)
        const rawBits = new Uint8Array(nbits)
        if (success) {
            for (let j = 0; j < nbits; j++) {
                rawBits[j] = encstate[j] & 1
            }
        }

        return {
            success,
            data: rawBits,
            cycles: cycle,
            metric: ptr > 0 ? gamma[ptr - 1] : 0
        }
    }
}