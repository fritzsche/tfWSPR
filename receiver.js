import { QMXCat } from './qmx-cat.js'

class WSPRReceiver {
    constructor() {
        // 1. FULL BAND LIST RESTORED
        this.bands = {
            "160m": { dial: 1.8366 },
            "80m": { dial: 3.5686 },
            "60m": { dial: 5.2872 },
            "40m": { dial: 7.0386 },
            "30m": { dial: 10.1387 },
            "20m": { dial: 14.0956 },
            "17m": { dial: 18.1046 },
            "15m": { dial: 21.0946 },
            "12m": { dial: 24.9246 },
            "10m": { dial: 28.1246 },
            "6m": { dial: 50.2930 }
        }

        this.isRunning = false
        this.audioCtx = null

        this.ui = {
            btn: document.getElementById('power-btn'),
            badge: document.getElementById('status-badge'),
            console: document.getElementById('console-out'),
            table: document.querySelector('#decode-table tbody'),
            canvas: document.getElementById('waterfall-canvas'),
            clock: document.getElementById('clock'),
            bandSelect: document.getElementById('band-select'),
            inputMode: document.getElementById('input-mode'),
            freqDisplay: document.getElementById('freq-display'),

        }

        this.waterfallWorker = new Worker('waterfall-worker.js', { type: 'module' })
        this.decoderWorker = new Worker('decoder-worker.js', { type: 'module' })

        this.cat = new QMXCat(
            (msg) => this.log(`CAT: ${msg}`),
            (f) => this.handleCatFreqUpdate(f)
        )

        this.setupWorkerCommunication()
        this.initUI()
        setInterval(() => this.updateTimer(), 100)
        this.hasDecodedThisCycle = false
        this.isRecording = false
    }


    handleCatFreqUpdate(freqMHz) {
        const f = parseFloat(freqMHz)

        // 1. Update the digital readout
        if (this.ui.freqDisplay) {
            this.ui.freqDisplay.textContent = f.toFixed(6) + " MHz"
        }

        // 2. Logic: Make the dropdown "follow" the dial
        // Check if the current dial frequency matches one of our WSPR bands
        for (const [bandName, data] of Object.entries(this.bands)) {
            // If within 500Hz of the WSPR dial frequency, select that band in UI
            if (Math.abs(data.dial - f) < 0.0005) {
                if (this.ui.bandSelect.value !== bandName) {
                    this.ui.bandSelect.value = bandName
                    this.log(`UI Synced to ${bandName} via Rig Dial`)
                }
                return
            }
        }
    }

    setupWorkerCommunication() {
        this.waterfallWorker.onmessage = (e) => {
            if (e.data.type === 'fft_line') {
                this.drawWaterfallLine(e.data.pwr, e.data.avg)
            }
        }

        this.decoderWorker.onmessage = (e) => {
            if (e.data.type === 'spot') this.addSpotToTable(e.data.spot)
            if (e.data.type === 'status') this.log(`Decoder: ${e.data.msg}`)
            if (e.data.type === 'c2_file_ready') {
                const blob = new Blob([e.data.buffer], { type: 'application/octet-stream' })
                const url = URL.createObjectURL(blob)
                const a = document.createElement('a')
                a.href = url
                a.download = e.data.filename
                document.body.appendChild(a)
                a.click()
                document.body.removeChild(a)
                URL.revokeObjectURL(url)
            }
            if (e.data.type === 'decode_results') {
                const results = e.data.results
                results.forEach(spot => {
                    this.addSpotToTable(spot)
                })
                console.log(results)
            }
        }
    }

    initUI() {
        this.ui.canvas.width = 512
        // Restore all bands to dropdown
        Object.keys(this.bands).forEach(b => {
            this.ui.bandSelect.add(new Option(`${b} (${this.bands[b].dial} MHz)`, b))
        })

        // CAT: Fix Frequency Change logic
        this.ui.bandSelect.onchange = async (e) => {
            const bandKey = e.target.value
            const freq = this.bands[bandKey].dial
            this.log(`Changing to ${bandKey}...`)
            if (this.cat.port) {
                await this.cat.setFrequency(freq)
            }
        }

        this.ui.btn.onclick = () => this.togglePower()
        document.getElementById('cat-btn').onclick = () => this.cat.connect()
    }

    async togglePower() {
        if (this.isRunning) { location.reload(); return }

        try {
            this.audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 48000 })

            // Critical: Browsers block audio until resume() is called
            if (this.audioCtx.state === 'suspended') {
                await this.audioCtx.resume()
            }

            await this.audioCtx.audioWorklet.addModule('wspr-processor.js')

            const stream = await navigator.mediaDevices.getUserMedia({
                audio: { echoCancellation: false, autoGainControl: false, noiseSuppression: false, channelCount: 2 }
            })

            const source = this.audioCtx.createMediaStreamSource(stream)
            const wsprNode = new AudioWorkletNode(this.audioCtx, 'wspr-processor')

