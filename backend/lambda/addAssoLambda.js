import { nanoid } from "nanoid";
import { json } from "../helpers/toolbox.js";
import { validateInput } from "../zod/validateInput.js";
import { assoInputSchema } from "../zod/zodSchema/assoInputValidation.js";
import { sendTransactToDb } from "../dal/requestToDb.js";

export const handler = async (event) => {
    let input;
    try {
        console.log("addAssoLambda event:", event);
        input = validateInput(event, assoInputSchema);

        if (!input.ok) {
            return json(input.statusCode, { ok: false, message: input.body.message });
        }
    } catch (error) {
        console.error("Error in addAssoLambda:", error);
        return json(500, { ok: false, message: "INTERNAL_SERVER_ERROR" });
    }

    input.body.data.slug = createSlug(input.body.data.name, input.body.data.postalCode);
    const newAsso = createAssoTransactionRequest(input.body.data);

    try {
        await sendTransactToDb(newAsso);
        console.log("Association saved successfully:", newAsso);
        return json(201, { ok: true, data: { assoId: newAsso[0].Put.Item.assoId } });
    } catch (error) {
        console.error("Error saving association:", error);
        return json(500, { ok: false, message: "INTERNAL_SERVER_ERROR" });
    }
}

function createAssoTransactionRequest(data) {
    const assoId = nanoid();

    const transaction = [
        {
            Put: {
                TableName: process.env.ASSO_TABLE,
                Item: {
                    PK: `ASSO#${data.slug}`,
                    SK: "UNIQUE",
                    assoId: assoId,
                    name: data.name,
                    createdAt: new Date().toISOString(),
                },
                ConditionExpression: "attribute_not_exists(PK)"
            }
        },
        {
            Put: {
                TableName: process.env.ASSO_TABLE,
                Item: {
                    PK: `ASSO#${assoId}`,
                    SK: "META",
                    assoId: assoId,
                    name: data.name,
                    slug: data.slug,
                    postalCode: data.postalCode,
                    description: data.description,
                    type: data.type,
                    createdAt: new Date().toISOString(),
                },
                ConditionExpression: "attribute_not_exists(PK)"
            }
        }
    ];

    return transaction;
}

function createSlug(name, postalCode) {
    return `${name}-${postalCode}`
        .normalize("NFD")                   // décompose accents
        .replace(/[\u0300-\u036f]/g, "")    // supprime accents
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
}
