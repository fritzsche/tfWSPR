class WSPRAudioProcessor extends AudioWorkletProcessor {
    process(inputs) {
        const input = inputs[0];
        if (input && input[0]) {
            // We clone the Float32Arrays to avoid neutering issues 
            // and pass them as Transferable objects for zero-copy speed.
            const i = new Float32Array(input[0]);
            const q = input[1] ? new Float32Array(input[1]) : null;
            
            this.port.postMessage({ i, q }, q ? [i.buffer, q.buffer] : [i.buffer]);
        }
        return true;
    }
}
registerProcessor('wspr-processor', WSPRAudioProcessor);