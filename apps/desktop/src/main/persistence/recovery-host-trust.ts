import type { HostPublicKey, HostTrustStore } from "../ssh/openssh-target.js";
import type { RecoveryRecords } from "./recovery-records.js";

export function createRecoveryHostTrustStore(options: {
  readonly path: string;
  readonly records: RecoveryRecords;
}): HostTrustStore {
  let loaded: Promise<Map<string, HostPublicKey>> | undefined;
  const load = () => {
    loaded ??= options.records.restore().then((restored) => {
      if (restored.failures.some(({ store }) => store === "hostTrustRecords")) {
        throw new Error("Host Trust Records are unavailable.");
      }
      return new Map(
        restored.hostTrustRecords.map(({ algorithm, identity, key }) => [
          identity,
          { algorithm, key },
        ]),
      );
    });
    return loaded;
  };

  return {
    path: options.path,
    async lookup(identity) {
      return (await load()).get(identity) ?? null;
    },
    async replace(identity, key) {
      const records = await load();
      const committed = await options.records.commit({
        record: { identity, ...key },
        type: "host-trust.replace",
      });
      if (!committed.ok)
        throw new Error("Host Trust Record could not be saved.");
      records.set(identity, { ...key });
    },
  };
}
