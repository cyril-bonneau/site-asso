// middlewares/corsMiddlewares.js
const cors = require('cors');

const allowedOrigins = [
    'https://localhost:3000', // CRA
];

const corsOptions = {
    origin(origin, callback) {
        if (!origin) return callback(null, true); // ex: Postman, curl
        if (allowedOrigins.includes(origin)) return callback(null, origin); // renvoie l'origin exact
        return callback(new Error('Not allowed by CORS'));
    },
    credentials: true,           // nécessaire pour Set-Cookie
    optionsSuccessStatus: 204,   // évite certains soucis IE/legacy
};

const corsMiddleware = cors(corsOptions);

module.exports = { corsMiddleware, corsOptions };
