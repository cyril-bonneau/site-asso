import { z } from 'zod';
import { regex } from 'helpers/toolbox.js';

export const updateInputSchema = z.object({
    newEmail: z.email().trim().toLowerCase().optional(),
    newLastName: z.string().trim().min(1).max(50).optional().regex(regex.name, "Nom invalide"),
    newFirstName: z.string().trim().min(1).max(50).optional().regex(regex.name, "Nom invalide"),
}).strict().refine(
    (data) => Object.keys(data).length > 0,
    { message: "At least one field must be provided for update" }
);