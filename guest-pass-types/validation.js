const { z } = require("zod");
const { hhmm } = require("../utils/validate");
const { allowedDaysSchema } = require("./weekdays");

const integer = z.number().int().min(0).max(2147483647);
const passTypeSchema = z.strictObject({
  label: z.string().trim().min(1, "Enter a pass name").max(32),
  cost: integer,
  valid: integer.min(1),
  limit: integer,
  settings: z.strictObject({
    play_after: hhmm("Enter a time in HH:MM format").nullable(),
    allowed_days: allowedDaysSchema.nullable().optional(),
  }),
});

const passTypeParams = z.object({
  id: z.string().regex(/^[1-9]\d*$/).transform(Number).pipe(integer.min(1)),
});

module.exports = { passTypeSchema, passTypeParams };
