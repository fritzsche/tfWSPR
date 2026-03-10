import { FanoDecoder } from './fano-decoder.js'
import { FFT } from './fft.js'
import { WSPR } from './WSPR.js'
import { Logger } from './logger.js'

export class WSPRDecoder extends WSPR {
    constructor() {
        super()
        this.log = new Logger()
        // Re-use Fano instance
        this.fano = new FanoDecoder(WSPR.POLY1, WSPR.POLY2, 162)
        this.PR3 = WSPR.PR3
        this.CHAR_MAP = WSPR.CHAR_MAP

        // --- PRE-ALLOCATED BUFFERS (Zero-GC Path) ---
        this.window = new Float32Array(512)
        for (let i = 0; i < 512; i++) this.window[i] = Math.sin((Math.PI * i) / 511)

        this.fft = new FFT()
        this.re = new Float64Array(512)
        this.im = new Float64Array(512)
        this.psavg = new Float32Array(512)
        this.smspec = new Float32Array(512)

        // Pre-compute deinterleave map
        this.deinterleaveMap = new Uint16Array(162)
        let p_idx = 0
        for (let i = 0; p_idx < 162; i++) {
            let res = 0
            for (let b = 0; b < 8; b++) res = (res << 1) | ((i >> b) & 1)
            if (res < 162) this.deinterleaveMap[p_idx++] = res
        }

        // --- SINE/COSINE LOOKUP TABLE (LUT) ---
        // 8192 points provide high precision for tone extraction
        this.LUT_SIZE = 8192
        this.sinTable = new Float64Array(this.LUT_SIZE + 1)
        this.cosTable = new Float64Array(this.LUT_SIZE + 1)
        for (let i = 0; i <= this.LUT_SIZE; i++) {
            const angle = (2.0 * Math.PI * i) / this.LUT_SIZE
            this.sinTable[i] = Math.sin(angle)
            this.cosTable[i] = Math.cos(angle)
        }

        this._setupMetricTable()

        // Pre-allocate the Power Spectrum grid: ps[bin][time]
        // 512 frequency bins, each holding up to 400 time slices (WSPR-2 needs ~350)
        this.MAX_TIME_SLICES = 400
        this.ps = Array.from({ length: 512 }, () => new Float32Array(this.MAX_TIME_SLICES))

        // Summary spectrum (1D) for initial peak detection
        this.psavg = new Float32Array(512)

        this.hashtab = new Map()
    }


    // Initialize the metric table 
    _setupMetricTable() {
        const bias = 0.45
        // This is metric_tables[2] from the C source (Es/No=6dB)
        const metric_table_6dB = [
            0.9999, 0.9998, 0.9998, 0.9998, 0.9998, 0.9998, 0.9997, 0.9997, 0.9997, 0.9997,
            0.9997, 0.9996, 0.9996, 0.9996, 0.9995, 0.9995, 0.9994, 0.9994, 0.9994, 0.9993,
            0.9993, 0.9992, 0.9991, 0.9991, 0.9990, 0.9989, 0.9988, 0.9988, 0.9988, 0.9986,
            0.9985, 0.9984, 0.9983, 0.9982, 0.9980, 0.9979, 0.9977, 0.9976, 0.9974, 0.9971,
            0.9969, 0.9968, 0.9965, 0.9962, 0.9960, 0.9957, 0.9953, 0.9950, 0.9947, 0.9941,
            0.9937, 0.9933, 0.9928, 0.9922, 0.9917, 0.9911, 0.9904, 0.9897, 0.9890, 0.9882,
            0.9874, 0.9863, 0.9855, 0.9843, 0.9832, 0.9819, 0.9806, 0.9792, 0.9777, 0.9760,
            0.9743, 0.9724, 0.9704, 0.9683, 0.9659, 0.9634, 0.9609, 0.9581, 0.9550, 0.9516,
            0.9481, 0.9446, 0.9406, 0.9363, 0.9317, 0.9270, 0.9218, 0.9160, 0.9103, 0.9038,
            0.8972, 0.8898, 0.8822, 0.8739, 0.8647, 0.8554, 0.8457, 0.8357, 0.8231, 0.8115,
            0.7984, 0.7854, 0.7704, 0.7556, 0.7391, 0.7210, 0.7038, 0.6840, 0.6633, 0.6408,
            0.6174, 0.5939, 0.5678, 0.5410, 0.5137, 0.4836, 0.4524, 0.4193, 0.3850, 0.3482,
            0.3132, 0.2733, 0.2315, 0.1891, 0.1435, 0.0980, 0.0493, 0.0000, -0.0510, -0.1052,
            -0.1593, -0.2177, -0.2759, -0.3374, -0.4005, -0.4599, -0.5266, -0.5935, -0.6626, -0.7328,
            -0.8051, -0.8757, -0.9498, -1.0271, -1.1019, -1.1816, -1.2642, -1.3459, -1.4295, -1.5077,
            -1.5958, -1.6818, -1.7647, -1.8548, -1.9387, -2.0295, -2.1152, -2.2154, -2.3011, -2.3904,
            -2.4820, -2.5786, -2.6730, -2.7652, -2.8616, -2.9546, -3.0526, -3.1445, -3.2445, -3.3416,
            -3.4357, -3.5325, -3.6324, -3.7313, -3.8225, -3.9209, -4.0248, -4.1278, -4.2261, -4.3193,
            -4.4220, -4.5262, -4.6214, -4.7242, -4.8234, -4.9245, -5.0298, -5.1250, -5.2232, -5.3267,
            -5.4332, -5.5342, -5.6431, -5.7270, -5.8401, -5.9350, -6.0407, -6.1418, -6.2363, -6.3384,
            -6.4536, -6.5429, -6.6582, -6.7433, -6.8438, -6.9478, -7.0789, -7.1894, -7.2714, -7.3815,
            -7.4810, -7.5575, -7.6852, -7.8071, -7.8580, -7.9724, -8.1000, -8.2207, -8.2867, -8.4017,
            -8.5287, -8.6347, -8.7082, -8.8319, -8.9448, -9.0355, -9.1885, -9.2095, -9.2863, -9.4186,
            -9.5064, -9.6386, -9.7207, -9.8286, -9.9453, -10.0701, -10.1735, -10.3001, -10.2858, -10.5427,
            -10.5982, -10.7361, -10.7042, -10.9212, -11.0097, -11.0469, -11.1155, -11.2812, -11.3472, -11.4988,
            -11.5327, -11.6692, -11.9376, -11.8606, -12.1372, -13.2539
        ]

        this.mettab = [new Int32Array(256), new Int32Array(256)]

        for (let i = 0; i < 256; i++) {
            // C: mettab[0][i] = round(10 * (metric_tables[2][i] - bias));
            this.mettab[0][i] = Math.round(10 * (metric_table_6dB[i] - bias))

            // C: mettab[1][i] = round(10 * (metric_tables[2][255 - i] - bias));
            this.mettab[1][i] = Math.round(10 * (metric_table_6dB[255 - i] - bias))
        }
    }


