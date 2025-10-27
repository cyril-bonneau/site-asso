import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import { corsMiddleware, corsOptions } from './middlewares/corsMiddlewares.js'
import https from 'https';
import {
    initKeys,
    signAccessToken, signRefreshToken,
    getAccessTokenData, getRefreshTokenData,
    decodeRefreshExpSeconds, hashToken,
    hashPassword, verifyPassword,
} from './auth/auth.js';
const port = process.env.PORT
const app = express()
import crypto from 'crypto';
import cookieParser from 'cookie-parser';
import { fromBase64 } from './utils/convert.js'

import { pingDdb, table as DDB_TABLE } from './dal/dynamo.js';
import getUserByEmailRoute from "./routes/ddb/getUserByEmail.js";
import { get } from 'http';

const isLambda = process.env.RUNTIME === 'lambda'

app.use(cookieParser());
app.use(corsMiddleware);
app.options(/^.*$/, cors(corsOptions)); // enable pre-flight for all routes
app.use(express.urlencoded({ extended: false }))
app.use(express.json())
if (!isLambda) {
    const { initUserDB, initAuthManagementDB, initUserDataDB } = await import('./dbRequest/init.js');
    initUserDB(); initAuthManagementDB(); initUserDataDB();
}

app.use((req, res, next) => {
    const isLambda = process.env.RUNTIME === 'lambda';
    if (!isLambda) return next();
    if (req.path === '/healthz' || req.path === '/ddb/ping' || req.path === '/ddb/user' || req.path === '/ddb/adduser') return next(); // autorisées
    return res.status(501).json({ error: 'DB disabled in Lambda (Step 2B). Try /api/healthz.' });
});

app.get('/ddb/ping', async (_req, res) => {
    try {
        const r = await pingDdb();
        res.json({ ok: true, table: DDB_TABLE, ping: r });
    } catch (e) {
        console.error('ddb/ping error:', e);
        res.status(500).json({ error: 'ddb ping failed', message: e.message });
    }
});

app.use('/ddb/user', getUserByEmailRoute);

app.use('/ddb/adduser', getUserByEmailRoute);

app.post("/register", async (req, res) => {
    if (isLambda) return res.status(501).json({ error: 'DB disabled in Lambda (Step 2B). Try /api/healthz.' });
    const data = req.body
    req.body.password = await hashPassword(req.body.password)
    const { insertUser } = await import('./dbRequest/post.js');
    const result = await insertUser(data)
    if (result instanceof Error) {
        if (result.message.includes("UNIQUE constraint failed: users.email")) {
            res.status(400).json({ error: "Email_already_exists" })
        } else {
            res.status(500).send("Error inserting data")
        }
    } else {
        res.send(result)
        console.log(`Your Email is ${data.email} and your password is ${data.password}`)
        console.log(`(alg=${process.env.JWT_ALG})`)
    }
})

app.post("/login", async (req, res) => {
    if (isLambda) return res.status(501).json({ error: 'DB disabled in Lambda (Step 2B). Try /api/healthz.' });
    const { email, password } = req.body
    const { getUserPasswordAndId } = await import('./dbRequest/get.js');
    const result = await getUserPasswordAndId(email)

    if (!result) {
        return res.status(401).json({ error: "Invalid email or password" });
    }

    const isSame = await verifyPassword(result.password, password)

    if (!isSame) {
        return res.status(401).json({ error: "Invalid email or password" });
    } else {
        const { refreshToken, accessToken } = await sendTokenToDb(result.id)

        res.cookie('refreshToken', refreshToken, {
            httpOnly: true,
            secure: true,
            sameSite: 'lax',
            maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
        }).status(200).json({ accessToken });
    }
})

