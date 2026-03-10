import fs from 'fs'
import { WSPRDecoder } from './wspr-decoder.js'

async function main() {
    const filename = process.argv[2]
    if (!filename) {
        console.log("Usage: node decoder.js <file.c2>")
        return
    }

    const buf = fs.readFileSync(filename)

    // Parse C2 Header (exactly matching the C struct)
    const ntrmin = buf.readInt32LE(14)
    const dialFreq = buf.readDoubleLE(18)

    // Extract IQ Data (starts at 26)
    // C code: idat[i]=buffer[2*i]; qdat[i]=-buffer[2*i+1];
    const numSamples = 45000
    const idat = new Float32Array(numSamples)
    const qdat = new Float32Array(numSamples)

    let offset = 26
    for (let i = 0; i < numSamples; i++) {
        idat[i] = buf.readFloatLE(offset)
        qdat[i] = -buf.readFloatLE(offset + 4)
        offset += 8
    }

    const decoder = new WSPRDecoder()

    // Search parameters: 
    // In a real decoder, you'd loop through possible shifts (0-150) 
    // and frequencies (around 1500Hz).
    // For a single C2 file, we assume standard offset 1500Hz.
    console.log(`Decoding ${filename}...`)
    const results = await decoder.decode(idat, qdat)

    console.log("--------------------------------")
    if (results && results.length > 0) {
        results.forEach(res => {
            console.log(`CALLSIGN: ${res.callsign}`)
            console.log(`GRID:     ${res.grid}`)
            console.log(`POWER:    ${res.power} dBm`)
        })
    } else {
        console.log("No signals decoded in this pass.")
    }
    console.log("--------------------------------")
}

main()