import { describe, it, expect, beforeEach, vi } from 'vitest'

// --- Mocks hoistés ---

// On mocke maintenant checkPasswordByUserId
vi.mock('../helpers/checkPasswordByUserId.js', () => {
    const checkPasswordByUserIdMock = vi.fn()
    return {
        checkPasswordByUserId: (...args) => checkPasswordByUserIdMock(...args),
        __mocks: { checkPasswordByUserIdMock },
    }
})

vi.mock('@aws-sdk/lib-dynamodb', () => {
    const sendMock = vi.fn()

    class TransactWriteCommand {
        constructor(input) {
            this.input = input
        }
    }

    return {
        DynamoDBDocumentClient: {
            from: vi.fn(() => ({ send: sendMock })),
        },
        TransactWriteCommand,
        __mocks: { sendMock },
    }
})

// --- Imports APRÈS les mocks ---

import { handler as removeAuthUserHandler } from '../lambda/removeAuthUserLambda.js'
import { __mocks as checkPasswordByUserIdMocks } from '../helpers/checkPasswordByUserId.js'
import { __mocks as ddbLibMocks } from '@aws-sdk/lib-dynamodb'

const { checkPasswordByUserIdMock } = checkPasswordByUserIdMocks
const { sendMock: ddbSendMock } = ddbLibMocks

beforeEach(() => {
    ddbSendMock.mockReset()
    checkPasswordByUserIdMock.mockReset()
    process.env.AUTH_TABLE = 'AuthTableTest'
})

describe('removeAuthUserLambda - succès / mauvais mot de passe / erreur DDB', () => {
    it('✅ supprime un utilisateur si mot de passe correct', async () => {
        // checkPasswordByUserId retourne true
        checkPasswordByUserIdMock.mockResolvedValueOnce(true)

        // TransactWriteCommand réussit
        ddbSendMock.mockResolvedValueOnce({ $metadata: { httpStatusCode: 200 } })

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

        // checkPasswordByUserId appelé une fois avec les bons params
        expect(checkPasswordByUserIdMock).toHaveBeenCalledTimes(1)
        expect(checkPasswordByUserIdMock).toHaveBeenCalledWith({
            password: 'ValidPwd123!',
            userId: 'abc123',
        })

        // Une seule requête DDB : le TransactWrite
        expect(ddbSendMock).toHaveBeenCalledTimes(1)
    })

    it('⚠️ échec logique : mauvais mot de passe → WRONG_PASSWORD', async () => {
        // checkPasswordByUserId = false
        checkPasswordByUserIdMock.mockResolvedValueOnce(false)

        const event = {
            body: JSON.stringify({
                id: 'abc123',
                email: 'test@example.com',
                password: 'BadPwd',
            }),
        }

        // Le handler ne catch pas, donc on attend un rejet
        await expect(removeAuthUserHandler(event)).rejects.toMatchObject({
            code: 'WRONG_PASSWORD',
            message: 'Wrong password',
        })

        expect(checkPasswordByUserIdMock).toHaveBeenCalledTimes(1)
        // DDB ne doit jamais être appelé dans ce cas
        expect(ddbSendMock).not.toHaveBeenCalled()
    })

    it('💥 échec critique : TransactWrite DDB plante → throw', async () => {
        // Mot de passe OK
        checkPasswordByUserIdMock.mockResolvedValueOnce(true)

        // Mais DDB plante au moment de la transaction
        ddbSendMock.mockRejectedValueOnce(new Error('Dynamo down'))

        const event = {
            body: JSON.stringify({
                id: 'abc123',
                email: 'test@example.com',
                password: 'Whatever',
            }),
        }

        await expect(removeAuthUserHandler(event)).rejects.toThrow('Dynamo down')

        expect(checkPasswordByUserIdMock).toHaveBeenCalledTimes(1)
        expect(ddbSendMock).toHaveBeenCalledTimes(1)
    })
})
