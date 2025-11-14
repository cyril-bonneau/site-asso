import { describe, it, expect, beforeEach, vi } from 'vitest'

// --- Mocks hoistés ---

vi.mock('argon2', () => {
    const verifyMock = vi.fn()
    return {
        default: {
            verify: (...args) => verifyMock(...args),
        },
        __mocks: { verifyMock },
    }
})

vi.mock('@aws-sdk/lib-dynamodb', () => {
    const sendMock = vi.fn()

    class GetCommand {
        constructor(input) {
            this.input = input
        }
    }

    class TransactWriteCommand {
        constructor(input) {
            this.input = input
        }
    }

    return {
        DynamoDBDocumentClient: {
            from: vi.fn(() => ({ send: sendMock })),
        },
        GetCommand,
        TransactWriteCommand,
        __mocks: { sendMock },
    }
})

// --- Imports APRÈS les mocks ---

import { handler as removeAuthUserHandler } from '../lambda/removeAuthUserLambda.js'
import { __mocks as argonMocks } from 'argon2'
import { __mocks as ddbLibMocks } from '@aws-sdk/lib-dynamodb'

const { verifyMock: argonVerifyMock } = argonMocks
const { sendMock: ddbSendMock } = ddbLibMocks

beforeEach(() => {
    ddbSendMock.mockReset()
    argonVerifyMock.mockReset()
    process.env.AUTH_TABLE = 'AuthTableTest'
})

describe('removeAuthUserLambda - succès / échec / échec critique', () => {
    it('✅ supprime un utilisateur si mot de passe correct', async () => {
        ddbSendMock
            .mockResolvedValueOnce({ Item: { passwordHash: 'HASHED' } }) // GetCommand
            .mockResolvedValueOnce({ $metadata: { httpStatusCode: 200 } }) // TransactWrite

        argonVerifyMock.mockResolvedValueOnce(true)

        const event = {
            body: JSON.stringify({
                id: 'abc123',
                email: 'test@example.com',
                password: 'ValidPwd123!',
            }),
        }

        const res = await removeAuthUserHandler(event)

        expect(res.statusCode).toBe(201)
        const body = JSON.parse(res.body)
        expect(body.ok).toBe(true)
        expect(body.message).toBe('User removed')

        expect(ddbSendMock).toHaveBeenCalledTimes(2)
        expect(argonVerifyMock).toHaveBeenCalledTimes(1)
    })

    it('⚠️ échec logique : mauvais mot de passe → WRONG_PASSWORD', async () => {
        ddbSendMock.mockResolvedValueOnce({ Item: { passwordHash: 'HASHED' } })
        argonVerifyMock.mockResolvedValueOnce(false)

        const event = {
            body: JSON.stringify({
                id: 'abc123',
                email: 'test@example.com',
                password: 'BadPwd',
            }),
        }

        await expect(removeAuthUserHandler(event)).rejects.toMatchObject({
            code: 'WRONG_PASSWORD',
            message: 'Wrong password',
        })

        expect(argonVerifyMock).toHaveBeenCalledTimes(1)
    })

    it('💥 échec critique : GetCommand DDB plante → throw', async () => {
        ddbSendMock.mockRejectedValueOnce(new Error('Dynamo down'))

        const event = {
            body: JSON.stringify({
                id: 'abc123',
                email: 'test@example.com',
                password: 'Whatever',
            }),
        }

        await expect(removeAuthUserHandler(event)).rejects.toThrow('Dynamo down')
    })
})
