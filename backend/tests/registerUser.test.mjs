import { describe, it, expect, beforeEach, vi } from 'vitest'

// --- Mocks hoistés ---

vi.mock('../auth/passwordPolicy.js', () => {
    const validatePasswordBackendMock = vi.fn()
    return {
        validatePasswordBackend: (...args) => validatePasswordBackendMock(...args),
        __mocks: { validatePasswordBackendMock },
    }
})

vi.mock('argon2', () => {
    const hashMock = vi.fn()
    return {
        default: {
            hash: (...args) => hashMock(...args),
        },
        __mocks: { hashMock },
    }
})

vi.mock('nanoid', () => {
    const nanoidMock = vi.fn()
    return {
        nanoid: (...args) => nanoidMock(...args),
        __mocks: { nanoidMock },
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

vi.mock('../rateLimit/withRateLimit.js', () => ({
    withRateLimit: (fn, cfg) => {
        const wrapped = async (event) => fn(event)
        wrapped.__original = fn
        wrapped.__cfg = cfg
        return wrapped
    },
}))

// --- Imports APRÈS les mocks ---

import { handler as registerUserHandler } from '../lambda/registerUserLambda.js'
import { __mocks as passwordPolicyMocks } from '../auth/passwordPolicy.js'
import { __mocks as argon2Mocks } from 'argon2'
import { __mocks as nanoidMocks } from 'nanoid'
import { __mocks as ddbLibMocks } from '@aws-sdk/lib-dynamodb'

const { validatePasswordBackendMock } = passwordPolicyMocks
const { hashMock: argonHashMock } = argon2Mocks
const { nanoidMock } = nanoidMocks
const { sendMock: ddbSendMock } = ddbLibMocks

beforeEach(() => {
    validatePasswordBackendMock.mockReset()
    argonHashMock.mockReset()
    nanoidMock.mockReset()
    ddbSendMock.mockReset()

    process.env.AUTH_TABLE = 'AuthTableTest'
})

describe('registerUserLambda - succès / échec / échec critique', () => {
    it('✅ crée un utilisateur et retourne 201', async () => {
        validatePasswordBackendMock.mockResolvedValueOnce({ ok: true })
        nanoidMock.mockReturnValueOnce('user-123')
        argonHashMock.mockResolvedValueOnce('HASHED_PWD')

        ddbSendMock.mockResolvedValueOnce({
            $metadata: { httpStatusCode: 200 },
        })

        const event = {
            body: JSON.stringify({
                email: 'test@example.com',
                password: 'StrongPwd123!',
            }),
        }

        const res = await registerUserHandler(event)

        expect(res.statusCode).toBe(201)
        const body = JSON.parse(res.body)
        expect(body.ok).toBe(true)
        expect(body.message).toBe('user successfully created')

        expect(validatePasswordBackendMock).toHaveBeenCalledTimes(1)
        expect(ddbSendMock).toHaveBeenCalledTimes(1)
    })

    it('⚠️ retourne 422 si le mot de passe est trop faible', async () => {
        validatePasswordBackendMock.mockResolvedValueOnce({
            ok: false,
            reasons: ['TOO_SHORT'],
        })

        const event = {
            body: JSON.stringify({
                email: 'weak@example.com',
                password: '123',
            }),
        }

        const res = await registerUserHandler(event)

        expect(res.statusCode).toBe(422)

        const body = JSON.parse(res.body)
        expect(body.ok).toBe(false)
        expect(body.code).toBe('WEAK_PASSWORD')
        expect(body.reasons).toEqual(['TOO_SHORT'])

        expect(ddbSendMock).not.toHaveBeenCalled()
    })

    it('⚠️ retourne 409 si email déjà utilisé', async () => {
        validatePasswordBackendMock.mockResolvedValueOnce({ ok: true })
        nanoidMock.mockReturnValueOnce('user-dup')
        argonHashMock.mockResolvedValueOnce('HASHED_PWD')

        const err = new Error('Transaction cancelled')
        err.name = 'TransactionCanceledException'
        err.CancellationReasons = [
            { Code: 'ConditionalCheckFailed', Message: 'Email exists' }, // index 0
            { Code: 'None', Message: 'ok' },
        ]

        ddbSendMock.mockRejectedValueOnce(err)

        const event = {
            body: JSON.stringify({
                email: 'dup@example.com',
                password: 'StrongPwd123!',
            }),
        }

        const res = await registerUserHandler(event)

        expect(res.statusCode).toBe(409)
        const body = JSON.parse(res.body)
        expect(body.ok).toBe(false)
        expect(body.error).toBe('EMAIL_ALREADY_EXISTS')
    })

    it('💥 retourne 500 si une erreur inconnue DDB survient', async () => {
        validatePasswordBackendMock.mockResolvedValueOnce({ ok: true })
        nanoidMock.mockReturnValueOnce('user-err')
        argonHashMock.mockResolvedValueOnce('HASHED_PWD')

        ddbSendMock.mockRejectedValueOnce(new Error('Dynamo exploded'))

        const event = {
            body: JSON.stringify({
                email: 'err@example.com',
                password: 'StrongPwd123!',
            }),
        }

        const res = await registerUserHandler(event)

        expect(res.statusCode).toBe(500)
        const body = JSON.parse(res.body)
        expect(body.ok).toBe(false)
        expect(body.error).toBe('INTERNAL_ERROR')
    })
})