            wsprNode.port.onmessage = (e) => {
                if (e.data.type === 'fft_data') {
                    // RENAME the type so the worker recognizes it
                    this.waterfallWorker.postMessage({
                        type: 'iq',
                        i: e.data.i,
                        q: e.data.q
                    })
                } else if (e.data.type === 'decimated_sample') {
                    this.decoderWorker.postMessage({
                        type: 'sample',
                        i: e.data.i,
                        q: e.data.q
                    })
                }
            }

            source.connect(wsprNode)
            // Connect to destination (muted) to keep the clock pumping
            const gain = this.audioCtx.createGain()
            gain.gain.value = 0
            wsprNode.connect(gain)
            gain.connect(this.audioCtx.destination)

            this.isRunning = true
            this.ui.btn.innerText = "STOP RADIO"
            this.log("Engine Online. Waterfall should start...")

        } catch (err) {
            this.log(`Error: ${err.message}`)
        }
    }

    updateTimer() {
        const now = new Date()

        // 1. FIX: Update the UTC Clock display
        // This takes the time part of the ISO string (e.g., 12:34:56)
        this.ui.clock.textContent = now.toISOString().split('T')[1].split('.')[0] + " UTC"

        const m = now.getUTCMinutes()
        const s = now.getUTCSeconds()
        const cycleSeconds = (m % 2) * 60 + s

        // 2. PHASE LOGIC: Reset at top of cycle
        if (cycleSeconds === 0) {
            this.hasDecodedThisCycle = false
            this.isRecording = false
            this.ui.badge.innerText = "WAITING (:01)"
            this.ui.badge.className = 'badge phase-waiting' // Stable Blue/Gray
            this.decoderWorker.postMessage({ type: 'command', cmd: 'clear_buffer' })
        }

        // 3. PHASE LOGIC: Recording Window (01s to 112s)
        else if (cycleSeconds >= 1 && cycleSeconds < 112) {
            if (!this.isRecording) {
                this.isRecording = true
                this.decoderWorker.postMessage({ type: 'command', cmd: 'start_recording' })
            }
            this.ui.badge.innerText = `RX: ${cycleSeconds}s / 112s`
            this.ui.badge.className = 'badge phase-rx' // Stable Green
        }

        // 4. PHASE LOGIC: Decoding (Exactly at 112s)
        else if (cycleSeconds >= 112 && !this.hasDecodedThisCycle) {
            this.isRecording = false
            this.hasDecodedThisCycle = true
            this.ui.badge.innerText = "DECODING..."
            this.ui.badge.className = 'badge phase-decode' // Stable Amber

     //       this.decoderWorker.postMessage({ type: 'command', cmd: 'download_c2', saveFirst: true })

            this.decoderWorker.postMessage({ type: 'command', cmd: 'start_decode', saveFirst: true })


        }
    }

    drawWaterfallLine(pwr, avg) {
        const ctx = this.ui.canvas.getContext('2d')
        const { width, height } = this.ui.canvas
        const half = pwr.length / 2

        ctx.drawImage(this.ui.canvas, 0, 0, width, height - 1, 0, 1, width, height - 1)
        const imgData = ctx.createImageData(width, 1)

        const gain = parseFloat(document.getElementById('wf-gain').value)
        const floor = parseFloat(document.getElementById('wf-floor').value)

        for (let x = 0; x < width; x++) {
            let binIdx = (x + half) % width
            let db = 10 * Math.log10(pwr[binIdx] + 1e-15)
            let normalized = db + 120
            let intensity = Math.max(0, Math.min(255, (normalized - floor) * (gain / 10)))

            const i = x * 4

            // --- KIWI-STYLE THERMAL PALETTE ---
            let r = 0, g = 0, b = 0

            if (intensity < 64) {
                // Black to Blue
                b = intensity * 4
            } else if (intensity < 128) {
                // Blue to Magenta
                r = (intensity - 64) * 4
                b = 255
            } else if (intensity < 192) {
                // Magenta to Red
                r = 255
                b = 255 - (intensity - 128) * 4
            } else {
                // Red to Yellow
                r = 255
                g = (intensity - 192) * 4
                b = 0
            }

            imgData.data[i] = r
            imgData.data[i + 1] = g
            imgData.data[i + 2] = b
            imgData.data[i + 3] = 255
        }
        ctx.putImageData(imgData, 0, 0)
    }

    addSpotToTable(s) {
        const row = this.ui.table.insertRow(0)
        const escape = (str) => str.replace(/</g, '<').replace(/>/g, '>')
        row.innerHTML = `<td>${new Date().toISOString().substr(11, 5)}</td><td>${s.freq}</td><td>${s.snr}</td><td style="color:#00ff66">${escape(s.callsign)}</td><td>${s.grid}</td><td>${s.power}</td>`
    }

    log(msg) {
        console.log(msg)
    }
}

new WSPRReceiver()
