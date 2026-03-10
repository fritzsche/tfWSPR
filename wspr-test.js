import assert from 'node:assert'
import { WSPREncoder } from './wspr-encoder.js'
import { WSPRDecoder } from './wspr-decoder.js'


class UnitTest {
    call_test() {
        const testCalls = [
            "DJ1TF",
            "JJ1QPB",
            "N1MM",
            "W1WW",
            "X1S"
        ]
        console.log("--- WSPR Call Test ---")
        testCalls.forEach(call => {
            const encoder = new WSPREncoder()
            const decoder = new WSPRDecoder()

            const pack = encoder.packCall(call)
            const unpack = decoder._unpackCall(pack)
            assert.strictEqual(call, unpack)
        })
    }

    grid_test() {
        const testGrid = [
            "JN49",
            "AB12",
        ]
        console.log("--- WSPR Locator Test ---")
        testGrid.forEach(call => {
            const encoder = new WSPREncoder()
            const decoder = new WSPRDecoder()

            const pack = encoder.packGridPower(call)
            const unpack = decoder._unpackCall(Number(pack))
            assert.strictEqual(call, unpack)
        })
    }
    message_test() {
        const encoder = new WSPREncoder()
        const decoder = new WSPRDecoder()

        const testMessages = [
            "PA5CA JO32 10",
            "<G4HUP> IO85IW 30"
        ]

        console.log("--- WSPR Consistency Test ---")

        testMessages.forEach(msg => {
            console.log(`\nOriginal: ${msg}`)

            // 1. Encode into raw 50-bit packed bytes
            const packedBytes = encoder.encodeMessage(msg)
            console.log(`Packed Bytes: ${Buffer.from(packedBytes).toString('hex').toUpperCase()}`)

            // 2. Decode back
            const decoded = decoder._unpackFromBytes(packedBytes)

            console.log(`Decoded:  Type ${decoded.type}, Call: ${decoded.callsign}, Grid: ${decoded.grid || 'N/A'}, Pwr: ${decoded.power}`)
        })
    }



    main() {
        this.call_test()
        this.message_test()
    }
}

const UT = new UnitTest()
UT.main()