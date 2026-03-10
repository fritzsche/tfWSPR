import { WSPREncoder } from './wspr-encoder.js'
import { QMXCat } from './qmx-cat.js'

export class WSPRBeacon {
    constructor() {
        this.encoder = new WSPREncoder()
        this.logEl = document.getElementById('log')
        this.cat = new QMXCat(this.logger.bind(this), (f) => {
            document.getElementById('vfo-val').textContent = f
        })

        this.audioCtx = null
        this.wsprNode = null
        this.beaconActive = false
        this.isTxActive = false
        this.lastTxMin = -1

        this.initUI()
        this.initApp()

        // Start the master timer
        setInterval(() => this.updateUI(), 500)
        this.targetTxTime = null // Holds the exact Date.getTime() for the next TX        
    }

    logger(m) {
        const t = new Date().toISOString().split('T')[1].split('.')[0]
        this.logEl.prepend(`[${t}] ${m}\n`)
    }

    initUI() {
        // Build Symbol Grid
        const grid = document.getElementById('symGrid')
        grid.innerHTML = ''
        for (let i = 0; i < 162; i++) {
            const div = document.createElement('div')
            div.className = 'sym-box'
            div.id = `sym-${i}`
            div.textContent = i
            grid.appendChild(div)
        }


        const bandSelect = document.getElementById('band')
        bandSelect.onchange = () => this.syncFrequencyToRig()

        // Event Bindings
        document.getElementById('btnSerial').onclick = () => this.connectSerial()
        document.getElementById('simMode').onchange = (e) => this.cat.isSimMode = e.target.checked
        document.getElementById('btnMain').onclick = () => this.toggleBeacon()

        const audioSelect = document.getElementById('audioOutput')
        audioSelect.onchange = () => localStorage.setItem('wspr_audio_device', audioSelect.value)
    }

    async initApp() {
        await this.initAudioSelection()
        if (localStorage.getItem('qmx_connected') === 'true') {
            const success = await this.cat.autoConnectIfPossible()
            if (!success) localStorage.setItem('qmx_connected', 'false')
        }
    }


    /**
     * Sends the currently selected band frequency to the QMX immediately.
     * Formats MHz to padded 11-digit Hz for Kenwood TS-480 compatibility.
     */
    async syncFrequencyToRig() {
        if (!this.cat || !this.cat.port) {
            this.logger("Note: Band changed in UI, but QMX is not connected.")
            return
        }

        const bandHz = parseFloat(document.getElementById('band').value)
        // const bandHz = Math.round(bandMHz * 1000000)

        this.logger(`Syncing Rig to: ${bandHz.toFixed(4)} MHz`)

        // We send the frequency in Hz. 
        // QMXCat.setFrequency should handle the "FA" prefix and padding internally.
        await this.cat.setFrequency(bandHz)
    }