    async decode(idat, qdat) {
        this.log.info("--- Starting New Decode Pass ---")

        // 1. Pre-calculate the number of time slices (FFT blocks)
        const nffts = Math.floor((idat.length - 512) / 128) + 1

        // 2. Initial Peak Finding
        // Note: _findCandidates now also populates this.ps[bin][time]
        const rawCandidates = this._findCandidates(idat, qdat)

        // Log the top 5 raw frequency peaks found in the average spectrum
        this.log.table(rawCandidates)

        // 3. Coarse Estimation (The wsprd "Sync Search")
        // We take the top 15 rough peaks and find their optimal shift and Drift
        // const topRaw = rawCandidates.slice(0, 15)
        const alignedCandidates = this._coarseEstimate(rawCandidates, nffts)
        this.log.table(alignedCandidates)

        const refinedCandidates = this._refineCandidates(alignedCandidates, idat, qdat)
        this.log.table(refinedCandidates)

        const results = this._processCandidates(refinedCandidates, idat, qdat)

        // 5. De-duplication
        // Sort by metric (highest quality first)
        results.sort((a, b) => b.metric - a.metric)

        const uniqueResults = []
        for (const res of results) {
            // Check if we already have this callsign within a 4Hz window
            const isDuplicate = uniqueResults.some(u =>
                u.callsign === res.callsign && Math.abs(u.freq - res.freq) < 4
            )
            if (!isDuplicate) uniqueResults.push(res)
        }

        this.log.info(`--- Decode Pass Finished: ${uniqueResults.length} unique signals found ---`)
        return uniqueResults
    }

    _findCandidates(idat, qdat) {
        // Correct destructuring including smspec
        const { psavg, smspec, re, im, window, fft, ps } = this

        psavg.fill(0)
        smspec.fill(0)
        for (let bin = 0; bin < 512; bin++) ps[bin].fill(0)

        const nffts = Math.floor((idat.length - 512) / 128) + 1

        // Pass 1: FFT and Power Spectrum Generation
        for (let i = 0; i < nffts; i++) {
            const offset = i * 128
            for (let j = 0; j < 512; j++) {
                const k = offset + j
                re[j] = idat[k] * window[j]
                im[j] = qdat[k] * window[j]
            }

            fft.run(re, im)

            for (let j = 0; j < 512; j++) {
                const k = (j + 256) & 511
                const power = re[k] * re[k] + im[k] * im[k]

                psavg[j] += power   // Summary for peak finding
                ps[j][i] = power    // Time-domain grid for coarse estimate
            }
        }

        // Pass 2: Smoothing for peak detection (106 to 406 is the ~200Hz WSPR window)
        const start = 106, end = 406

        for (let i = start; i <= end; i++) {
            let sum = 0
            for (let j = -3; j <= 3; j++) sum += psavg[i + j]
            smspec[i] = sum // Error was here: smspec is now defined in 'this'
        }

        // Noise estimation and candidate extraction

        const min_snr = Math.pow(10.0, -8.0 / 10.0)

        const tmpsort = Array.from(smspec.slice(start, end + 1)).sort((a, b) => a - b)
        const noiseLevel = tmpsort[Math.floor(tmpsort.length * 0.3)] || 1.0
        const snr_scaling_factor = 35.3
        const candidateList = []

        for (let j = start + 1; j < end; j++) {
            smspec[j] = smspec[j] / noiseLevel - 1.0
            if (smspec[j] < min_snr) smspec[j] = 0.1 * min_snr
        }

        for (let j = start + 1; j < end; j++) {
            if (smspec[j] > smspec[j - 1] && smspec[j] > smspec[j + 1]) {

                candidateList.push({
                    freq: (j - 256) * 0.732421875,
                    score: smspec[j],
                    snr: 10 * Math.log10(smspec[j]) - snr_scaling_factor
                })

            }
        }
        return candidateList.sort((a, b) => b.score - a.score)
    }


