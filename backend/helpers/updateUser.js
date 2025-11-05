// Construit dynamiquement une UpdateExpression SET/REMOVE à partir d'un patch "flexible"
export function buildDynUpdate(patch, { allow = [] } = {}) {
    const names = {};
    const values = {};
    const setParts = [];
    const removeParts = [];

    // Whitelist basique pour éviter d’écrire n’importe où
    const entries = Object.entries(patch).filter(([k, v]) => allow.length === 0 || allow.includes(k));

    for (const [key, val] of entries) {
        const name = `#${key}`;
        const placeholder = `:${key}`;
        names[name] = key;

        if (val === undefined) {
            // on ignore totalement -> ni SET ni REMOVE
            continue;
        }

        if (val === null || (typeof val === "object" && val && val.$remove === true)) {
            // Convention: null (ou { $remove:true }) => REMOVE
            removeParts.push(name);
            continue;
        }

        // Valeur définie => SET
        values[placeholder] = val; // DocumentClient + removeUndefinedValues: true gère le marshalling
        setParts.push(`${name} = ${placeholder}`);
    }

    if (setParts.length === 0 && removeParts.length === 0) {
        return null; // rien à faire
    }

    const clauses = [];
    if (setParts.length) clauses.push(`SET ${setParts.join(", ")}`);
    if (removeParts.length) clauses.push(`REMOVE ${removeParts.join(", ")}`);

    return {
        UpdateExpression: clauses.join(" "),
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: Object.keys(values).length ? values : undefined,
    };
}
