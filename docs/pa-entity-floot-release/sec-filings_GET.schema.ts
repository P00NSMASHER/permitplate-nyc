import { z } from 'zod'

export const schema = z.object({
  ticker: z.string().optional(),
  cik: z.string().optional(),
  form: z.string().optional(),
  limit: z.string().optional(),
})

export type InputType = z.infer<typeof schema>
