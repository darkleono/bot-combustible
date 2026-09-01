import crypto from 'crypto'

// Credenciales por defecto (pueden ser sobreescritas en .env)
const DEFAULT_USER = process.env.DASHBOARD_USER || 'admin'
const DEFAULT_PASS = process.env.DASHBOARD_PASS || 'ortiz2026'
const SESSION_SECRET = process.env.SESSION_SECRET || 'vales-secure-token-secret-2026'

/**
 * Genera un token de sesión firmado para el usuario
 */
export function generateSessionToken(username: string): string {
    const timestamp = Date.now()
    const payload = `${username}:${timestamp}`
    const signature = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('hex')
    return Buffer.from(`${payload}:${signature}`).toString('base64')
}

/**
 * Valida si un token de sesión es legítimo y no ha expirado (7 días)
 */
export function validateSessionToken(token: string): boolean {
    if (!token) return false
    try {
        const decoded = Buffer.from(token, 'base64').toString('utf8')
        const parts = decoded.split(':')
        if (parts.length !== 3) return false

        const [username, timestampStr, signature] = parts
        const timestamp = parseInt(timestampStr, 10)
        
        // Expiración a los 7 días
        const maxAge = 7 * 24 * 60 * 60 * 1000
        if (Date.now() - timestamp > maxAge) return false

        const expectedPayload = `${username}:${timestamp}`
        const expectedSignature = crypto.createHmac('sha256', SESSION_SECRET).update(expectedPayload).digest('hex')

        return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))
    } catch {
        return false
    }
}

/**
 * Valida credenciales contra las variables de entorno
 */
export function verifyCredentials(user: string, pass: string): boolean {
    const validUser = process.env.DASHBOARD_USER || DEFAULT_USER
    const validPass = process.env.DASHBOARD_PASS || DEFAULT_PASS
    return user === validUser && pass === validPass
}

/**
 * Extrae cookies de la cabecera HTTP
 */
export function parseCookies(cookieHeader: string = ''): Record<string, string> {
    const list: Record<string, string> = {}
    if (!cookieHeader) return list

    cookieHeader.split(';').forEach(cookie => {
        let [name, ...rest] = cookie.split('=')
        name = name?.trim()
        if (!name) return
        const value = rest.join('=').trim()
        list[name] = decodeURIComponent(value)
    })

    return list
}
