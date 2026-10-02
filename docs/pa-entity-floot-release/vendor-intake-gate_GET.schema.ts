import { z } from 'zod'

export const schema = z.object({
  name: z.string().optional(),
  address: z.string().optional(),
  domain: z.string().optional(),
})

export type InputType = z.infer<typeof schema>
