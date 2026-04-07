import 'dotenv/config'
import fs from 'fs'
import { join } from 'path'

/**
 * 🛠️ BOT LOGGER REFORZADO v2.1
 * Propósito: Eliminar los "fallos silenciosos" mediante persistencia en archivos
 * y control dinámico de niveles vía .env ('silent', 'error', 'info', 'debug').
 */
class BotLogger {
    private botName: string
    private logDir: string
    private errorLog: string
    private combinedLog: string
    private levels: Record<string, number> = {
        'silent': 0,
        'error': 1,
        'info': 2,
        'debug': 3
    }

    constructor(botName: string = 'BOT') {
        this.botName = botName.toUpperCase()
        this.logDir = join(process.cwd(), 'logs')
        this.errorLog = join(this.logDir, 'error.log')
        this.combinedLog = join(this.logDir, 'bot.log')

        if (!fs.existsSync(this.logDir)) {
            fs.mkdirSync(this.logDir, { recursive: true })
        }
    }

    private get currentLevel(): number {
        const envLevel = (process.env.LOG_LEVEL || 'info').toLowerCase()
        return this.levels[envLevel] ?? 2 // Default: info
    }

    private getTimestamp(): string {
        const now = new Date()
        return now.toLocaleString('es-MX', { 
            timeZone: 'America/Mexico_City',
            day: '2-digit', month: '2-digit', year: 'numeric',
            hour: '2-digit', minute: '2-digit', second: '2-digit'
        })
    }

    private writeToFile(file: string, level: string, message: string, context: string) {
        const logEntry = `[${this.getTimestamp()}] [${this.botName}] [${level}]${context ? ` [${context}]` : ''} ${message}\n`
        try {
            fs.appendFileSync(file, logEntry)
        } catch (err) {
            console.error('CRITICAL: Failed to write to log file', err)
        }
    }

    info(message: string, context: string = 'SYSTEM') {
        this.writeToFile(this.combinedLog, 'INFO', message, context)
        if (this.currentLevel < 2) return
        
        const ts = this.getTimestamp()
        console.log(`[\x1b[32m${ts}\x1b[0m] [\x1b[34m${this.botName}\x1b[0m] [\x1b[36m${context}\x1b[0m] ${message}`)
    }

    error(message: string, error: any = null, context: string = 'ERROR') {
        this.writeToFile(this.combinedLog, 'ERROR', message, context)
        this.writeToFile(this.errorLog, 'ERROR', `${message}${error ? ` - ${error instanceof Error ? error.stack : JSON.stringify(error)}` : ''}`, context)
        
        if (this.currentLevel < 1) return
        
        const ts = this.getTimestamp()
        console.error(`\n[\x1b[31m${ts}\x1b[0m] [\x1b[34m${this.botName}\x1b[0m] [\x1b[31mFATAL ERROR\x1b[0m] [${context}]`)
        console.error(`🛑 Mensaje: ${message}`)
        
        if (error) {
            const errorMsg = error instanceof Error ? error.stack : JSON.stringify(error, null, 2)
            console.error(`\x1b[33mDetalles:\x1b[0m\n${errorMsg}\n`)
        }
    }

    debug(label: string, data: any, context: string = 'DEBUG') {
        this.writeToFile(this.combinedLog, 'DEBUG', `${label}: ${JSON.stringify(data)}`, context)
        if (this.currentLevel < 3) return

        const ts = this.getTimestamp()
        console.info(`[\x1b[34m${ts}\x1b[0m] [\x1b[34m${this.botName}\x1b[0m] [\x1b[33mDEBUG: ${label}\x1b[0m] [${context}]`)
        console.dir(data, { depth: 2, colors: true })
    }

    fatal(message: string, error: any = null, context: string = 'CRITICAL') {
        // Fatal siempre se muestra a menos que sea 'silent', pero incluso en 'silent' se loguea en archivo.
        this.error(`🚨 FALLO CATASTRÓFICO: ${message}`, error, context)
        console.error('\n\x1b[41m\x1b[37m EL SISTEMA SE DETENDRÁ PARA EVITAR CORRUPCIÓN DE DATOS O CONFLICTOS DE PUERTO \x1b[0m\n')
        
        setTimeout(() => process.exit(1), 500)
    }

    success(message: string, context: string = 'SYSTEM') {
        this.writeToFile(this.combinedLog, 'SUCCESS', message, context)
        if (this.currentLevel < 2) return

        const ts = this.getTimestamp()
        console.log(`[\x1b[32m${ts}\x1b[0m] [\x1b[34m${this.botName}\x1b[0m] [\x1b[32mSUCCESS\x1b[0m] [${context}] ✅ ${message}`)
    }
}

export const logger = new BotLogger('COMB-CORE')
