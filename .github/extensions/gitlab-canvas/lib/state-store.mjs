import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const languages = new Set(["auto", "ja", "en"]);

function missingFile(error) {
  return error && error.code === "ENOENT";
}

function parseJson(text, label) {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`Could not read ${label}: ${error.message}`, { cause: error });
  }
}

async function writeJsonAtomic(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${randomBytes(8).toString("hex")}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
    });
    await rename(temporary, filePath);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

export function createStateStore({ workspacePath, copilotHome } = {}) {
  const panelsDirectory = workspacePath
    ? path.join(workspacePath, ".copilot", "gitlab-canvas", "panels")
    : null;
  const home =
    copilotHome ??
    process.env.COPILOT_HOME ??
    path.join(os.homedir(), ".copilot");
  const preferencesPath = path.join(
    home,
    "extensions",
    "gitlab-canvas",
    "artifacts",
    "preferences.json",
  );

  function panelPath(instanceId) {
    const key = createHash("sha256").update(String(instanceId)).digest("hex");
    return panelsDirectory ? path.join(panelsDirectory, `${key}.json`) : null;
  }

  return {
    async loadPanelState(instanceId) {
      const filePath = panelPath(instanceId);
      if (!filePath) {
        return null;
      }
      try {
        return parseJson(await readFile(filePath, "utf8"), "panel state");
      } catch (error) {
        if (missingFile(error)) {
          return null;
        }
        throw error;
      }
    },
    async savePanelState(instanceId, state) {
      const filePath = panelPath(instanceId);
      if (!filePath) {
        return false;
      }
      await writeJsonAtomic(filePath, state);
      return true;
    },
    async loadPreferences() {
      try {
        const preferences = parseJson(
          await readFile(preferencesPath, "utf8"),
          "user preferences",
        );
        const language = languages.has(preferences?.language)
          ? preferences.language
          : "auto";
        return { language };
      } catch (error) {
        if (missingFile(error)) {
          return { language: "auto" };
        }
        throw error;
      }
    },
    async savePreferences(preferences) {
      const language = preferences?.language;
      if (!languages.has(language)) {
        throw new TypeError("Language preference must be auto, ja, or en.");
      }
      const value = { language };
      await writeJsonAtomic(preferencesPath, value);
      return value;
    },
  };
}
