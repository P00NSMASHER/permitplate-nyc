import { z } from 'zod'

export const schema = z.object({
  case: z.enum(['proceed', 'address_mismatch', 'domain_mismatch']).optional(),
})

export type InputType = z.infer<typeof schema>
