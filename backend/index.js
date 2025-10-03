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
import { initUserDB, initAuthManagementDB, initUserDataDB } from './dbRequest/init.js';
import { fromBase64 } from './utils/convert.js'

import { getUsers, getUserPasswordAndId } from './dbRequest/get.js';
import { insertUser } from './dbRequest/post.js';
import { getTokenByJti, revokeToken, insertToken } from './dbRequest/tokenManager.js';
import { error } from 'console';

app.use(cookieParser());
app.use(corsMiddleware);
app.options(/^.*$/, cors(corsOptions)); // enable pre-flight for all routes
app.use(express.urlencoded({ extended: false }))
app.use(express.json())
try {
    initUserDB();
    initAuthManagementDB();
    initUserDataDB();
} catch (error) {
    console.error("Error initializing database:", error);
}

app.post("/register", async (req, res) => {
    const data = req.body
    req.body.password = await hashPassword(req.body.password)
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
    const { email, password } = req.body
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
    try {
        const { refreshToken } = req.cookies;
        if (!refreshToken) {
            return res.status(401).json({ error: 'No refresh token provided' });
        }
        const payload = await getRefreshTokenData(refreshToken); //récupère les donnèes du token, obtiens le jti
        const user_id = payload.sub;

        const tokenHash = await getTokenByJti(payload.jti); //récupère le hash grace au jti
        if (!tokenHash || tokenHash.revoked) {
            return res.status(401).json({ error: 'Invalid refresh token' });
        }

        const hash = await hashToken(refreshToken)

        if (hash === tokenHash.token_hash) {
            const result = await revokeToken({ jti: payload.jti, revoked: 1 });
            console.log('je passe dedans')
            console.log(result)
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
                await revokeToken(tokenData.jti)
            }
        }
    } finally {
        res.clearCookie('refreshToken', { path: '/' })
        res.status(204).end()
    }
})

app.post("/mileage", (req, res) => {
    const data = req.body.kilometers
    const result = insertKilometers(data)
    if (result instanceof Error) {
        res.status(500).send("Error inserting data")
        return
    }
})

app.get("/users", (req, res) => {
    const users = getUsers()
    res.send(users)
});

app.get('/healthz', (req, res) => res.json({ ok: true, ts: Date.now() }));

async function sendTokenToDb(user_id) {

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
