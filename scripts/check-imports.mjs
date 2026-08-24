import { readdir, readFile } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { parse } from "@babel/parser";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoots = [
  resolve(repositoryRoot, "apps/desktop/src"),
  resolve(repositoryRoot, "packages/remote-bootstrap/src"),
  resolve(repositoryRoot, "packages/skills-runtime/src"),
];

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => {
      const path = resolve(directory, entry.name);
      return entry.isDirectory() ? sourceFiles(path) : [path];
    }),
  );
  return nested
    .flat()
    .filter((path) => [".ts", ".tsx"].includes(extname(path)) && !path.includes(".test."));
}

function isRuntimePrimitive(specifier) {
  return specifier === "electron" || specifier.startsWith("node:");
}

function moduleSpecifiers(source, path) {
  const ast = parse(source, {
    plugins: ["typescript", ...(path.endsWith(".tsx") ? ["jsx"] : [])],
    sourceType: "module",
  });
  const specifiers = [];
  const visit = (node) => {
    if (node === null || typeof node !== "object") return;
    if (
      ["ImportDeclaration", "ExportAllDeclaration", "ExportNamedDeclaration"].includes(node.type) &&
      node.source?.type === "StringLiteral"
    ) {
      specifiers.push(node.source.value);
    }
    if (
      node.type === "CallExpression" &&
      (node.callee?.type === "Import" ||
        (node.callee?.type === "Identifier" && node.callee.name === "require")) &&
      node.arguments?.[0]?.type === "StringLiteral"
    ) {
      specifiers.push(node.arguments[0].value);
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(visit);
      else visit(value);
    }
  };
  visit(ast);
  return specifiers;
}

function normalizePath(path) {
  return path.replaceAll("\\", "/");
}

export function violationsFor(path, specifier) {
  const violations = [];
  const normalizedPath = normalizePath(path);
  const resolvedImport = specifier.startsWith(".")
    ? normalizePath(resolve(dirname(normalizedPath), specifier))
    : undefined;

  if (
    normalizedPath.includes("/packages/skills-runtime/") &&
    isRuntimePrimitive(specifier)
  ) {
    violations.push("skills-runtime must stay runtime-neutral");
  }
  if (
    normalizedPath.includes("/packages/remote-bootstrap/") &&
    !specifier.startsWith(".") &&
    specifier !== "@skills-desktop/skills-runtime"
  ) {
    violations.push("remote-bootstrap may depend only on skills-runtime");
  }
  if (
    normalizedPath.includes("/apps/desktop/src/contracts/") &&
    isRuntimePrimitive(specifier)
  ) {
    violations.push("public contracts must stay runtime-neutral");
  }
  if (
    normalizedPath.includes("/apps/desktop/src/renderer/") ||
    normalizedPath.includes("/apps/desktop/src/review-renderer/")
  ) {
    if (
      isRuntimePrimitive(specifier) ||
      specifier === "@skills-desktop/skills-runtime" ||
      resolvedImport?.includes("/apps/desktop/src/main/") ||
      resolvedImport?.includes("/apps/desktop/src/preload/")
    ) {
      violations.push("renderers may depend only on public contracts and renderer code");
    }
  }
  if (normalizedPath.includes("/apps/desktop/src/preload/")) {
    const isContract = resolvedImport?.includes("/apps/desktop/src/contracts/") ?? false;
    if (specifier !== "electron" && !isContract) {
      violations.push("preloads may depend only on Electron and public contracts");
    }
  }
  return violations;
}

async function main() {
  const files = (await Promise.all(sourceRoots.map(sourceFiles))).flat();
  const violations = [];
  for (const path of files) {
    for (const specifier of moduleSpecifiers(await readFile(path, "utf8"), path)) {
      for (const reason of violationsFor(path, specifier)) {
        violations.push(
          `${path.slice(repositoryRoot.length + 1)} -> ${specifier}: ${reason}`,
        );
      }
    }
  }

  if (violations.length > 0) {
    throw new Error(`Import boundary violations:\n${violations.join("\n")}`);
  }

  console.log(`Import boundaries verified across ${files.length} production modules.`);
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await main();
}
