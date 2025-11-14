import { describe, it, expect, beforeEach, vi } from 'vitest'

// --- Mocks hoistés ---

vi.mock('@aws-sdk/client-dynamodb', () => {
    const sendMock = vi.fn()

    class DynamoDBClient {
        constructor() {
            this.send = sendMock
        }
    }

    class PutItemCommand {
        constructor(input) {
            this.input = input
        }
    }

    return {
        DynamoDBClient,
        PutItemCommand,
        __mocks: { sendMock },
    }
})

vi.mock('@aws-sdk/util-dynamodb', () => ({
    unmarshall: (raw) => raw,
    marshall: (obj) => obj,
}))

// --- Imports APRÈS les mocks ---

import { handler as onAuthStreamHandler } from '../lambda/onAuthStreamLambda.js'
import { __mocks as ddbClientMocks } from '@aws-sdk/client-dynamodb'

const { sendMock: ddbSendMock } = ddbClientMocks

beforeEach(() => {
    ddbSendMock.mockReset()
    process.env.USER_TABLE = 'UserTableTest'
})

describe('onAuthStreamLambda - succès / échec / échec critique', () => {
    it('✅ crée la projection USER + EMAIL sur INSERT', async () => {
        ddbSendMock
            .mockResolvedValueOnce({}) // lock EMAIL#
            .mockResolvedValueOnce({}) // profil USER#

        const event = {
            Records: [
                {
                    eventName: 'INSERT',
                    dynamodb: {
                        NewImage: {
                            userId: 'user-123',
                            email: 'test@example.com',
                            firstName: 'John',
                            lastName: 'Doe',
                        },
                    },
                },
            ],
        }

        await expect(onAuthStreamHandler(event)).resolves.toBeUndefined()
        expect(ddbSendMock).toHaveBeenCalledTimes(2)
    })

    it('⚠️ échec logique : collision idempotente (ConditionalCheckFailed) sur user → pas de throw', async () => {
        ddbSendMock.mockResolvedValueOnce({}) // lock EMAIL#

        const err = new Error('CCF')
        err.name = 'ConditionalCheckFailedException'
        ddbSendMock.mockRejectedValueOnce(err) // userItem

        const event = {
            Records: [
                {
                    eventName: 'INSERT',
                    dynamodb: {
                        NewImage: {
                            userId: 'user-dup',
                            email: 'dup@example.com',
                        },
                    },
                },
            ],
        }

        await expect(onAuthStreamHandler(event)).resolves.toBeUndefined()
        expect(ddbSendMock).toHaveBeenCalledTimes(2)
    })

    it('💥 échec critique : erreur réessayable (InternalServerError) → throw', async () => {
        ddbSendMock.mockResolvedValueOnce({})

        const err = new Error('Internal error')
        err.name = 'InternalServerError'
        ddbSendMock.mockRejectedValueOnce(err)

        const event = {
            Records: [
                {
                    eventName: 'INSERT',
                    dynamodb: {
                        NewImage: {
                            userId: 'user-err',
                            email: 'err@example.com',
                        },
                    },
                },
            ],
        }

        await expect(onAuthStreamHandler(event)).rejects.toThrow('Internal error')
    })
})
