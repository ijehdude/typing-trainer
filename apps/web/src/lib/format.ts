/** Block lengths are fractions of a minute; show them as people say them. */
export function formatDuration(minutes: number): string {
  if (!Number.isInteger(minutes)) return `${Math.round(minutes * 60)}s`;
  return `${minutes} min`;
}
