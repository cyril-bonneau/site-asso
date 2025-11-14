// tests/mocks/dynamoMock.js
import { vi } from 'vitest'

export const sendMock = vi.fn()

// Faux client Dynamo qu'on utilisera dans les mocks
export const ddbMock = {
    send: sendMock,
}

// Helper pour reset entre les tests
export function resetDdbMock() {
    sendMock.mockReset()
}
