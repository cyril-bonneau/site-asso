console.log('[setupProxy] loaded');
const { createProxyMiddleware } = require('http-proxy-middleware');

module.exports = function (app) {
    app.use(
        '/api',
        createProxyMiddleware({
            target: 'https://localhost:8443',
            changeOrigin: true,
            secure: false,            // accepte ton cert auto-signé en dev
            // optionnel : réécrit /api -> /
            pathRewrite: { '^/api': '' },
            // debug utile si souci
            logLevel: 'debug',
        })
    );
};