    _coarseEstimate(candidates, nffts) {
        const df = 375.0 / 512.0
        const maxdrift = 10 // Standard wsprd maxdrift
        const aligned = []

        for (let j = 0; j < candidates.length; j++) {
            let smax = -1e30
            let best = { freq: 0, drift: 0, shift: 0, sync: 0 }

            // C logic: if0=candidates[j].freq/df+256;
            const if0 = Math.floor(candidates[j].freq / df) + 256

            for (let ifr = if0 - 2; ifr <= if0 + 2; ifr++) {
                for (let k0 = -10; k0 < 22; k0++) {
                    for (let idrift = -maxdrift; idrift <= maxdrift; idrift++) {
                        let ss = 0.0
                        let pow = 0.0

                        for (let k = 0; k < 162; k++) {
                            // Note the use of Math.floor or Math.round here to match C's float-to-int cast
                            const ifd = Math.round(ifr + ((k - 81.0) / 81.0) * (idrift / (2.0 * df)))

                            const kindex = k0 + 2 * k

                            // Ensure indices are within bounds of your ps[512][nffts] array
                            if (kindex >= 0 && kindex < nffts && ifd >= 3 && ifd <= 508) {
                                // C version uses square root to work with amplitude instead of power
                                const p0 = Math.sqrt(this.ps[ifd - 3][kindex])
                                const p1 = Math.sqrt(this.ps[ifd - 1][kindex])
                                const p2 = Math.sqrt(this.ps[ifd + 1][kindex])
                                const p3 = Math.sqrt(this.ps[ifd + 3][kindex])

                                // Core WSPR Sync algorithm
                                ss += (2 * this.PR3[k] - 1) * ((p1 + p3) - (p0 + p2))
                                pow += (p0 + p1 + p2 + p3)
                            }
                        }

                        const sync1 = ss / (pow || 1.0)
                        if (sync1 > smax) {
                            smax = sync1
                            best.sync = sync1
                            best.shift = 128 * (k0 + 1)
                            best.drift = idrift
                            best.freq = (ifr - 256) * df
                        }
                    }
                }
            }

            // Update the candidate with the best coarse parameters found
            candidates[j].shift = best.shift
            candidates[j].drift = best.drift
            candidates[j].freq = best.freq
            candidates[j].sync = best.sync

            // C filter usually happens after this, but we can keep candidates with decent sync
            //   if (best.sync > 0.3) {
            aligned.push({ ...candidates[j] })
            //   }
        }
        return aligned.sort((a, b) => b.sync - a.sync)
    }

    _getTonePowers(id, qd, freq, offset) {
        const dt = 1.0 / 375.0 // Sample period for .c2 files
        const p = new Float32Array(4)
        const lutMask = this.LUT_SIZE - 1

        // We calculate 4 tones separated by 1.4648 Hz (375/256)
        const df = 375.0 / 256.0

        for (let t = 0; t < 4; t++) {
            const f_inst = freq + (t - 1.5) * df
            const phaseStep = f_inst * dt * this.LUT_SIZE
            let re = 0, im = 0, currentPhase = 0

            for (let j = 0; j < 256; j++) {
                const k = offset + j
                if (k >= id.length) break

                const idx = (currentPhase | 0) & lutMask
                const c = this.cosTable[idx]
                const s = this.sinTable[idx]

                re += id[k] * c + qd[k] * s
                im += qd[k] * c - id[k] * s
                currentPhase += phaseStep
            }
            p[t] = re * re + im * im
        }
        return p
    }