    async initAudioSelection() {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
            stream.getTracks().forEach(t => t.stop())
            const devices = await navigator.mediaDevices.enumerateDevices()
            const select = document.getElementById('audioOutput')
            select.innerHTML = ''

            devices.filter(d => d.kind === 'audiooutput').forEach(d => {
                const opt = document.createElement('option')
                opt.value = d.deviceId
                opt.text = d.label || `Output ${select.length + 1}`
                select.appendChild(opt)
            })

            const saved = localStorage.getItem('wspr_audio_device')
            if (saved) select.value = saved
        } catch (e) {
            this.logger("Audio Device Error: " + e.message)
        }
    }

    async connectSerial() {
        await this.cat.connect()
        if (this.cat.port) localStorage.setItem('qmx_connected', 'true')
    }

    async toggleBeacon() {
        const btn = document.getElementById('btnMain')
        if (!this.beaconActive) {
            this.beaconActive = true
            btn.textContent = "STOP BEACON"
            btn.classList.add('active')

            // --- CALCULATE THE FIRST SLOT ---
            const now = new Date()
            let firstSlot = new Date(now.getTime())
            firstSlot.setUTCSeconds(0, 0) // Start at 00 seconds

            // If we are already in an even minute and past the 1s mark, 
            // or if we are in an odd minute, move to the next even minute.
            const isEven = firstSlot.getUTCMinutes() % 2 === 0
            const tooLateInMinute = now.getUTCSeconds() >= 1

            if (!isEven || tooLateInMinute) {
                // Add minutes until we hit the next even one
                const minutesToAdd = isEven ? 2 : 1
                firstSlot.setUTCMinutes(firstSlot.getUTCMinutes() + minutesToAdd)
            }

            // Standard WSPR start delay is 1.5 seconds into the minute
            this.targetTxTime = firstSlot.getTime() + 1500

            this.logger(`Beacon: Activated. Next slot at ${firstSlot.toISOString().split('T')[1].substring(0, 5)}:01`)

            if (!this.audioCtx) {
                this.audioCtx = new AudioContext()
                const sinkId = document.getElementById('audioOutput').value
                if (sinkId && this.audioCtx.setSinkId) await this.audioCtx.setSinkId(sinkId)
                await this.audioCtx.audioWorklet.addModule('tx-processor.js')
                this.wsprNode = new AudioWorkletNode(this.audioCtx, 'tx-processor')
                this.wsprNode.connect(this.audioCtx.destination)
                this.wsprNode.port.onmessage = (e) => this.handleProcessorMessage(e.data)
            }
        } else {
            this.stopEverything()
            this.beaconActive = false
            this.targetTxTime = null // Clear the timer
            btn.textContent = "START BEACON"
            btn.classList.remove('active')
            this.logger("Beacon: STOPPED.")
        }
    }

    handleProcessorMessage(data) {
        if (data.type === 'SYMBOL') {
            document.querySelectorAll('.sym-box').forEach(b => b.classList.remove('active'))
            const el = document.getElementById(`sym-${data.index}`)
            if (el) {
                el.classList.add('active', 'done')
                el.textContent = data.val
            }
            document.getElementById('info-sym').textContent = `#${data.index}`
            document.getElementById('info-delta').textContent = data.delta
            document.getElementById('info-full').textContent = data.freq
        }
        if (data.type === 'DONE') this.stopEverything()
    }

    async stopEverything() {
        this.isTxActive = false
        if (this.wsprNode) this.wsprNode.port.postMessage({ type: 'STOP' })
        await this.cat.setPTT(false)
        document.getElementById('info-sym').textContent = "#--"
        document.getElementById('info-delta').textContent = "--"
        document.getElementById('info-full').textContent = "----"
    }

    async startTx() {
        this.isTxActive = true
        this.logger("Beacon: Starting TX Cycle...")

        await this.syncFrequencyToRig()

        const offset = parseInt(document.getElementById('offset').value)
        const symbols = this.encoder.generateSymbols(
            document.getElementById('call').value,
            document.getElementById('grid').value,
            parseInt(document.getElementById('pow').value)
        )

        document.querySelectorAll('.sym-box').forEach(b => b.classList.remove('active', 'done'))
        document.getElementById('info-center').textContent = 1500 + offset


        await this.cat.setPTT(true)
        this.wsprNode.port.postMessage({ type: 'START', symbols, centerFreq: 1500 + offset })
    }

    updateUI() {
        const now = new Date()
        const clockEl = document.getElementById('clock')
        const timerEl = document.getElementById('timer-display')

        clockEl.textContent = now.toISOString().split('T')[1].split('.')[0]

        if (this.isTxActive) {
            timerEl.textContent = "TRANSMITTING"
            timerEl.style.color = "#ff3300"
            return
        }

        if (!this.beaconActive || !this.targetTxTime) {
            timerEl.textContent = "OFFLINE"
            timerEl.style.color = "#888"
            return
        }

        const nowMs = now.getTime()
        const diffMs = this.targetTxTime - nowMs

        if (diffMs <= 0) {
            // --- TRIGGER TRANSMISSION ---
            const intervalMins = parseInt(document.getElementById('interval').value) || 10

            this.startTx()

            // Schedule the NEXT transmission based on the current target + interval
            // This ensures the 10-minute cadence stays locked to the clock
            this.targetTxTime += (intervalMins * 60 * 1000)
        } else {
            // Show countdown
            this.renderCountdown(diffMs, timerEl)
        }
    }

    renderCountdown(ms, el) {
        const totalSec = Math.ceil(ms / 1000)
        const m = Math.floor(totalSec / 60)
        const s = totalSec % 60
        el.textContent = `NEXT TX IN ${m}:${s.toString().padStart(2, '0')}`
        el.style.color = "#ffcc00"
    }

}