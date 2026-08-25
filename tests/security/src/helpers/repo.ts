/**
 * Utilidades para recorrer el repositorio desde los tests de invariante.
 *
 * Estos tests miran el repositorio como lo miraria un auditor: leyendo lo que
 * hay escrito, no lo que un modulo exporta. Una invariante que solo se
 * comprueba sobre el codigo que la implementa no detecta al que la ignora.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";

const IGNORED_DIRECTORIES = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "out",
  ".next",
  ".turbo",
  "coverage",
  "playwright-report",
  "test-results",
]);

const TEXT_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".mjs",
  ".cjs",
  ".json",
  ".jsonc",
  ".yml",
  ".yaml",
  ".toml",
  ".sql",
  ".md",
  ".env",
  ".example",
  ".sh",
]);

let cachedRoot: string | null = null;

/** Raiz del monorepo: el directorio que contiene `pnpm-workspace.yaml`. */
export function repoRoot(): string {
  if (cachedRoot !== null) {
    return cachedRoot;
  }
  let current = resolve(import.meta.dirname);
  for (let depth = 0; depth < 10; depth += 1) {
    try {
      statSync(join(current, "pnpm-workspace.yaml"));
      cachedRoot = current;
      return current;
    } catch {
      const parent = resolve(current, "..");
      if (parent === current) {
        break;
      }
      current = parent;
    }
  }
  throw new Error("No se encuentra la raiz del monorepo (pnpm-workspace.yaml).");
}

export interface RepoFile {
  /** Ruta relativa a la raiz, siempre con separador '/'. */
  readonly path: string;
  readonly absolutePath: string;
}

function isTextFile(name: string): boolean {
  if (name === ".env.example" || name === ".gitleaks.toml" || name === ".nvmrc") {
    return true;
  }
  const dot = name.lastIndexOf(".");
  return dot > 0 && TEXT_EXTENSIONS.has(name.slice(dot));
}

/** Todos los ficheros de texto del repositorio, saltando artefactos. */
export function listRepoTextFiles(startAt = repoRoot()): readonly RepoFile[] {
  const root = repoRoot();
  const files: RepoFile[] = [];

  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!IGNORED_DIRECTORIES.has(entry.name)) {
          walk(join(directory, entry.name));
        }
        continue;
      }
      if (!entry.isFile() || !isTextFile(entry.name)) {
        continue;
      }
      const absolutePath = join(directory, entry.name);
      files.push({
        absolutePath,
        path: relative(root, absolutePath).split(sep).join("/"),
      });
    }
  };

  walk(startAt);
  return files;
}

export function readRepoFile(relativePath: string): string {
  return readFileSync(join(repoRoot(), relativePath), "utf8");
}

export function repoPathExists(relativePath: string): boolean {
  try {
    statSync(join(repoRoot(), relativePath));
    return true;
  } catch {
    return false;
  }
}
