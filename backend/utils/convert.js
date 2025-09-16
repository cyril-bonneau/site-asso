// petite fonction utilitaire
function fromBase64(envVar) {
    const value = process.env[envVar];
    if (!value) throw new Error(`${envVar} not set`);
    return Buffer.from(value, 'base64').toString('utf8').trim();
}

module.exports = { fromBase64 };