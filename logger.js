export class Logger {    
    constructor(enabled = true) {     
        this.enabled = enabled 
    }
    debug(msg) { if (this.enabled) console.log(`[DEBUG] ${msg}`) }
    info(msg) { console.log(`[INFO] ${msg}`) }
    table(data) { if (this.enabled) console.table(data) }
}