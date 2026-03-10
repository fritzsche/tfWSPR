import { WSPR } from './WSPR.js'

export class WSPREncoder extends WSPR {
    constructor() {
        super()
        this.PR3 = WSPR.PR3
        this.POLY_A = WSPR.POLY1
        this.POLY_B = WSPR.POLY2
    }

    _getCharCode(c, type) {
        const code = c.charCodeAt(0)
        if (code >= 48 && code <= 57) return code - 48
        if (code === 32) return 36
        if (type === 'call') return (code >= 65 && code <= 90) ? code - 55 : 0
        return (code >= 65 && code <= 82) ? code - 65 : 0
    }

    packCall(callsign) {
        let call6 = callsign.toUpperCase().padEnd(6, ' ')
        // WSPR specific: if 3rd char isn't a digit but 2nd is, shift right
        if (!/\d/.test(call6[2]) && /\d/.test(call6[1])) {
            call6 = " " + call6.substring(0, 5)
        }
        const c = Array.from(call6).map(char => WSPR.CHAR_MAP.indexOf(char))
        let n = BigInt(c[0])
        n = n * 36n + BigInt(c[1])
        n = n * 10n + BigInt(c[2])
        n = n * 27n + BigInt(c[3] - 10)
        n = n * 27n + BigInt(c[4] - 10)
        n = n * 27n + BigInt(c[5] - 10)
        return n
    }

    packGridPower(grid4, power) {
        const codes = Array.from(grid4.toUpperCase()).map(c => this._getCharCode(c, 'grid'))
        let m = (179 - 10 * codes[0] - codes[2]) * 180 + 10 * codes[1] + codes[3]
        return BigInt(m * 128 + power + 64)
    }

    generateSymbols(callsign, grid4, power) {
        const n = this.packCall(callsign)
        const m = this.packGridPower(grid4, power)
        const data = new Uint8Array(11)
        data[0] = Number((n >> 20n) & 0xFFn)
        data[1] = Number((n >> 12n) & 0xFFn)
        data[2] = Number((n >> 4n) & 0xFFn)
        data[3] = Number(((n & 0x0Fn) << 4n) | ((m >> 18n) & 0x0Fn))
        data[4] = Number((m >> 10n) & 0xFFn)
        data[5] = Number((m >> 2n) & 0xFFn)
        data[6] = Number((m & 0x03n) << 6n)

        let state = 0n, p = 0
        const fec = new Uint8Array(162)
        for (let i = 0; i < 81; i++) {
            const bit = (i < 50) ? BigInt((data[Math.floor(i / 8)] >> (7 - (i % 8))) & 1) : 0n
            state = ((state << 1n) | bit) & 0xFFFFFFFFn
            fec[p++] = this._parity(state & this.POLY_A)
            fec[p++] = this._parity(state & this.POLY_B)
        }

        const interleaved = new Uint8Array(162)
        p = 0
        for (let i = 0; p < 162; i++) {
            let res = 0
            for (let b = 0; b < 8; b++) res = (res << 1) | ((i >> b) & 1)
            if (res < 162) interleaved[res] = fec[p++]
        }

        const symbols = new Uint8Array(162)
        for (let i = 0; i < 162; i++) symbols[i] = (2 * interleaved[i]) + this.PR3[i]
        return symbols
    }

    encodeMessage(messageStr) {
        const parts = messageStr.trim().split(/\s+/)
        let n = 0n, m = 0n
        const nu_table = [0, -1, 1, 0, -1, 2, 1, 0, -1, 1]

        if (messageStr.includes('<')) {
            // TYPE 3: HASHED <CALL> GRID6 PWR
            const call = messageStr.match(/<([^>]+)>/)[1]
            const grid = parts[1]
            let pwr = parseInt(parts[2])
            pwr += nu_table[pwr % 10]
            const ntype = -(pwr + 1)
            m = BigInt(128 * this.wspr_hash(call) + ntype + 64)
            const grid6_rot = grid.substring(1, 6) + grid[0]
            n = this.packCall(grid6_rot)
        } else if (messageStr.includes('/')) {
            // TYPE 2: COMPOUND CALL/P PWR
            const callsign = parts[0]
            let pwr = parseInt(parts[1])
            pwr += nu_table[pwr % 10]

            const { n1, ng, nadd } = this._packPrefixInternal(callsign)
            const ntype = pwr + 1 + nadd
            m = BigInt(128 * ng + ntype + 64)
            n = n1
        } else {
            // TYPE 1: STANDARD CALL GRID4 PWR
            const [call, grid, pwrStr] = parts
            n = this.packCall(call)
            const g = Array.from(grid.toUpperCase()).map(x => WSPR.CHAR_MAP.indexOf(x))
            // Characters A-R start at index 10 in CHAR_MAP, so we subtract 10
            const m_val = (179 - 10 * (g[0] - 10) - (g[2] - 10)) * 180 + 10 * (g[1] - 10) + (g[3] - 10)
            m = BigInt(m_val * 128 + parseInt(pwrStr) + 64)
        }
        return this._generateBytes(n, m)
    }

    _packPrefixInternal(callsign) {
        const parts = callsign.toUpperCase().split('/')
        let n = 0n, ng = 0, nadd = 0

        const i1 = callsign.indexOf('/')
        const suffixLen = callsign.length - i1 - 1

        // WSPR Rules: Suffixes are 1-2 chars, Prefixes are 1-3 chars
        if (suffixLen >= 1 && suffixLen <= 2) {
            // --- SUFFIX CASE (e.g., G4HUP/P) ---
            n = this.packCall(parts[0])
            nadd = 1
            const suffix = parts[1]
            if (suffix.length === 1) {
                const c = suffix.charCodeAt(0)
                let val = (c >= 48 && c <= 57) ? c - 48 : (c >= 65 && c <= 90) ? c - 65 + 10 : 38
                ng = 60000 - 32768 + val
            } else {
                ng = 60000 + 26 + parseInt(suffix, 10)
            }
        } else {
            // --- PREFIX CASE (e.g., VE3/G4HUP) ---
            const pfx = parts[0]
            const baseCall = parts[1]
            n = this.packCall(baseCall)

            let m_val = 0
            if (pfx.length === 1) m_val = 37 * 36 + 36
            else if (pfx.length === 2) m_val = 36

            for (let i = 0; i < pfx.length; i++) {
                const c = pfx.charCodeAt(i)
                let nc = (c >= 48 && c <= 57) ? c - 48 : (c >= 65 && c <= 90) ? c - 65 + 10 : 36
                m_val = 37 * m_val + nc
            }
            if (m_val > 32768) {
                m_val -= 32768
                nadd = 1
            }
            ng = m_val
        }
        return { n1: n, ng, nadd }
    }


    _generateBytes(n, m) {
        const data = new Uint8Array(7)
        data[0] = Number((n >> 20n) & 0xFFn)
        data[1] = Number((n >> 12n) & 0xFFn)
        data[2] = Number((n >> 4n) & 0xFFn)
        data[3] = Number(((n & 0x0Fn) << 4n) | ((m >> 18n) & 0x0Fn))
        data[4] = Number((m >> 10n) & 0xFFn)
        data[5] = Number((m >> 2n) & 0xFFn)
        data[6] = Number((m & 0x03n) << 6n)
        return data
    }

    _parity(x) {
        let count = 0
        while (x > 0n) { x &= (x - 1n); count++ }
        return count % 2
    }

}