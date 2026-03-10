export class WSPR {
   static CHAR_MAP = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ "
   static PR3 = new Uint8Array([
      1, 1, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 1, 1, 0, 0, 0, 1, 0, 0, 1, 0, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 1,
      0, 0, 0, 0, 0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1, 0, 0, 0, 1, 1, 0, 1, 0, 0, 0, 0, 1, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 0, 1,
      0, 0, 1, 0, 1, 1, 0, 0, 0, 1, 1, 0, 1, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 1, 1, 1, 0, 1, 1, 0, 0, 1, 1,
      0, 1, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 1, 0, 1, 1, 0, 0, 0, 1, 1, 0, 0, 0
   ])
   static POLY1 = 0xF2D05351n
   static POLY2 = 0xE4613C47n


   _getIdx(char, type = 'call') {
      const code = char.toUpperCase().charCodeAt(0)

      // 0-9 (ASCII 48-57)
      if (code >= 48 && code <= 57) return code - 48

      // Space (ASCII 32)
      if (code === 32) return 36

      if (type === 'grid') {
         // A-R (ASCII 65-82) -> 0-17
         // In grids, letters are base-18 or base-24 depending on position
         if (code >= 65 && code <= 82) return code - 65
      } else {
         // A-Z (ASCII 65-90) -> 10-35
         // In callsigns, letters follow numbers 0-9
         if (code >= 65 && code <= 90) return code - 55
      }
      return 36 // Default to space/error
   }

   wspr_hash(callsign) {
      // Ensure callsign is padded/trimmed to match C-string behavior
      const key = callsign.trim().toUpperCase()
      const length = key.length

      let a, b, c
      a = b = c = (0xdeadbeef + length + 146) >>> 0 // 146 is the initval used in wsprd

      const k = []
      for (let i = 0; i < length; i++) k.push(key.charCodeAt(i))

      // For WSPR, callsigns are short, so we usually skip the 12-byte blocks 
      // and go straight to the "tail" logic.

      // Simplification of the 'final' macro from C
      const rot = (x, k) => (x << k) | (x >>> (32 - k))

      // Handle remaining bytes (up to 12)
      // This matches the C switch(length) logic
      if (length >= 1) a = (a + k[0]) >>> 0
      if (length >= 2) a = (a + (k[1] << 8)) >>> 0
      if (length >= 3) a = (a + (k[2] << 16)) >>> 0
      if (length >= 4) a = (a + (k[3] << 24)) >>> 0
      if (length >= 5) b = (b + k[4]) >>> 0
      if (length >= 6) b = (b + (k[5] << 8)) >>> 0
      if (length >= 7) b = (b + (k[6] << 16)) >>> 0
      if (length >= 8) b = (b + (k[7] << 24)) >>> 0
      if (length >= 9) c = (c + k[8]) >>> 0
      if (length >= 10) c = (c + (k[9] << 8)) >>> 0
      if (length >= 11) c = (c + (k[10] << 16)) >>> 0
      if (length >= 12) c = (c + (k[11] << 24)) >>> 0

      // The 'final' macro
      c ^= b; c = (c - rot(b, 14)) >>> 0
      a ^= c; a = (a - rot(c, 11)) >>> 0
      b ^= a; b = (b - rot(a, 25)) >>> 0
      c ^= b; c = (c - rot(b, 16)) >>> 0
      a ^= c; a = (a - rot(c, 4)) >>> 0
      b ^= a; b = (b - rot(a, 14)) >>> 0
      c ^= b; c = (c - rot(b, 24)) >>> 0

      return (c & 0x7FFF) // Return the final 15-bit hash
   }
}