app.post('/refresh', async (req, res) => {
    if (isLambda) return res.status(501).json({ error: 'DB disabled in Lambda (Step 2B). Try /api/healthz.' });
    try {
        const { refreshToken } = req.cookies;
        if (!refreshToken) {
            return res.status(401).json({ error: 'No refresh token provided' });
        }
        const payload = await getRefreshTokenData(refreshToken); //récupère les donnèes du token, obtiens le jti
        const user_id = payload.sub;
        const { getTokenByJti } = await import('./dbRequest/tokenManager.js');
        const tokenHash = await getTokenByJti(payload.jti); //récupère le hash grace au jti
        if (!tokenHash || tokenHash.revoked) {
            return res.status(401).json({ error: 'Invalid refresh token' });
        }

        const hash = await hashToken(refreshToken)

        if (hash === tokenHash.token_hash) {
            const { revokeToken } = await import('./dbRequest/tokenManager.js');
            const result = await revokeToken({ jti: payload.jti, revoked: 1 });
            if (result instanceof Error) {
                return res.status(500).json({ error: 'Error revoking token' });
            }
            const { sendTokenToDb } = await import('./index.js');
            const { refreshToken, accessToken } = await sendTokenToDb(user_id)

            res.cookie('refreshToken', refreshToken, {
                httpOnly: true,
                secure: true,
                sameSite: 'lax',
                maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
            }).status(200).json({ accessToken });
        } else {
            return res.status(403).json({ error: 'forbidden' })
        }
    } catch (error) {
        console.error('refresh error:', error)
        return res.status(401).json({ error: 'Invalid refresh' })
    }
})

app.post('/logout', async (req, res) => {
    try {
        const { refreshToken } = req.cookies || {}
        if (refreshToken) {
            const tokenData = await getRefreshTokenData(refreshToken).catch(() => null)
            if (tokenData?.jti) {
                const { revokeToken } = await import('./dbRequest/tokenManager.js');
                await revokeToken(tokenData.jti)
            }
        }
    } finally {
        res.clearCookie('refreshToken', { path: '/' })
        res.status(204).end()
    }
})

// app.post("/mileage", (req, res) => {
//     if (isLambda) return res.status(501).json({ error: 'DB disabled in Lambda (Step 2B). Try /api/healthz.' });
//     const data = req.body.kilometers
//     const result = insertKilometers(data)
//     if (result instanceof Error) {
//         res.status(500).send("Error inserting data")
//         return
//     }
// })

// app.get("/users", async (req, res) => {
//     if (isLambda) return res.status(501).json({ error: 'DB disabled in Lambda (Step 2B). Try /api/healthz.' });
//     const { getUsers } = await import('./dbRequest/get.js');
//     const users = getUsers()
//     res.send(users)
// });

app.get('/healthz', (req, res) => res.json({ ok: true, ts: Date.now() }));

async function sendTokenToDb(user_id) {

    if (isLambda) throw new Error('DB disabled in Lambda');

    const jti = crypto.randomUUID();
    const accessToken = await signAccessToken(user_id);
    const refreshToken = await signRefreshToken(user_id, jti);

    const payload = {
        user_id: user_id,
        token_hash: await hashToken(refreshToken),
        expires_at: await decodeRefreshExpSeconds(refreshToken),
        revoked: 0,
        jti: jti
    };

    const { insertToken } = await import('./dbRequest/tokenManager.js');
    const dbResult = insertToken(payload);
    console.log(refreshToken)
    console.log(accessToken)
    if (dbResult instanceof Error) {
        return res.status(500).send("Error inserting refresh token");
    }
    return {
        refreshToken: refreshToken,
        accessToken: accessToken
    }
}

export default app

if (process.env.RUNTIME !== 'lambda') {
    ; (async () => {
        try {
            await initKeys();

            const key = fromBase64('LOCALHOST_CERT_KEY_PATH');
            const cert = fromBase64('LOCALHOST_CERT_CRT_PATH');

            https.createServer({ key, cert }, app).listen(port, () => {
                console.log(`HTTPS server running on https://localhost:${port}`);
            });
        } catch (err) {
            console.error("Failed to init JWT keys:", err);
            process.exit(1);
        }
    })();
}
