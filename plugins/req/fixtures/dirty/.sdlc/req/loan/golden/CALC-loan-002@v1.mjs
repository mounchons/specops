// answer key for CALC-loan-001@v1 — 30% of the fee, rounded up to the hundred.
export function compute(input) {
  return Math.ceil((input.fee * 0.3) / 100) * 100;
}
