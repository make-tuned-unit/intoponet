/**
 * Prominence (PRD BCN-003): diminishing returns and geographic context, not
 * linear votes. In each cell a resource earns log2(1 + independent
 * publishers), capped, so one region cannot swamp the rest; across cells the
 * contributions add, so breadth beats volume. Reported-and-hidden beacons
 * and withdrawn beacons never count.
 */
export const CELL_CAP = 4

export function cellScore(publishers: number): number {
  return Math.min(CELL_CAP, Math.log2(1 + Math.max(0, publishers)))
}

export function prominence(publishersByCell: Record<string, number>): number {
  return Object.values(publishersByCell).reduce((sum, count) => sum + cellScore(count), 0)
}

/** Publisher counts shown publicly are bucketed so tiny numbers can't single anyone out. */
export function publicCount(publishers: number): string {
  if (publishers < 3) return 'a few'
  if (publishers < 10) return 'several'
  if (publishers < 50) return 'dozens'
  return 'many'
}
