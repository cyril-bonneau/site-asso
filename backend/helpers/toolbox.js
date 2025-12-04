export function normalizeEmail(email) {
    return String(email).trim().toLowerCase();
}

export function decode(payload) {
    const decoder = new TextDecoder("utf-8");
    const payloadString = decoder.decode(payload);
    let response = JSON.parse(payloadString);
    return {
        ...response,
        body: JSON.parse(response.body)
    };
}

export function json(statusCode, body) {
    return {
        statusCode,
        headers: {
            "content-type": "application/json",
        },
        body: JSON.stringify(body),
    };
}

export function toBase64Url(buffer) {
    return Buffer.from(buffer)
        .toString("base64")
        .replace(/=/g, "")
        .replace(/\+/g, "-")
        .replace(/\//g, "_");
}