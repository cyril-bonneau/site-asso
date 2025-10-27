import express from "express";
import { getUserByEmail, insertUser } from "../../dal/dynamo.js";

const router = express.Router();

router.get("/", async (req, res) => {
    const { email } = req.query;
    if (!email) return res.status(400).json({ error: "Missing email param" });

    try {
        const user = await getUserByEmail(email);
        if (!user) return res.status(404).json({ error: "User not found" });
        res.json(user);
    } catch (err) {
        res.status(500).json({ error: "Internal error", details: err.message });
    }
});

router.put("/", async (req, res) => {
    console.log('req.body', req.body);
    const userData = req.body;
    if (!userData) return res.status(400).json({ error: "error no data found" });

    try {
        const user = await insertUser(userData);
        if (!user) return res.status(404).json({ error: "User not added", details: user });
        res.json(user);
    } catch (err) {
        res.status(500).json({ error: "Internal error", details: err.message });
    }
});

export default router;
