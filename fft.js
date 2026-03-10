export class FFT {
    constructor() {
        this.n = 512;
        this.rev = new Int32Array(512);
        this.sinT = new Float64Array(512);
        this.cosT = new Float64Array(512);

        // 1. Pre-calculate bit-reversal table (Small & Fast)
        for (let i = 0; i < 512; i++) {
            let j = 0;
            for (let bit = 0; bit < 9; bit++) {
                if ((i >> bit) & 1) j |= (1 << (8 - bit));
            }
            this.rev[i] = j;
        }

        // 2. Pre-calculate twiddle factors for each stage
        // This avoids calling Math.sin/Math.cos inside the triple-nested loop
        for (let i = 0; i < 512; i++) {
            const angle = -2 * Math.PI * i / 512;
            this.sinT[i] = Math.sin(angle);
            this.cosT[i] = Math.cos(angle);
        }
    }

    /**
     * Executes the FFT on re and im Float32/64Arrays.
     * Operates in-place for maximum performance.
     */
    run(re, im) {
        // 1. Bit-reversal Permutation
        for (let i = 0; i < 512; i++) {
            const j = this.rev[i];
            if (i < j) {
                let tempR = re[i]; re[i] = re[j]; re[j] = tempR;
                let tempI = im[i]; im[i] = im[j]; im[j] = tempI;
            }
        }

        // 2. Butterfly stages
        for (let len = 2; len <= 512; len <<= 1) {
            const halfLen = len >> 1;
            const step = 512 / len;

            for (let i = 0; i < 512; i += len) {
                for (let j = 0; j < halfLen; j++) {
                    const twiddleIdx = j * step;
                    const w_re = this.cosT[twiddleIdx];
                    const w_im = this.sinT[twiddleIdx];

                    const low = i + j;
                    const high = i + j + halfLen;

                    // THE CRITICAL FIX: Complex multiplication
                    // (a + bi) * (c + di) = (ac - bd) + i(ad + bc)
                    const v_re = re[high] * w_re - im[high] * w_im;
                    const v_im = re[high] * w_im + im[high] * w_re;

                    const u_re = re[low];
                    const u_im = im[low];

                    re[low] = u_re + v_re;
                    im[low] = u_im + v_im;
                    re[high] = u_re - v_re;
                    im[high] = u_im - v_im;
                }
            }
        }
    }
}