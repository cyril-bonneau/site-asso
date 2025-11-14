import { describe, it, expect, beforeEach, vi } from 'vitest'

// --- Mocks hoistés ---
vi.mock('@aws-sdk/lib-dynamodb', () => {
    const sendMock = vi.fn()

    class GetCommand {
        constructor(input) {
            this.input = input
        }
    }

    class UpdateCommand {
        constructor(input) {
            this.input = input
        }
    }

    return {
        DynamoDBDocumentClient: {
            from: vi.fn(() => ({ send: sendMock })),
        },
        GetCommand,
        UpdateCommand,
        __mocks: { sendMock },
    }
})

// --- Imports APRÈS les mocks ---
import { checkRateLimitBucket } from '../rateLimit/checkRateLimitBucket.js'
import { __mocks as ddbLibMocks } from '@aws-sdk/lib-dynamodb'

const { sendMock: ddbSendMock } = ddbLibMocks

beforeEach(() => {
    ddbSendMock.mockReset()
    process.env.RATE_LIMIT_TABLE = 'RateLimitTest'
})

describe('checkRateLimitBucket', () => {
    it('should allow when bucket has tokens', async () => {
        // 1er appel: GetCommand → bucket existant avec 1 token
        ddbSendMock.mockResolvedValueOnce({
            Item: {
                PK: 'RL#REGISTER#127.0.0.1',
                tokens: 1,
                lastRefillAt: Date.now(),
            },
        })

        // 2e appel: UpdateCommand → OK (consomme 1 token)
        ddbSendMock.mockResolvedValueOnce({})

        const res = await checkRateLimitBucket({
            key: 'RL#REGISTER#127.0.0.1',
            capacity: 3,
            refillRate: 0.1,
            cost: 1,
        })

        // ✅ On vérifie la forme de la réponse
        expect(res.allowed).toBe(true)
        expect(res.remaining).toBeTypeOf('number')
        expect(res.reset).toBeTypeOf('number')
        expect(res.headers).toMatchObject({
            'X-RateLimit-Limit': '3',
        })

        // Et que Dynamo a bien été appelé
        expect(ddbSendMock).toHaveBeenCalledTimes(2)
    })
})
