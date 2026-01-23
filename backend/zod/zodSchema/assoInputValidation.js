import { z } from 'zod';

export const assoInputSchema = z.object({
    name: z.string().trim().min(1).max(100),
    description: z.string().trim().min(1).max(500),
    type: z.enum(['association', 'club', 'foundation', 'other']),
    postalCode: z.string().trim().min(1).max(20),
});