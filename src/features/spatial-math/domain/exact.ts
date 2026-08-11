import { z } from "zod";

export const EXACT_INTEGER_LIMIT = 1_000_000_000;

function greatestCommonDivisor(left: number, right: number): number {
  let a = Math.abs(left);
  let b = Math.abs(right);
  while (b !== 0) {
    const remainder = a % b;
    a = b;
    b = remainder;
  }
  return a;
}

export const rationalSchema = z
  .object({
    numerator: z.number().int().min(-EXACT_INTEGER_LIMIT).max(EXACT_INTEGER_LIMIT),
    denominator: z.number().int().min(1).max(EXACT_INTEGER_LIMIT),
  })
  .strict()
  .superRefine((value, context) => {
    const divisor = greatestCommonDivisor(value.numerator, value.denominator);
    if (value.numerator === 0 && value.denominator !== 1) {
      context.addIssue({ code: "custom", message: "zero must use denominator 1" });
    } else if (divisor !== 1) {
      context.addIssue({ code: "custom", message: "rational must be reduced" });
    }
  });

export type Rational = z.infer<typeof rationalSchema>;

export const positiveRationalSchema = rationalSchema.refine((value) => value.numerator > 0, {
  message: "rational must be positive",
});

export const exactVector3Schema = z
  .object({
    x: rationalSchema,
    y: rationalSchema,
    z: rationalSchema,
  })
  .strict();

export type ExactVector3 = z.infer<typeof exactVector3Schema>;

export const finiteVector3Schema = z
  .object({
    x: z.number().finite().min(-1_000_000).max(1_000_000),
    y: z.number().finite().min(-1_000_000).max(1_000_000),
    z: z.number().finite().min(-1_000_000).max(1_000_000),
  })
  .strict();

export type FiniteVector3 = z.infer<typeof finiteVector3Schema>;

export function rational(numerator: number, denominator = 1): Rational {
  if (!Number.isInteger(numerator) || !Number.isInteger(denominator) || denominator === 0) {
    throw new Error("rational requires integer numerator and non-zero integer denominator");
  }

  const sign = denominator < 0 ? -1 : 1;
  const normalizedNumerator = numerator * sign;
  const normalizedDenominator = denominator * sign;
  if (normalizedNumerator === 0) return rationalSchema.parse({ numerator: 0, denominator: 1 });

  const divisor = greatestCommonDivisor(normalizedNumerator, normalizedDenominator);
  return rationalSchema.parse({
    numerator: normalizedNumerator / divisor,
    denominator: normalizedDenominator / divisor,
  });
}

export function compareRationals(left: Rational, right: Rational): number {
  const difference =
    BigInt(left.numerator) * BigInt(right.denominator) -
    BigInt(right.numerator) * BigInt(left.denominator);
  const zero = BigInt(0);
  return difference < zero ? -1 : difference > zero ? 1 : 0;
}
