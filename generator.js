import fs from 'fs';
import { WSPREncoder } from './wspr-encoder.js';

async function generatePerfectC2(filename) {
    const encoder = new WSPREncoder();
    const symbols = encoder.generateSymbols("DJ1TF", "JN49", 33);
    
    const sampleRate = 375.0;
    const numSamples = 45000;
    const samplesPerSymbol = 256; 
    const df = 375.0 / 256.0; // Tone spacing (1.4648 Hz)
    
    const idat = new Float32Array(numSamples).fill(0);
    const qdat = new Float32Array(numSamples).fill(0);
    
    // f0 = Frequency offset (e.g., 100Hz above sub-band start)
    // t0 = 1.0 second delay (375 samples)
    const f0 = 100.0;
    const idelay = 375; 

    let phi = 0;
    const twopidt = (2 * Math.PI) / sampleRate;

    for (let i = 0; i < symbols.length; i++) {
        // MATCHING REFERENCE: (symbol - 1.5) centers the 4 tones around f0
        const dphi = twopidt * (f0 + (symbols[i] - 1.5) * df);
        
        for (let j = 0; j < samplesPerSymbol; j++) {
            const idx = idelay + (i * samplesPerSymbol) + j;
            if (idx < numSamples) {
                idat[idx] = Math.cos(phi);
                qdat[idx] = Math.sin(phi);
                phi += dphi;
            }
        }
    }

    // Write C2 File
    const outBuffer = Buffer.alloc(26 + (numSamples * 8));
    
    // Header: 14 bytes for "timestamp" (filename string in wsprsim)
    const headerStr = "260130_0900   ".substring(0, 14);
    outBuffer.write(headerStr, 0, 'ascii');
    
    // ntrmin (Minutes past midnight) and frequency
    outBuffer.writeInt32LE(540, 14); // 09:00 UTC
    outBuffer.writeDoubleLE(14.0956, 18);

    // MATCHING REFERENCE: Interleave and negate Q
    for (let i = 0; i < numSamples; i++) {
        const offset = 26 + (i * 8);
        outBuffer.writeFloatLE(idat[i], offset);      // I
        outBuffer.writeFloatLE(-qdat[i], offset + 4); // -Q (CRITICAL)
    }

    fs.writeFileSync(filename, outBuffer);
    console.log(`Generated: ${filename}`);
}

generatePerfectC2("ref_test.c2");