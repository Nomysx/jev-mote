// Version comparison for Ollama versions such as "0.40.14" or "0.40.4-rc0".

export function parseVersion(v: string): number[] {
  const core = v.trim().replace(/^v/i, '').split(/[-+ ]/)[0];
  return core.split('.').map((p) => {
    const n = parseInt(p, 10);
    return Number.isFinite(n) ? n : 0;
  });
}

/** Negative if a < b, 0 if equal, positive if a > b. Pre-release suffixes count as the release. */
export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  for (let i = 0; i < Math.max(pa.length, pb.length, 3); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

export function maxVersion(...versions: (string | undefined)[]): string {
  return versions.filter((v): v is string => !!v).reduce((m, v) => (compareVersions(v, m) > 0 ? v : m), '0.0.0');
}