    syncAndDemodulate(id, qd, np, f1, ifmin, ifmax, fstep, shift1, lagmin, lagmax, lagstep, drift1, symfac, mode) {
        const dt = 1.0 / 375.0
        const df = 375.0 / 256.0
        const twopidt = 2.0 * Math.PI * dt
        const df15 = df * 1.5, df05 = df * 0.5

        // Buffers for 4 tones across 162 symbols
        const iTones = [new Float32Array(162), new Float32Array(162), new Float32Array(162), new Float32Array(162)]
        const qTones = [new Float32Array(162), new Float32Array(162), new Float32Array(162), new Float32Array(162)]
        const fsymb = new Float32Array(162)
        const symbols = new Uint8Array(162)

        // Oscillator arrays (256 samples per symbol)
        const c = [new Float32Array(256), new Float32Array(256), new Float32Array(256), new Float32Array(256)]
        const s = [new Float32Array(256), new Float32Array(256), new Float32Array(256), new Float32Array(256)]

        let syncmax = -1e30
        let bestShift = shift1
        let bestFreq = f1
        let fplast = -10000.0

        // Mode handling for search ranges
        let localIfMin = (mode === 0 || mode === 2) ? 0 : ifmin
        let localIfMax = (mode === 0 || mode === 2) ? 0 : ifmax
        let localFStep = (mode === 0 || mode === 2) ? 0.0 : fstep
        let localLagMin = (mode === 1 || mode === 2) ? shift1 : lagmin
        let localLagMax = (mode === 1 || mode === 2) ? shift1 : lagmax

        const effectiveLagStep = Math.max(1, lagstep)

        for (let ifreq = localIfMin; ifreq <= localIfMax; ifreq++) {
            const f0 = f1 + ifreq * localFStep

            for (let lag = localLagMin; lag <= localLagMax; lag += effectiveLagStep) {
                let ss = 0.0
                let totp = 0.0

                for (let i = 0; i < 162; i++) {
                    // Calculate frequency for this symbol including drift
                    const fp = f0 + (drift1 / 2.0) * (i - 81.0) / 81.0

                    // Re-calculate oscillator if frequency changed (mimics static fplast)
                    if (i === 0 || fp !== fplast) {
                        const dphi = [
                            twopidt * (fp - df15),
                            twopidt * (fp - df05),
                            twopidt * (fp + df05),
                            twopidt * (fp + df15)
                        ]

                        for (let t = 0; t < 4; t++) {
                            c[t][0] = 1.0; s[t][0] = 0.0
                            const cd = Math.cos(dphi[t])
                            const sd = Math.sin(dphi[t])
                            for (let j = 1; j < 256; j++) {
                                c[t][j] = c[t][j - 1] * cd - s[t][j - 1] * sd
                                s[t][j] = c[t][j - 1] * sd + s[t][j - 1] * cd
                            }
                        }
                        fplast = fp
                    }

                    // Initialize tone integrators for this symbol
                    for (let t = 0; t < 4; t++) { iTones[t][i] = 0; qTones[t][i] = 0 }

                    // Integrate 256 samples (The "Mixer")
                    for (let j = 0; j < 256; j++) {
                        const k = lag + i * 256 + j
                        if (k >= 0 && k < np) {
                            const id_k = id[k]
                            const qd_k = qd[k]
                            for (let t = 0; t < 4; t++) {
                                iTones[t][i] += id_k * c[t][j] + qd_k * s[t][j]
                                qTones[t][i] += qd_k * c[t][j] - id_k * s[t][j]
                            }
                        }
                    }

                    const p0 = Math.sqrt(iTones[0][i] ** 2 + qTones[0][i] ** 2)
                    const p1 = Math.sqrt(iTones[1][i] ** 2 + qTones[1][i] ** 2)
                    const p2 = Math.sqrt(iTones[2][i] ** 2 + qTones[2][i] ** 2)
                    const p3 = Math.sqrt(iTones[3][i] ** 2 + qTones[3][i] ** 2)

                    totp += (p0 + p1 + p2 + p3)
                    const cmet = (p1 + p3) - (p0 + p2)
                    ss = (this.PR3[i] === 1) ? ss + cmet : ss - cmet

                    if (mode === 2) {
                        fsymb[i] = (this.PR3[i] === 1) ? (p3 - p1) : (p2 - p0)
                    }
                }

                ss /= (totp || 1.0)
                if (ss > syncmax) {
                    syncmax = ss
                    bestShift = lag
                    bestFreq = f0
                }
            }
        }

        // Prepare Return Object (mimicking C pointers)
        const result = { sync: syncmax, shift: bestShift, freq: bestFreq, symbols: null }

        if (mode === 2) {
            let fsum = 0, f2sum = 0
            for (let i = 0; i < 162; i++) {
                fsum += fsymb[i] / 162.0
                f2sum += (fsymb[i] * fsymb[i]) / 162.0
            }
            const fac = Math.sqrt(Math.max(0, f2sum - fsum * fsum))
            for (let i = 0; i < 162; i++) {
                let val = symfac * fsymb[i] / (fac || 1.0)
                val = Math.max(-128, Math.min(127, val))
                symbols[i] = Math.round(val + 128)
            }
            result.symbols = symbols
        }

        return result
    }

