import { WSPRDecoder } from './wspr-decoder.js'

// 120 seconds @ 375 Hz = 45,000 samples. 
const MAX_SAMPLES = 45000
let decoderBufferI = new Float32Array(MAX_SAMPLES)
let decoderBufferQ = new Float32Array(MAX_SAMPLES)
let sampleIdx = 0

let isRecording = false

// Initialize the decoder once
const decoder = new WSPRDecoder()

onmessage = async function (e) {
    const data = e.data

    if (data.type === 'sample') {
        // ONLY collect if the timer says it's the right window
        if (isRecording && sampleIdx < MAX_SAMPLES) {
            decoderBufferI[sampleIdx] = data.i
            decoderBufferQ[sampleIdx] = data.q
            sampleIdx++
        }
    } else if (data.type === 'command') {
        switch (data.cmd) {
            case 'clear_buffer':
                sampleIdx = 0
                isRecording = false
                decoderBufferI.fill(0)
                decoderBufferQ.fill(0)
                break
            case 'start_recording':
                isRecording = true
                break
        }
    }

    if (data.type === 'command' && data.cmd === 'start_decode') {
        isRecording = false
        if (sampleIdx < 40000) {
            console.warn(`Worker: Not enough samples to decode (${sampleIdx}). Skipping.`)
            sampleIdx = 0
            return
        }

        console.log(`Worker: Starting decode on ${sampleIdx} samples...`)

        try {
            // We pass the collected buffers. 
            // Most WSPR decoders expect exactly 120s of data.
            const results = await decoder.decode(decoderBufferI, decoderBufferQ)
            console.log(results)
            // Send results back to the main thread (receiver.js)
            postMessage({
                type: 'decode_results',
                results: results || [],
                timestamp: new Date().toISOString()
            })

        } catch (error) {
            console.error("Worker: Decode failed", error)
            postMessage({ type: 'decode_error', error: error.message })
        }

        // Reset index for the next 2-minute cycle
        sampleIdx = 0
        decoderBufferI.fill(0)
        decoderBufferQ.fill(0)
    }
    else if (data.type === 'command' && data.cmd === 'download_c2') {
        if (sampleIdx < 40000) {
            console.warn(`Worker: Not enough samples to decode (${sampleIdx}). Skipping.`)
            sampleIdx = 0
            return
        }        
        const headerSize = 26
        const targetSamples = 45000
        const dataSize = sampleIdx * 8 // I (4 bytes) + Q (4 bytes)
        const buffer = new ArrayBuffer(headerSize + (targetSamples * 8))
        const view = new DataView(buffer)

        // 1. Header: "WSPR AD1.0" (Bytes 0-13)
        const magic = "WSPR AD1.0"
        for (let i = 0; i < magic.length; i++) {
            view.setUint8(i, magic.charCodeAt(i))
        }

        // 2. Header: ntrmin (Bytes 14-17) - Minutes since UTC midnight
        const now = new Date()
        const ntrmin = now.getUTCHours() * 60 + now.getUTCMinutes()
        view.setInt32(14, ntrmin, true) // Little Endian

        // 3. Header: dialFreq (Bytes 18-25) - Double precision
        // Replace 3.5686 with your actual dial freq or a variable
        const dialFreq = 3.5686
        view.setFloat64(18, dialFreq, true)

        // 4. IQ Data (Starts at Byte 26)
        for (let i = 0; i < targetSamples; i++) {
            const offset = headerSize + (i * 8)
            if (i < sampleIdx) {
                // We have real data
                view.setFloat32(offset, decoderBufferI[i], true)
                view.setFloat32(offset + 4, -decoderBufferQ[i], true) // Negate Q
            } else {
                // PAD with silence to reach 45,000 samples
                view.setFloat32(offset, 0.0, true)
                view.setFloat32(offset + 4, 0.0, true)
            }
        }

        // Send binary back to main thread
        postMessage({
            type: 'c2_file_ready',
            buffer: buffer,
            filename: `wspr_${ntrmin}.c2`
        }, [buffer]) // Use Transferable for speed
    }
}