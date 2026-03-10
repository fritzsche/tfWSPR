import { FFT } from './fft.js'

const BUFFER_SIZE = 512
const fft = new FFT(BUFFER_SIZE)
const reBuffer = new Float32Array(BUFFER_SIZE)
const imBuffer = new Float32Array(BUFFER_SIZE)
let ptr = 0

let fftAccumulator = new Float32Array(BUFFER_SIZE)
let framesCount = 0
let slowAvg = 0.0001

let config = {
    gain: 60,
    floor: 20,
    averageN: 1 // How many FFTs to average before drawing a line
}

onmessage = (e) => {
    if (e.data.type === 'iq') { // receiver.js sends decimated i/q here
        reBuffer[ptr] = e.data.i;
        imBuffer[ptr] = e.data.q;
        ptr++;

        if (ptr >= 512) {
            processFFT();
            ptr = 0;
        }
    }
};

function processFFT() {
    const re = new Float32Array(reBuffer);
    const im = new Float32Array(imBuffer);
    fft.run(re, im);

    const averagedPwr = new Float32Array(512);
    let totalPwr = 0;
    for (let j = 0; j < 512; j++) {
        averagedPwr[j] = (re[j] * re[j]) + (im[j] * im[j]);
        totalPwr += averagedPwr[j];
    }

    // Fast AGC for the zoomed view
    const currentAvg = totalPwr / 512;
    slowAvg = (slowAvg * 0.9) + (currentAvg * 0.1);

    postMessage({ type: 'fft_line', pwr: averagedPwr, avg: slowAvg });
}