    _refineCandidates(candidates, idat, qdat) {
        const npoints = idat.length
        const symfac = 81.0
        const minsync1 = 0.12 // Reduced for debugging OM5ZU
        const refined = []

        for (let cand of candidates) {
            // --- 1. Refine Lag (Mode 0) ---
            let res = this.syncAndDemodulate(
                idat, qdat, npoints, cand.freq, 0, 0, 0,
                cand.shift, cand.shift - 128, cand.shift + 128, 64,
                cand.drift, symfac, 0
            )

            // --- 2. Refine Frequency (Mode 1) ---
            res = this.syncAndDemodulate(
                idat, qdat, npoints, res.freq, -2, 2, 0.25,
                res.shift, 0, 0, 0,
                cand.drift, symfac, 1
            )

            // --- 3. Refine Drift (Manual Step check) ---
            let d_best = cand.drift
            let s_best = res.sync

            for (let d_off of [0.5, -0.5]) {
                let d_test = cand.drift + d_off
                let d_res = this.syncAndDemodulate(
                    idat, qdat, npoints, res.freq, 0, 0, 0,
                    res.shift, 0, 0, 0,
                    d_test, symfac, 1
                )
                if (d_res.sync > s_best) {
                    s_best = d_res.sync
                    d_best = d_test
                    res.freq = d_res.freq
                    res.shift = d_res.shift
                }
            }

            // --- 4. Fine Tuning (Fine Lag & Fine Freq) ---
            if (s_best > minsync1) {
                // Fine Lag
                res = this.syncAndDemodulate(
                    idat, qdat, npoints, res.freq, 0, 0, 0,
                    res.shift, res.shift - 32, res.shift + 32, 16,
                    d_best, symfac, 0
                )
                // Fine Freq
                res = this.syncAndDemodulate(
                    idat, qdat, npoints, res.freq, -2, 2, 0.05,
                    res.shift, 0, 0, 0,
                    d_best, symfac, 1
                )

                refined.push({
                    freq: res.freq,
                    shift: res.shift,
                    drift: d_best,
                    sync: res.sync,
                    snr: cand.snr
                })
            }
        }
        return refined
    }


    _processCandidates(refinedCandidates, idat, qdat) {

        const symfac = 50.0 //81.0
        const nblocksize = 1 // Max block size from wsprd
        //  const minrms = 10.0  // Threshold for trying Fano
        const minrms = 52.0 * (symfac / 64.0)
        const symbols = new Uint8Array(162)
        const iifac = 8 // Step size from wsprd.c
        const maxJitterSteps = Math.floor(128 / iifac) // Results in 16


        const decodes = []
        for (let cand of refinedCandidates) {
            let notDecoded = true
            let ib = 1

            //            if (Math.floor(cand.freq) === 38) {
            //                debugger
            //            }

            // Try different block sizes (1, 2, 3...)
            while (ib <= nblocksize && notDecoded) {
                let blocksize = ib
                let bitmetric = 0
                if (ib < 4) { blocksize = ib; bitmetric = 0 }
                if (ib === 4) { blocksize = 1; bitmetric = 1 }

                // Jitter Loop: shift the timing window slightly to find the "sweet spot"
                for (let idt = 0; idt <= maxJitterSteps; idt++) {
                    let ii = Math.floor((idt + 1) / 2)
                    if (idt % 2 === 1) ii = -ii

                    // Multiply by 8 to jump in large steps
                    const jitteredShift = cand.shift + (ii * iifac)

                    this.noncoherentSequenceDetection(
                        idat, qdat, idat.length, symbols,
                        cand.freq, jitteredShift, cand.drift,
                        symfac, blocksize, bitmetric
                    )

                    // 2. RMS check (ensures there's actually a signal here)
                    let sq = 0
                    for (let i = 0; i < 162; i++) {
                        let y = symbols[i] - 128
                        sq += y * y
                    }
                    let rms = Math.sqrt(sq / 162.0)

                    if (rms > minrms) {
                        // 3. Deinterleave symbols
                        const deinterleaved = this._deinterleave(symbols)

                        // 4. Call Fano Decoder

                        const result = this.fano.decode(
                            deinterleaved,
                            81,
                            this.mettab,
                            60, //10,
                            10000 // 400
                        )


                        if (result.success) {     // && result.metric >= -150                        
                            notDecoded = false
                            /************************************* */

                            const dataBytes = new Uint8Array(11)
                            for (let i = 0; i < 81; i++) {
                                if (result.data[i] === 1) {
                                    const byteIdx = i >> 3 // Equivalent to Math.floor(i/8)
                                    const bitIdx = 7 - (i % 8)
                                    dataBytes[byteIdx] |= (1 << bitIdx)
                                }
                            }


                            const decoded = this._unpackFromBytes(dataBytes)
                            if (decoded) {
                                decoded.freq = cand.freq
                                decoded.snr = cand.snr
                                decoded.shift = cand.shift
                                decodes.push(decoded)

                                //   console.log("FREQ", cand.freq)
                                console.log(decoded)
                            }
                            //****************************************** */
                            break // Exit jitter loop
                        }
                    }
                    if (this.quickmode) break
                }
                if (!notDecoded) break // Exit blocksize loop
                ib++
            }
        }
        return decodes
    }


