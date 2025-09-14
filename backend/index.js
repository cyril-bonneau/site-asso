require("dotenv").config()
const express = require("express");
const corsMiddleware = require("./middlewares/corsMiddlewares")
const {
    initKeys,
    signAccessToken, signRefreshToken,
    verifyAccessToken, verifyRefreshToken,
    decodeRefreshExpSeconds, hashToken,
    hashPassword, verifyPassword,
} = require('./auth/auth');
const port = process.env.PORT
const app = express()
const cookieParser = require('cookie-parser');
const init = require("./dbRequest/init")

const { getUsers, getUserPassword } = require("./dbRequest/get")
const { insertUser, insertKilometers } = require("./dbRequest/post")

app.use(cookieParser());
app.use(corsMiddleware);
app.use(express.urlencoded({ extended: false }))
app.use(express.json())
try {
    init.initUserDB();
    init.initAuthManagementDB();
    init.initUserDataDB();
} catch (error) {
    console.error("Error initializing database:", error);
}

async () => {
    await initKeys();
};

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

app.post("/signin", async (req, res) => {
    const data = req.body
    const result = await getUserPassword(data.email)
    if (!result) {
        return res.status(401).json({ error: "Invalid email or password" });
    }
    console.log(result.password + ' ' + req.body.password)
    const isSame = await verifyPassword(result.password, req.body.password)
    console.log(isSame)
    if (!isSame) {
        return res.status(401).json({ error: "Invalid email or password" });
    } else {
        //EN TRAVAUX
        const accessToken = await signAccessToken(data.email);
        const refreshToken = await signRefreshToken(data.email);
        const refreshExp = await decodeRefreshExpSeconds(refreshToken);
        const refreshTokenHash = await hashToken(refreshToken);
        // EN TRAVAUX
        res.status(201).send("User signed in successfully")
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
})

app.listen(port, () => {
    console.log(`server is running on port ${port}`)
})