import { describe, it, expect, beforeEach, vi } from 'vitest'

// --- Mocks hoistés ---

vi.mock('@aws-sdk/client-dynamodb', () => {
    const sendMock = vi.fn()

    class DynamoDBClient {
        constructor() {
            this.send = sendMock
        }
    }

    class DeleteItemCommand {
        constructor(input) {
            this.input = input
        }
    }

    return {
        DynamoDBClient,
        DeleteItemCommand,
        __mocks: { sendMock },
    }
})

vi.mock('@aws-sdk/util-dynamodb', () => ({
    unmarshall: (raw) => raw,
    marshall: (obj) => obj,
}))

// --- Imports APRÈS les mocks ---

import { handler as onRemoveAuthStreamHandler } from '../lambda/onRemoveAuthStreamLambda.js'
import { __mocks as ddbClientMocks } from '@aws-sdk/client-dynamodb'

const { sendMock: ddbSendMock } = ddbClientMocks

beforeEach(() => {
    ddbSendMock.mockReset()
    process.env.USER_TABLE = 'UserTableTest'
})

describe('onRemoveAuthStreamLambda - succès / échec / échec critique', () => {
    it('✅ supprime lock EMAIL et profil USER sur REMOVE', async () => {
        ddbSendMock
            .mockResolvedValueOnce({}) // delete EMAIL#
            .mockResolvedValueOnce({}) // delete USER#

        const event = {
            Records: [
                {
                    eventName: 'REMOVE',
                    dynamodb: {
                        OldImage: {
                            email: 'test@example.com',
                            userId: 'user-123',
                        },
                    },
                },
            ],
        }

        await expect(onRemoveAuthStreamHandler(event)).resolves.toBeUndefined()
        expect(ddbSendMock).toHaveBeenCalledTimes(2)
    })

    it('⚠️ échec logique : lock EMAIL# inexistant (ConditionalCheckFailed) → pas de throw', async () => {
        const ccf = new Error('CCF')
        ccf.name = 'ConditionalCheckFailedException'

        ddbSendMock
            .mockRejectedValueOnce(ccf) // delete EMAIL# → CCF, log + continue
            .mockResolvedValueOnce({})  // delete USER#

        const event = {
            Records: [
                {
                    eventName: 'REMOVE',
                    dynamodb: {
                        OldImage: {
                            email: 'dup@example.com',
                            userId: 'user-dup',
                        },
                    },
                },
            ],
        }

        await expect(onRemoveAuthStreamHandler(event)).resolves.toBeUndefined()
        expect(ddbSendMock).toHaveBeenCalledTimes(2)
    })

    it('💥 échec critique : erreur réessayable sur delete USER → throw', async () => {
        ddbSendMock.mockResolvedValueOnce({}) // delete EMAIL OK

        const err = new Error('Internal error')
        err.name = 'InternalServerError'
        ddbSendMock.mockRejectedValueOnce(err) // delete USER

        const event = {
            Records: [
                {
                    eventName: 'REMOVE',
                    dynamodb: {
                        OldImage: {
                            email: 'err@example.com',
                            userId: 'user-err',
                        },
                    },
                },
            ],
        }

        await expect(onRemoveAuthStreamHandler(event)).rejects.toThrow('Internal error')
    })
})
