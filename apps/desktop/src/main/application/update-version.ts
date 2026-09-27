interface VersionOrder {
  readonly numbers: readonly [number, number, number];
  readonly prerelease: string | undefined;
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
    prerelease: match[4]?.slice(1).split("+", 1)[0],
  };
}

const NUMERIC_PRERELEASE_IDENTIFIER = /^\d+$/;

function comparePrereleaseIdentifiers(
  candidate: string,
  running: string,
): number {
  const candidateNumeric = NUMERIC_PRERELEASE_IDENTIFIER.test(candidate);
  const runningNumeric = NUMERIC_PRERELEASE_IDENTIFIER.test(running);
  if (candidateNumeric && runningNumeric) {
    const difference = BigInt(candidate) - BigInt(running);
    return difference > 0n ? 1 : difference < 0n ? -1 : 0;
  }
  if (candidateNumeric) return -1;
  if (runningNumeric) return 1;
  return candidate === running ? 0 : candidate < running ? -1 : 1;
}

function comparePrereleases(candidate: string, running: string): number {
  const candidateIdentifiers = candidate.split(".");
  const runningIdentifiers = running.split(".");
  const sharedLength = Math.min(
    candidateIdentifiers.length,
    runningIdentifiers.length,
  );
  for (let index = 0; index < sharedLength; index += 1) {
    const difference = comparePrereleaseIdentifiers(
      candidateIdentifiers[index] ?? "",
      runningIdentifiers[index] ?? "",
    );
    if (difference !== 0) return difference;
  }
  return candidateIdentifiers.length - runningIdentifiers.length;
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
  if (
    candidateOrder.prerelease === undefined ||
    runningOrder.prerelease === undefined
  ) {
    return runningOrder.prerelease !== undefined;
  }
  return (
    comparePrereleases(candidateOrder.prerelease, runningOrder.prerelease) > 0
  );
}
