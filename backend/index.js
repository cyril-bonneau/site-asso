require("dotenv").config()
const express = require("express");
const cors = require("cors")
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
app.use(cookieParser());
const init = require("./dbRequest/init")
const { getUsers } = require("./dbRequest/get")
const { insertUser, insertKilometers } = require("./dbRequest/post")

app.use(cors())
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
    const isProd = process.env.NODE_ENV === 'production';
};

app.post("/register", async (req, res) => {
    const data = req.body
    req.body.password = await hashPassword(req.body.password)
    const isSame = await verifyPassword(req.body.password, 'test123456789')
    console.log("is Same ?", isSame)
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