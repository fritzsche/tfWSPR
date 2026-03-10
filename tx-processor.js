class TXProcessor extends AudioWorkletProcessor {
    constructor() {
        super()
        this.phase = 0
        this.symbolIndex = -1
        this.symbols = new Uint8Array(162)
        this.samplesPerSymbol = 256 * (sampleRate / 375)
        this.currentSampleCount = 0
        this.active = false
        this.centerFreq = 1500

        this.port.onmessage = (e) => {
            if (e.data.type === 'START') {
                this.symbols = e.data.symbols
                this.centerFreq = e.data.centerFreq
                this.symbolIndex = 0
                this.currentSampleCount = 0
                this.active = true
            }
            if (e.data.type === 'STOP') {
                this.active = false
                this.phase = 0
                this.symbolIndex = -1
            }
        }
    }

    process(inputs, outputs) {
        const output = outputs[0][0]
        if (!this.active) {
            output.fill(0) // Ensure silence when inactive
            return true
        }

        const df = 375.0 / 256.0
        for (let i = 0; i < output.length; i++) {
            if (this.symbolIndex >= 162) {
                this.active = false
                this.port.postMessage({ type: 'DONE' })
                return true
            }

            const symbolVal = this.symbols[this.symbolIndex]
            const freqDelta = (symbolVal - 1.5) * df
            const freq = this.centerFreq + freqDelta
            const dPhi = (2 * Math.PI * freq) / sampleRate

            output[i] = Math.sin(this.phase) * 0.98; //0.5
            this.phase += dPhi
            this.currentSampleCount++

            if (this.currentSampleCount >= this.samplesPerSymbol) {
                // 1. Send the message for the CURRENT symbol BEFORE incrementing
                this.port.postMessage({
                    type: 'SYMBOL',
                    index: this.symbolIndex,
                    val: symbolVal,
                    freq: (this.centerFreq + freqDelta).toFixed(2),
                    delta: freqDelta.toFixed(2)
                })

                // 2. Now reset and increment for the next sample/symbol
                this.currentSampleCount = 0
                this.symbolIndex++
            }
        }
        return true
    }
}
registerProcessor('tx-processor', TXProcessor)