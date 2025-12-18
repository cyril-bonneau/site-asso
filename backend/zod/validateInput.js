export function validateInput(event, schema) {
    let parsed;

    try {
        if (typeof event.body === 'string') {
            parsed = JSON.parse(event.body);
        } else {
            parsed = event.body || {};
        }
    } catch (err) {
        return { statusCode: 400, ok: false, body: { message: "INVALID_JSON_BODY" } };
    }

    const result = schema.safeParse(parsed);

    if (!result.success) {
        return {
            statusCode: 400,
            ok: false,
            body: { message: "INVALID_INPUT" },
        };
    }
    return { ok: true, body: { data: result.data } };
}