const cors = require('cors');

const allowedOrigins = [
    'http://localhost:3000',
];

const corsOptions = {
    origin(origin, callback) {
        if (!origin) {
            return callback(null, true);
        }
        if (allowedOrigins.includes(origin)) {
            return callback(null, true);
        }
        return callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
};

module.exports = cors(corsOptions);
