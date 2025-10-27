// middlewares/corsMiddlewares.js (ESM)
import cors from 'cors';

const allowedOrigins = ['https://localhost:3000'];

export const corsOptions = {
    origin(origin, callback) {
        if (!origin) return callback(null, true);
        if (allowedOrigins.includes(origin)) return callback(null, true);
        return callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
    optionsSuccessStatus: 204,
};

export const corsMiddleware = cors(corsOptions);
