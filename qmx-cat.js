export class QMXCat {
    constructor(logger, onFreqUpdate) {
        this.port = null
        this.writer = null
        this.reader = null
        this.logger = logger
        this.isSimMode = false
        this.onFreqUpdate = onFreqUpdate
        this.keepReading = true
    }

    async connect() {
        try {
            this.port = await navigator.serial.requestPort()
            await this.port.open({ baudRate: 38400 })
            this.writer = this.port.writable.getWriter()
            this.logger("Serial Port: Connected and Polling.\n")
            this.startReading()
            this.poll()
            setInterval(() => this.poll(), 1000)
        } catch (e) {
            this.logger("Serial Error: " + e.message + "\n")
        }
    }

    async autoConnectIfPossible() {
        const ports = await navigator.serial.getPorts()
        if (ports.length > 0) {
            this.port = ports[0]
            try {
                await this.port.open({ baudRate: 38400 })
                this.writer = this.port.writable.getWriter()
                this.logger("Serial Port: Auto-Reconnected.\n")
                this.startReading()
                setInterval(() => this.poll(), 2000)
                return true
            } catch (e) {
                this.logger("Auto-Connect failed: " + e.message + "\n")
            }
        }
        return false
    }

    async poll() { if (this.writer && !this.isSimMode) await this.send('FA') }

    async startReading() {
        while (this.port.readable && this.keepReading) {
            this.reader = this.port.readable.getReader()
            try {
                let buffer = ""
                while (true) {
                    const { value, done } = await this.reader.read()
                    if (done) break
                    buffer += new TextDecoder().decode(value)
                    if (buffer.includes(';')) {
                        const parts = buffer.split(';')
                        buffer = parts.pop()
                        parts.forEach(msg => {
                            if (msg.startsWith('FA')) {
                                const f = (parseInt(msg.substring(2)) / 1000000).toFixed(6)
                                this.onFreqUpdate(f)
                            }
                        })
                    }
                }
            } catch (e) { this.logger("Read Error: " + e + "\n") }
            finally { this.reader.releaseLock() }
        }
    }

    async send(cmd) {
        if (this.isSimMode) { this.logger(`[SIM] CAT Send: ${cmd}\n`); return }
        if (!this.writer) return
        const textCmd = new TextEncoder().encode(cmd + ';')
        await this.writer.write(textCmd)
    }

    async setPTT(on) {
        this.logger(`CAT: PTT ${on ? 'ON (TX)' : 'OFF (RX)'}\n`)
        await this.send(on ? 'TX' : 'RX')
    }

    async setFrequency(freqMHz) {
        // QMX+ expects 11 digits in Hz. 
        // We multiply by 1,000,000 and round to ensure no floating point errors.
        const hz = Math.round(freqMHz * 1000000).toString().padStart(11, '0')
        this.logger(`CAT: Set Dial Frequency to ${freqMHz} MHz (${hz} Hz)\n`)
        await this.send(`FA${hz}`)
    }

    async setIQMode(enabled) {
        const val = enabled ? 1 : 0
        this.logger(`CAT: Setting IQ Mode to ${val}\n`)
        await this.send(`Q9${val}`)
    }
}