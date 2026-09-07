/**
 * Remembers the money field that was focused most recently so the floating
 * calculator can "fill in" its result there.
 */
export interface CalcTarget {
  label: string
  apply: (n: number) => void
}
let target: CalcTarget | null = null
const listeners = new Set<() => void>()

export function setCalcTarget(t: CalcTarget | null) {
  target = t
  listeners.forEach((l) => l())
}
export function getCalcTarget() {
  return target
}
export function subscribeCalcTarget(l: () => void) {
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}
