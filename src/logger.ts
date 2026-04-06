import 'dotenv/config'

/**
 * Custom Logger for Builderbot
 * Purpose: Provide visibility into bot flows, state changes, and webhook payloads.
 */
class BotLogger {
    private botName: string

    constructor(botName: string = 'BOT') {
        this.botName = botName.toUpperCase()
    }

    private getTimestamp(): string {
        return new Date().toLocaleString('es-MX', { timeZone: 'America/Mexico_City' })
    }

    info(message: string, context: string = '') {
        console.log(`[\x1b[32m${this.getTimestamp()}\x1b[0m] [\x1b[34m${this.botName}\x1b[0m]${context ? ` [\x1b[35m${context}\x1b[0m]` : ''} ${message}`)
    }

    error(message: string, error: any = null, context: string = '') {
        console.error(`[\x1b[31m${this.getTimestamp()}\x1b[0m] [\x1b[34m${this.botName}\x1b[0m] [\x1b[31mERROR\x1b[0m]${context ? ` [\x1b[35m${context}\x1b[0m]` : ''} ${message}`)
        if (error) console.error(error)
    }

    debug(label: string, data: any, context: string = '') {
        this.info(`\x1b[33mDEBUG: ${label}\x1b[0m`, context)
        console.dir(data, { depth: null, colors: true })
    }

    webhook(action: string, payload: any) {
        this.info(`📡 Sending Webhook Action: \x1b[36m${action}\x1b[0m`, 'WEBHOOK')
        console.dir(payload, { depth: null, colors: true })
    }
}

export const logger = new BotLogger('DIESEL_FLOW')
