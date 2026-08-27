/** Format a number as Philippine pesos. */
export function formatPeso(amount: number): string {
  return new Intl.NumberFormat('en-PH', {
    style: 'currency',
    currency: 'PHP',
  }).format(amount)
}

/** Format a number as whole Philippine pesos (no centavos). */
export function formatPesoWhole(amount: number): string {
  return new Intl.NumberFormat('en-PH', {
    style: 'currency',
    currency: 'PHP',
    maximumFractionDigits: 0,
  }).format(amount)
}

/** Coerce freeform staff input ("1500", "1,500.50") into a number. */
export function pesosToNumber(input: string): number {
  const cleaned = input.replace(/[^\d.-]/g, '')
  const value = Number(cleaned)
  return Number.isFinite(value) ? value : 0
}