    noncoherentSequenceDetection(id, qd, np, symbols, f1, shift1, drift1, symfac, nblocksize, bitmetric) {
        // Mimic C static variables using instance properties
        if (this._fplast === undefined) this._fplast = -10000.0

        // Constants 
        const dt = Math.fround(1.0 / 375.0)
        const df = Math.fround(375.0 / 256.0)
        const pi = 3.14159265358979323846
        const twopidt = Math.fround(2.0 * pi * dt)
        const df15 = Math.fround(df * 1.5)
        const df05 = Math.fround(df * 0.5)

        var i, j, k, lag, itone, ib, b, nblock, nseq, imask
        var xi = new Float32Array(512)
        var xq = new Float32Array(512)

        // 2D arrays: [row][column]
        var is = Array.from({ length: 4 }, () => new Float32Array(162))
        var qs = Array.from({ length: 4 }, () => new Float32Array(162))
        var cf = Array.from({ length: 4 }, () => new Float32Array(162))
        var sf = Array.from({ length: 4 }, () => new Float32Array(162))

        var cm, sm, cmp, smp
        var p = new Float32Array(512)
        var fac, xm1, xm0

        var c0 = new Float32Array(257), s0 = new Float32Array(257)
        var c1 = new Float32Array(257), s1 = new Float32Array(257)
        var c2 = new Float32Array(257), s2 = new Float32Array(257)
        var c3 = new Float32Array(257), s3 = new Float32Array(257)

        var dphi0, cdphi0, sdphi0, dphi1, cdphi1, sdphi1, dphi2, cdphi2, sdphi2, dphi3, cdphi3, sdphi3
        var f0, fp, fsum = 0.0, f2sum = 0.0, fsymb = new Float32Array(162)

        f0 = f1
        lag = shift1
        nblock = nblocksize
        nseq = 1 << nblock
        var bitbybit = bitmetric

        for (i = 0; i < 162; i++) {
            fp = Math.fround(f0 + (drift1 / 2.0) * (i - 81.0) / 81.0)

            if (i === 0 || fp !== this._fplast) {
                dphi0 = Math.fround(twopidt * (fp - df15))
                cdphi0 = Math.fround(Math.cos(dphi0))
                sdphi0 = Math.fround(Math.sin(dphi0))

                dphi1 = Math.fround(twopidt * (fp - df05))
                cdphi1 = Math.fround(Math.cos(dphi1))
                sdphi1 = Math.fround(Math.sin(dphi1))

                dphi2 = Math.fround(twopidt * (fp + df05))
                cdphi2 = Math.fround(Math.cos(dphi2))
                sdphi2 = Math.fround(Math.sin(dphi2))

                dphi3 = Math.fround(twopidt * (fp + df15))
                cdphi3 = Math.fround(Math.cos(dphi3))
                sdphi3 = Math.fround(Math.sin(dphi3))

                c0[0] = 1; s0[0] = 0
                c1[0] = 1; s1[0] = 0
                c2[0] = 1; s2[0] = 0
                c3[0] = 1; s3[0] = 0

                for (j = 1; j < 257; j++) {
                    c0[j] = Math.fround(c0[j - 1] * cdphi0 - s0[j - 1] * sdphi0)
                    s0[j] = Math.fround(c0[j - 1] * sdphi0 + s0[j - 1] * cdphi0)
                    c1[j] = Math.fround(c1[j - 1] * cdphi1 - s1[j - 1] * sdphi1)
                    s1[j] = Math.fround(c1[j - 1] * sdphi1 + s1[j - 1] * cdphi1)
                    c2[j] = Math.fround(c2[j - 1] * cdphi2 - s2[j - 1] * sdphi2)
                    s2[j] = Math.fround(c2[j - 1] * sdphi2 + s2[j - 1] * cdphi2)
                    c3[j] = Math.fround(c3[j - 1] * cdphi3 - s3[j - 1] * sdphi3)
                    s3[j] = Math.fround(c3[j - 1] * sdphi3 + s3[j - 1] * cdphi3)
                }
                this._fplast = fp
            }

            cf[0][i] = c0[256]; sf[0][i] = s0[256]
            cf[1][i] = c1[256]; sf[1][i] = s1[256]
            cf[2][i] = c2[256]; sf[2][i] = s2[256]
            cf[3][i] = c3[256]; sf[3][i] = s3[256]

            is[0][i] = 0.0; qs[0][i] = 0.0
            is[1][i] = 0.0; qs[1][i] = 0.0
            is[2][i] = 0.0; qs[2][i] = 0.0
            is[3][i] = 0.0; qs[3][i] = 0.0

            for (j = 0; j < 256; j++) {
                k = lag + i * 256 + j
                // Note: C uses (k > 0). If your id/qd start at index 0, check if this should be >= 0
                if ((k > 0) && (k < np)) {
                    is[0][i] = Math.fround(is[0][i] + id[k] * c0[j] + qd[k] * s0[j])
                    qs[0][i] = Math.fround(qs[0][i] - id[k] * s0[j] + qd[k] * c0[j])
                    is[1][i] = Math.fround(is[1][i] + id[k] * c1[j] + qd[k] * s1[j])
                    qs[1][i] = Math.fround(qs[1][i] - id[k] * s1[j] + qd[k] * c1[j])
                    is[2][i] = Math.fround(is[2][i] + id[k] * c2[j] + qd[k] * s2[j])
                    qs[2][i] = Math.fround(qs[2][i] - id[k] * s2[j] + qd[k] * c2[j])
                    is[3][i] = Math.fround(is[3][i] + id[k] * c3[j] + qd[k] * s3[j])
                    qs[3][i] = Math.fround(qs[3][i] - id[k] * s3[j] + qd[k] * c3[j])
                }
            }
        }

        for (i = 0; i < 162; i = i + nblock) {
            for (j = 0; j < nseq; j++) {
                xi[j] = 0.0; xq[j] = 0.0
                cm = 1; sm = 0
                for (ib = 0; ib < nblock; ib++) {
                    b = (j & (1 << (nblock - 1 - ib))) >> (nblock - 1 - ib)
                    itone = this.PR3[i + ib] + 2 * b

                    const symbolIdx = i + ib
                    if (symbolIdx < 162) {
                        xi[j] = Math.fround(xi[j] + is[itone][i + ib] * cm + qs[itone][i + ib] * sm)
                        xq[j] = Math.fround(xq[j] + qs[itone][i + ib] * cm - is[itone][i + ib] * sm)

                        cmp = Math.fround(cf[itone][i + ib] * cm - sf[itone][i + ib] * sm)
                        smp = Math.fround(sf[itone][i + ib] * cm + cf[itone][i + ib] * sm)
                        cm = cmp; sm = smp
                    }
                }
                p[j] = Math.fround(Math.sqrt(xi[j] * xi[j] + xq[j] * xq[j]))
            }
            for (ib = 0; ib < nblock; ib++) {
                imask = 1 << (nblock - 1 - ib)
                xm1 = 0.0; xm0 = 0.0
                for (j = 0; j < nseq; j++) {
                    if ((j & imask) !== 0) {
                        if (p[j] > xm1) xm1 = p[j]
                    }
                    if ((j & imask) === 0) {
                        if (p[j] > xm0) xm0 = p[j]
                    }
                }
                fsymb[i + ib] = Math.fround(xm1 - xm0)
                if (bitbybit === 1) {
                    fsymb[i + ib] = Math.fround(fsymb[i + ib] / (xm1 > xm0 ? xm1 : xm0))
                }
            }
        }

        for (i = 0; i < 162; i++) {
            fsum = Math.fround(fsum + fsymb[i] / 162.0)
            f2sum = Math.fround(f2sum + fsymb[i] * fsymb[i] / 162.0)
        }
        fac = Math.fround(Math.sqrt(Math.fround(f2sum - fsum * fsum)))

        for (i = 0; i < 162; i++) {
            fsymb[i] = Math.fround(symfac * fsymb[i] / fac)
            if (fsymb[i] > 127) fsymb[i] = 127.0
            if (fsymb[i] < -128) fsymb[i] = -128.0
            symbols[i] = Math.round(fsymb[i] + 128)
        }
    }

