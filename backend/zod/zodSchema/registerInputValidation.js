import { z } from 'zod';
import { regex } from '../../helpers/toolbox.js';

export const registerInputSchema = z.object({
    email: z.string().email().trim().max(255).transform((val) => val.toLowerCase()),
    password: z.string().min(8).max(128),
    firstName: z.string().trim().min(1).max(50).regex(regex.name, "Nom invalide"),
    lastName: z.string().trim().min(1).max(50).regex(regex.name, "Nom invalide"),
}).strict();