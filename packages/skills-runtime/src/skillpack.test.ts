import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  canonicalizeJson,
  parseSkillpack,
  relateSkillpack,
  serializeSkillpack,
  skillpackDocumentDigest,
  SKILLPACK_MAX_BYTES,
  type SkillpackCodec,
  type SkillpackPackage,
} from "./skillpack.js";

const codec: SkillpackCodec = {
  sha256Hex: (bytes) => createHash("sha256").update(bytes).digest("hex"),
};

const text = (value: string) => new TextEncoder().encode(value);
const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

const pkg: SkillpackPackage = {
  compatibility: { dialectId: "skills-1.5.23", harnessIds: ["claude-code", "codex"] },
  description: "Starter recipes for this repository.",
  id: "acme.starter",
  release: 3,
  skills: ["find-skills", "Repo-Conventions"],
  source: { owner: "acme", repository: "skills", type: "github" },
  title: "Acme starter",
};

function serialized(input: SkillpackPackage = pkg) {
  const result = serializeSkillpack(input, codec);
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

describe("RFC 8785 canonicalization", () => {
  it("matches the JCS specification sample", () => {
    // RFC 8785 Section 3.2.3 sample input, with the expected output from the RFC.
    const input = {
      numbers: [333333333.3333333, 1e30, 4.5, 2e-3, 0.000000000000000000000000001],
      string: "\u20ac$\u000f\nA'B\"\\\\\"/",
      literals: [null, true, false],
    };
    expect(canonicalizeJson(input)).toBe(
      '{"literals":[null,true,false],"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27],"string":"€$\\u000f\\nA\'B\\"\\\\\\\\\\"/"}',
    );
  });

  it("sorts members by UTF-16 code units and drops undefined", () => {
    expect(
      canonicalizeJson({ "\u20ac": 1, "\ud800\udc00": 2, "\uff5e": 3, b: 4, a: undefined, "1": 5 }),
    ).toBe('{"1":5,"b":4,"€":1,"𐀀":2,"～":3}');
    expect(canonicalizeJson([1, "two", { z: null, y: [] }])).toBe('[1,"two",{"y":[],"z":null}]');
    expect(() => canonicalizeJson({ bad: Number.NaN })).toThrow(/Non-finite/);
    expect(() => canonicalizeJson(() => undefined)).toThrow(/function/);
  });
});

describe(".skillpack v1 codec (#203)", () => {
  it("serializes canonical bytes whose digest binds every semantic field", () => {
    const { bytes, document } = serialized();
    const textual = decode(bytes);
    expect(textual.startsWith('{"documentDigest":"sha256:')).toBe(true);
    expect(textual).toContain('"kind":"skillpack"');
    expect(textual).toContain('"schemaVersion":1');
    expect(textual).not.toMatch(/[\n\r\t]/);
    expect(textual).not.toContain('": ');
    expect(document.documentDigest).toBe(skillpackDocumentDigest(pkg, codec));

    const reordered = serialized({
      ...pkg,
      compatibility: { harnessIds: ["claude-code", "codex"], dialectId: "skills-1.5.23" },
      title: pkg.title,
    });
    expect(decode(reordered.bytes)).toBe(textual);

    const edited = serialized({ ...pkg, description: `${pkg.description} ` });
    expect(edited.document.documentDigest).not.toBe(document.documentDigest);
  });

  it("round-trips canonical bytes and rejects any non-canonical presentation", () => {
    const { bytes, document } = serialized();
    expect(parseSkillpack(bytes, codec)).toEqual({ ok: true, value: document });

    const pretty = text(JSON.stringify(document, null, 2));
    expect(parseSkillpack(pretty, codec)).toMatchObject({
      error: { code: "non_canonical" },
      ok: false,
    });
    const reorderedKeys = text(
      JSON.stringify({
        kind: document.kind,
        documentDigest: document.documentDigest,
        package: document.package,
        schemaVersion: document.schemaVersion,
      }),
    );
    expect(parseSkillpack(reorderedKeys, codec)).toMatchObject({
      error: { code: "non_canonical" },
      ok: false,
    });
  });

  it("fails closed on encoding, JSON, schema and digest faults", () => {
    const { bytes, document } = serialized();
    const canonical = decode(bytes);
    const result = (input: Uint8Array) => {
      const parsed = parseSkillpack(input, codec);
      return parsed.ok ? "ok" : `${parsed.error.code}:${parsed.error.path ?? ""}`;
    };

    expect(result(new Uint8Array(SKILLPACK_MAX_BYTES + 1))).toBe("invalid_encoding:");
    expect(result(new Uint8Array([0xef, 0xbb, 0xbf, ...bytes]))).toBe("invalid_encoding:");
    expect(result(new Uint8Array([0xff, 0xfe]))).toBe("invalid_encoding:");
    expect(result(text('{"kind":'))).toBe("invalid_json:");
    expect(result(text(`${canonical} `))).toBe("non_canonical:");
    expect(result(text('{"kind":"skillpack","kind":"skillpack"}'))).toBe("invalid_json:");
    expect(result(text('{"__proto__":{}}'))).toBe("invalid_json:");
    expect(result(text("[]"))).toBe("invalid_document:");
    expect(result(text('{"kind":"collection"}'))).toBe("unsupported_schema:kind");
    expect(result(text('{"kind":"skillpack","schemaVersion":2}'))).toBe(
      "unsupported_schema:schemaVersion",
    );
    expect(
      parseSkillpack(text('{"kind":"skillpack","schemaVersion":2}'), codec),
    ).toMatchObject({ error: { message: expect.stringContaining("newer") } });

    const tampered = canonical.replace(pkg.title, "Evil starter");
    expect(result(text(tampered))).toBe("digest_mismatch:documentDigest");

    const withExtra = { ...document, package: { ...document.package, argv: ["rm"] } };
    expect(result(text(canonicalizeJson(withExtra)))).toBe("invalid_document:package");
    const withTarget = { ...document, target: "laptop" };
    expect(result(text(canonicalizeJson(withTarget)))).toBe("invalid_document:");
  });

  it("enforces bounded, unique, registry-ordered package content", () => {
    const code = (input: SkillpackPackage) => {
      const result = serializeSkillpack(input, codec);
      return result.ok ? "ok" : `${result.error.code}:${result.error.path ?? ""}`;
    };
    expect(code({ ...pkg, skills: ["dup", "DUP"] })).toBe("invalid_document:skills");
    expect(code({ ...pkg, skills: ["same", "same"] })).toBe("invalid_document:skills");
    expect(code({ ...pkg, skills: [] })).toBe("invalid_document:skills");
    expect(code({ ...pkg, skills: Array.from({ length: 129 }, (_, index) => `s${index}`) })).toBe(
      "invalid_document:skills",
    );
    expect(code({ ...pkg, compatibility: { ...pkg.compatibility, harnessIds: ["codex", "claude-code"] } })).toBe(
      "invalid_document:compatibility.harnessIds",
    );
    expect(code({ ...pkg, compatibility: { ...pkg.compatibility, harnessIds: ["Codex"] } })).toBe(
      "invalid_document:compatibility.harnessIds",
    );
    expect(code({ ...pkg, release: 0 })).toBe("invalid_document:release");
    expect(code({ ...pkg, release: 1.5 })).toBe("invalid_document:release");
    expect(code({ ...pkg, release: Number.MAX_SAFE_INTEGER + 2 })).toBe("invalid_document:release");
    expect(code({ ...pkg, id: "Acme" })).toBe("invalid_document:id");
    expect(code({ ...pkg, title: "tab\there" })).toBe("invalid_document:title");
    expect(code({ ...pkg, source: { owner: "acme", repository: "skills", revision: "abc", type: "github" } })).toBe(
      "invalid_document:source.revision",
    );
    expect(code({ ...pkg, description: "x".repeat(2_049) })).toBe("invalid_document:description");
    expect(code({ ...pkg, skills: ["a".repeat(256)], description: "x".repeat(2_048) })).toBe("ok");
  });

  it("relates imports as identical, conflict, upgrade, downgrade or new", () => {
    const { document } = serialized();
    const { document: laterRelease } = serialized({ ...pkg, release: 4 });
    const { document: sameReleaseDifferentBytes } = serialized({ ...pkg, title: "Other" });
    const { document: otherPackage } = serialized({ ...pkg, id: "other" });

    expect(relateSkillpack(document, undefined)).toEqual({ kind: "new" });
    expect(relateSkillpack(document, otherPackage)).toEqual({ kind: "new" });
    expect(relateSkillpack(document, document)).toEqual({ kind: "identical" });
    expect(relateSkillpack(sameReleaseDifferentBytes, document)).toEqual({ kind: "conflict" });
    expect(relateSkillpack(laterRelease, document)).toEqual({
      fromRelease: 3,
      kind: "upgrade",
      toRelease: 4,
    });
    expect(relateSkillpack(document, laterRelease)).toEqual({
      fromRelease: 4,
      kind: "downgrade",
      toRelease: 3,
    });
  });
});
