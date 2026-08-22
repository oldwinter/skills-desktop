interface VersionOrder {
  readonly numbers: readonly [number, number, number];
  readonly prerelease: boolean;
}

function versionOrder(value: string): VersionOrder | undefined {
  const match = /^(\d+)\.(\d+)\.(\d+)(-.+)?$/.exec(value);
  if (match === null) return undefined;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  if (![major, minor, patch].every(Number.isSafeInteger)) return undefined;
  return {
    numbers: [major, minor, patch],
    prerelease: match[4] !== undefined,
  };
}

export function isStrictlyNewerStableVersion(
  candidate: string,
  running: string,
) {
  const candidateOrder = versionOrder(candidate);
  const runningOrder = versionOrder(running);
  if (candidateOrder === undefined || runningOrder === undefined) return false;
  const differences = candidateOrder.numbers.map(
    (value, index) => value - (runningOrder.numbers[index] ?? Number.NaN),
  );
  for (const difference of differences) {
    if (difference !== 0) return difference > 0;
  }
  return runningOrder.prerelease;
}