    _syncSearch(id, qd, f0, shiftmin, shiftmax) {
        let best = { sync: -1, shift: 0, freq: f0 }
        for (let f = f0 - 1.5; f <= f0 + 1.5; f += 0.5) {
            const f_rel = f - 1500
            for (let shift = shiftmin; shift <= shiftmax; shift += 4) { // Step by 4 for speed
                let ss = 0, totp = 0
                for (let i = 0; i < 162; i++) {
                    const p = this._getTonePowers(id, qd, f_rel, shift + (i << 8))
                    const pSum = p[0] + p[1] + p[2] + p[3]
                    if (pSum === 0) continue
                    totp += pSum
                    const metric = (p[1] + p[3]) - (p[0] + p[2])
                    ss += (this.PR3[i] === 1) ? metric : -metric
                }
                const score = ss / (totp || 1)
                if (score > best.sync) {
                    best = { sync: score, shift: shift, freq: f }
                }
            }
        }
        return best
    }

    _deinterleave(symbols) {
        const out = new Uint8Array(162)
        for (let p = 0; p < 162; p++) {
            out[p] = symbols[this.deinterleaveMap[p]]
        }
        return out
    }

    _unpackFromBytes(data) {
        let n1 = (BigInt(data[0]) << 20n) | (BigInt(data[1]) << 12n) |
            (BigInt(data[2]) << 4n) | (BigInt(data[3] >> 4) & 0x0Fn)

        let n2 = (BigInt(data[3] & 0x0F) << 18n) | (BigInt(data[4]) << 10n) |
            (BigInt(data[5]) << 2n) | (BigInt(data[6] >> 6) & 0x03n)

        let n2_int = Number(n2)
        let ntype = (n2_int & 127) - 64

        if (ntype >= 0) {
            let nu = ntype % 10
            let isStandardPower = (nu === 0 || nu === 3 || nu === 7)

            if (isStandardPower) {
                // --- TYPE 1: STANDARD (Existing Logic) ---
                let call = this._unpackCall(n1)
                let grid = this._unpackGrid(n2_int)
                this.hashtab.set(this.wspr_hash(call), call)
                return { type: 1, callsign: call, grid: grid, power: ntype }

            } else {
                // --- TYPE 2: PREFIX / SUFFIX ---
                let call = this._unpackCall(n1)

                // Calculate nadd and n3 exactly like the C code
                let nadd = nu
                if (nu > 3) nadd = nu - 3
                if (nu > 7) nadd = nu - 7

                let n3 = Math.floor(n2_int / 128) + 32768 * (nadd - 1)
                let compoundCall = this._unpackPfx(n3, call)
                let power = ntype - nadd

                const nu2 = power % 10

                // Type 2 doesn't carry a grid, so we return a placeholder
                if( nu2 == 0 || nu2 == 3 || nu2 == 7 || nu2 == 10 )
                    return { type: 2, callsign: compoundCall, grid: "----", power: power }
                else 
                    return null
            }

        } else {
            // --- TYPE 3: HASHED CALL + 6-DIGIT GRID (Existing Logic) ---
            let power = -(ntype + 1)
            let ihash = Math.floor((n2_int - ntype - 64) / 128)
            let callsign = this.hashtab.get(ihash) || `<${ihash}>`
            if (callsign !== `<${ihash}>` && !callsign.startsWith('<')) callsign = `<${callsign}>`

            let gridRaw = this._unpackCall(n1)
            let grid6 = gridRaw.slice(-1) + gridRaw.slice(0, -1)

            const nu = power % 10
            if ((nu !== 0 && nu !== 3 && nu !== 7 && nu !== 10) ||
                !/[a-zA-Z]/.test(grid6[0]) ||
                !/[a-zA-Z]/.test(grid6[1]) ||
                !/[0-9]/.test(grid6[2]) ||
                !/[0-9]/.test(grid6[3])) {
                return null
            }

            return { type: 3, callsign, grid: grid6, power }
        }
    }

