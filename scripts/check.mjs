import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { extname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const sourceRoots = [
  resolve(root, ".github", "extensions", "gitlab-canvas"),
  resolve(root, "test"),
  resolve(root, "scripts"),
];

function findSourceFiles(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...findSourceFiles(path));
    } else if (entry.isFile() && [".js", ".mjs"].includes(extname(path))) {
      files.push(path);
    }
  }
  return files;
}

const sourceFiles = sourceRoots.flatMap(findSourceFiles);
for (const file of sourceFiles) {
  execFileSync(process.execPath, ["--check", file], { stdio: "inherit" });
}

const jsonFiles = [
  "package.json",
  "plugin.json",
  ".github/plugin/marketplace.json",
];
const parsedJson = new Map();
for (const file of jsonFiles) {
  const path = resolve(root, file);
  try {
    parsedJson.set(file, JSON.parse(readFileSync(path, "utf8")));
  } catch (error) {
    throw new Error(`Invalid JSON in ${relative(root, path)}: ${error.message}`, {
      cause: error,
    });
  }
}

const pluginManifest = parsedJson.get("plugin.json");
const marketplace = parsedJson.get(".github/plugin/marketplace.json");

if (!pluginManifest?.name || !pluginManifest?.version) {
  throw new Error("plugin.json must define name and version.");
}
if (!marketplace?.name || !marketplace?.owner?.name || !Array.isArray(marketplace?.plugins) || marketplace.plugins.length === 0) {
  throw new Error(".github/plugin/marketplace.json must define name, owner.name, and a non-empty plugins array.");
}

for (const entry of marketplace.plugins) {
  if (!entry?.name || !entry?.source) {
    throw new Error("Each marketplace plugin entry must define name and source.");
  }
  const sourcePath = resolve(root, entry.source);
  if (!existsSync(sourcePath)) {
    throw new Error(`Marketplace plugin source does not exist: ${entry.source}`);
  }
  if (entry.name === pluginManifest.name && entry.version && entry.version !== pluginManifest.version) {
    throw new Error(`Marketplace version (${entry.version}) does not match plugin.json (${pluginManifest.version}).`);
  }
}

if (!marketplace.plugins.some((entry) => entry.name === pluginManifest.name)) {
  throw new Error(`Marketplace does not list plugin "${pluginManifest.name}".`);
}

process.stdout.write(
  `Checked ${sourceFiles.length} JavaScript files and ${jsonFiles.length} JSON files.\n`,
);
