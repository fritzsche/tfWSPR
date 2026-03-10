// wspr-processor.js
class WSPRProcessor extends AudioWorkletProcessor {
    constructor() {
        super()
        this.targetRate = 375.0
        this.decimationFactor = Math.round(sampleRate / this.targetRate)
        this.phase = 0
        const downmix = 1500.0 + 12000.0
        this.phaseInc = (2 * Math.PI * downmix) / sampleRate
/*
        this.numTaps = 47
        this.coeffs = this.generateLowPass(this.numTaps, 175.0 / sampleRate)
        */
        this.numTaps = 101
        this.coeffs = this.generateLowPass(this.numTaps, 100.0 / sampleRate)
        this.bufI = new Float32Array(this.numTaps).fill(0)
        this.bufQ = new Float32Array(this.numTaps).fill(0)
        this.count = 0
        this.bufPtr = 0

        this.rotReal = Math.cos(this.phaseInc)
        this.rotImag = Math.sin(this.phaseInc)
        this.vReal = 1.0 // Current vector Real
        this.vImag = 0.0 // Current vector Imag        
    }

    generateLowPass(n, cutoff) {
        const f = new Float32Array(n)
        const mid = (n - 1) / 2
        for (let i = 0; i < n; i++) {
            if (i === mid) f[i] = 2 * cutoff
            else {
                const x = Math.PI * (i - mid)
                f[i] = Math.sin(2 * cutoff * x) / x
            }
            f[i] *= (0.54 - 0.46 * Math.cos(2 * Math.PI * i / (n - 1)))
        }
        return f
    }

    process(inputs) {
        const input = inputs[0]
        if (!input || !input[0]) return true

        const I = input[0]
        const Q = input[1] || input[0]

        for (let i = 0; i < I.length; i++) {
            // Add it to whatever is coming from the hardware
            let currentI = I[i]
            let currentQ = Q[i]

            // 2. MIXING (Shift 1500Hz to 0Hz)

            // Complex Multiply: (currentI + j*currentQ) * (vReal - j*vImag)
            const mixedI = currentI * this.vReal + currentQ * this.vImag
            const mixedQ = currentQ * this.vReal - currentI * this.vImag

            // Rotate the phasor for the next sample
            const nextVReal = this.vReal * this.rotReal - this.vImag * this.rotImag
            const nextVImag = this.vReal * this.rotImag + this.vImag * this.rotReal
            this.vReal = nextVReal
            this.vImag = nextVImag

            // Periodic renormalization (every 1000 samples) to prevent rounding drift
            if (this.count % 1000 === 0) {
                const mag = Math.sqrt(this.vReal * this.vReal + this.vImag * this.vImag)
                this.vReal /= mag
                this.vImag /= mag
            }


            /*            
                        const s = Math.sin(this.phase)
                        const c = Math.cos(this.phase)
                        const mixedI = currentI * c + currentQ * s
                        const mixedQ = currentQ * c - currentI * s
                        this.phase += this.phaseInc
            */
            // 3. FILTER & DECIMATE
            this.bufI[this.bufPtr] = mixedI
            this.bufQ[this.bufPtr] = mixedQ
            if (this.count % this.decimationFactor === 0) {
                let outI = 0, outQ = 0
                for (let j = 0; j < this.numTaps; j++) {
                    // Read "backwards" from the pointer to apply filter coefficients
                    let idx = (this.bufPtr - j + this.numTaps) % this.numTaps
                    outI += this.bufI[idx] * this.coeffs[j]
                    outQ += this.bufQ[idx] * this.coeffs[j]
                }
                // Send to main thread
                this.port.postMessage({ type: 'fft_data', i: outI, q: outQ })
                this.port.postMessage({ type: 'decimated_sample', i: outI, q: outQ })
            }
            this.count++
            this.bufPtr = (this.bufPtr + 1) % this.numTaps
        }
        return true
    }
}
registerProcessor('wspr-processor', WSPRProcessor)