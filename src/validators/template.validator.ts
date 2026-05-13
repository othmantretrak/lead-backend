import { z } from "zod";

export const createTemplateSchema = z.object({
  name: z.string().min(1).max(255),
  subject: z.string().min(1).max(998), // RFC 2822 max subject
  body: z.string().min(1),
});

export const updateTemplateSchema = createTemplateSchema.partial();

export const patchTemplateSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  subject: z.string().min(1).max(998).optional(),
  body: z.string().min(1).optional(),
});

export type CreateTemplateInput = z.infer<typeof createTemplateSchema>;
export type UpdateTemplateInput = z.infer<typeof updateTemplateSchema>;
export type PatchTemplateInput = z.infer<typeof patchTemplateSchema>;
