import { z } from 'zod';

export const updateInputSchema = z.object({
    oldEmail: z.email().trim().toLowerCase().optional(),
    newEmail: z.email().trim().toLowerCase().optional(),
    lastName: z.string().trim().min(1).max(50).optional(),
    firstName: z.string().trim().min(1).max(50).optional(),
}).strict().refine((data) => {
    Object.keys(data).length > 0,
        { message: "At least one field must be provided for update" }
});