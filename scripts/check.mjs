import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
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

const jsonFiles = ["package.json", "plugin.json"];
for (const file of jsonFiles) {
  const path = resolve(root, file);
  try {
    JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`Invalid JSON in ${relative(root, path)}: ${error.message}`, {
      cause: error,
    });
  }
}

process.stdout.write(
  `Checked ${sourceFiles.length} JavaScript files and ${jsonFiles.length} JSON files.\n`,
);
