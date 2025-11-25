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
    marshall: (obj) => obj,
}))

// --- Imports réels ---

import { handler as onAuthStreamHandler } from '../../lambda/onAuthStreamLambda.js'
import { __mocks as ddbMocks } from '@aws-sdk/client-dynamodb'

const { sendMock } = ddbMocks

describe('onAuthStreamLambda', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        process.env.AUTH_TABLE = 'AuthTableTest'
        process.env.USER_TABLE = 'UserTableTest'
    })

    it('insère les données dans USER_TABLE quand il reçoit un event INSERT', async () => {
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

        sendMock.mockResolvedValueOnce({})

        await onAuthStreamHandler(event)

        expect(sendMock).toHaveBeenCalledTimes(2)
        const firstCall = sendMock.mock.calls[0][0]
        const secondCall = sendMock.mock.calls[1][0]

        expect(firstCall.input).toEqual({
            TableName: 'UserTableTest',
            Item: {
                PK: 'USER#user-123',
                SK: 'PROFILE#user-123',
                userId: 'user-123',
                email: 'test@example.com',
                firstName: 'John',
                lastName: 'Doe',
            },
        })

        expect(secondCall.input).toEqual({
            TableName: 'UserTableTest',
            Item: {
                PK: 'EMAIL#test@example.com',
                SK: 'UNIQUE',
                userId: 'user-123',
            },
        })
    })

    it('ignore les événements qui ne sont pas INSERT', async () => {
        const event = {
            Records: [
                {
                    eventName: 'MODIFY',
                    dynamodb: {
                        NewImage: {
                            userId: 'user-123',
                            email: 'test@example.com',
                        },
                    },
                },
            ],
        }

        await onAuthStreamHandler(event)
        expect(sendMock).not.toHaveBeenCalled()
    })

    it('lance une erreur si DynamoDB échoue', async () => {
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

        sendMock.mockRejectedValueOnce(new Error('DynamoDB error'))

        await expect(onAuthStreamHandler(event)).rejects.toThrow('Internal error')
    })
})
