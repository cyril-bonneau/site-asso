export const handler = async (event) => {
    return {
        statusCode: 200,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            ok: true,
            message: 'Hello from Lambda in eu-west-3 👋',
            ts: Date.now(),
            requestId: event?.requestContext?.requestId ?? null,
            path: event?.rawPath ?? null,
        }),
    };
};