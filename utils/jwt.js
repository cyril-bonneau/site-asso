function base64urlDecode(input = '') {
    try {
        const addBase64Padding = (s) => s + '='.repeat((4 - (s.length % 4)) % 4)
        const base64String = addBase64Padding(input.replace(/-/g, '+').replace(/_/g, '/'))
        const binaryString = atob(base64String)
        const byteArray = Uint8Array.from(binaryString, (char) => char.charCodeAt(0))
        return new TextDecoder().decode(byteArray)
    } catch {
        return ''
    }
}

export function decodeJwt(token) {
    if (!token) return null
    const segments = token.split('.')           // header.payload.signature
    if (segments.length < 2) return null
    try {
        const payloadSegment = segments[1]
        const payloadJsonString = base64urlDecode(payloadSegment)
        const payloadObject = JSON.parse(payloadJsonString)
        return payloadObject ?? null
    } catch {
        return null
    }
}

export function classNames(...classes) {
    return classes.filter(Boolean).join(' ')
}