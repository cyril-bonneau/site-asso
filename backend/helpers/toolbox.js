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