    _unpackGrid(ngrid_raw) {
        const c = WSPR.CHAR_MAP

        // Shift right 7 to remove power/ntype bits
        let ngrid = ngrid_raw >> 7

        if (ngrid >= 32400) return "XXXX"

        // Maidenhead calculation 
        let dlat = (ngrid % 180) - 90
        let dlong = Math.floor(ngrid / 180) * 2 - 180 + 2

        if (dlong < -180) dlong += 360
        if (dlong > 180) dlong -= 360

        let nlong = Math.floor(60.0 * (180.0 - dlong) / 5.0)
        let i1_lon = Math.floor(nlong / 240)
        let i2_lon = Math.floor((nlong - 240 * i1_lon) / 24)

        let nlat = Math.floor(60.0 * (dlat + 90) / 2.5)
        let i1_lat = Math.floor(nlat / 240)
        let i2_lat = Math.floor((nlat - 240 * i1_lat) / 24)

        return `${c[10 + i1_lon]}${c[10 + i1_lat]}${c[i2_lon]}${c[i2_lat]}`
    }

    _unpackCall(n) {
        let t = n
        const res = new Array(6)

        // Suffix characters (3, 4, 5) use 27-state mapping
        res[5] = WSPR.CHAR_MAP[Number(t % 27n) + 10]; t /= 27n
        res[4] = WSPR.CHAR_MAP[Number(t % 27n) + 10]; t /= 27n
        res[3] = WSPR.CHAR_MAP[Number(t % 27n) + 10]; t /= 27n

        // The digit (2) is always 0-9
        res[2] = WSPR.CHAR_MAP[Number(t % 10n)]; t /= 10n

        // The prefix characters (0, 1) use 36-state mapping (0-9, A-Z, and 36 is Space)
        // We need to check if the result is 0 and map it to a space if necessary
        const getChar = (idx) => {
            const i = Number(idx)
            // In WSPR packing, index 0 for the first two positions 
            // effectively acts as a blank/padding.
            return (i === 0) ? " " : WSPR.CHAR_MAP[i]
        }

        res[1] = getChar(t % 36n); t /= 36n
        res[0] = getChar(t % 36n)

        return res.join("").trim()
    }

    _unpackPfx(nprefix, baseCall) {
        let n = nprefix
        let pfx = ""

        if (n < 60000) {
            // --- PREFIX Case (e.g., "P5/G4HUP") ---
            let tmp = ["", "", ""]
            for (let i = 2; i >= 0; i--) {
                let nc = n % 37
                if (nc >= 0 && nc <= 9) tmp[i] = String.fromCharCode(nc + 48)
                else if (nc >= 10 && nc <= 35) tmp[i] = String.fromCharCode(nc + 55)
                else tmp[i] = ' '
                n = Math.floor(n / 37)
            }
            // Trim leading spaces and join
            let prefixStr = tmp.join("").trim()
            return `${prefixStr}/${baseCall}`

        } else {
            // --- SUFFIX Case (e.g., "G4HUP/P" or "G4HUP/12") ---
            let nc = n - 60000
            let suffixStr = ""
            if (nc >= 0 && nc <= 9) {
                suffixStr = String.fromCharCode(nc + 48)
            } else if (nc >= 10 && nc <= 35) {
                suffixStr = String.fromCharCode(nc + 55)
            } else if (nc >= 36 && nc <= 125) {
                // 2-digit numeric suffix (e.g., /12)
                let d1 = Math.floor((nc - 26) / 10)
                let d2 = (nc - 26) % 10
                suffixStr = `${d1}${d2}`
            } else {
                return baseCall // Error fallback
            }
            return `${baseCall}/${suffixStr}`
        }
    }

}