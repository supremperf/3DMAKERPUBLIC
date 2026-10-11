import { readdir, readFile, mkdir, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { zipSync } from "fflate";
const root = fileURLToPath(new URL("../", import.meta.url));
const entries = [
  "README.md",
  "LICENSE",
  ".gitignore",
  ".nvmrc",
  "package.json",
  "package-lock.json",
  "index.html",
  "electron-builder.yml",
  "tsconfig.json",
  "tsconfig.node.json",
  "tsconfig.test.json",
  "vite.config.ts",
  "vitest.config.ts",
  "electron",
  "src",
  "scripts",
  "public",
  "tests",
  "docs",
];
const files = {};
async function add(path) {
  const absolute = join(root, path);
  let children;
  try {
    children = await readdir(absolute, { withFileTypes: true });
  } catch (error) {
    if (error.code !== "ENOTDIR") throw error;
  }
  if (children) {
    for (const child of children.sort((a, b) => a.name.localeCompare(b.name))) {
      if (child.isSymbolicLink())
        throw new Error(`Lien symbolique inattendu : ${path}/${child.name}`);
      await add(join(path, child.name));
    }
  } else
    files[`3DMAKER/${relative(root, absolute).split("\\").join("/")}`] =
      new Uint8Array(await readFile(absolute));
}
for (const entry of entries) await add(entry);
const output = join(root, "release", "3DMAKER-sources.zip");
await mkdir(join(root, "release"), { recursive: true });
const archive = zipSync(files, { level: 9 });
await writeFile(output, archive);
console.log(
  `${Object.keys(files).length} fichiers sources, ${(archive.length / 1024 / 1024).toFixed(2)} Mo : release/3DMAKER-sources.zip`,
);
