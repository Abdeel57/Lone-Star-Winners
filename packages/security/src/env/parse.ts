/**
 * Lector minimo de ficheros de entorno.
 *
 * Existe para que el gate de CI pueda comparar `.env.example` contra el
 * registro sin arrastrar una dependencia externa a un paquete de seguridad.
 * Cada dependencia de este paquete es superficie de cadena de suministro en el
 * modulo que decide quien puede hacer que.
 *
 * NO expande variables, NO ejecuta nada y NO lee del disco: recibe texto.
 */

export interface ParsedEnvEntry {
  readonly name: string;
  readonly value: string;
  /** Linea 1-based, para poder senalar el sitio exacto en CI. */
  readonly line: number;
}

const NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function parseEnvFile(contents: string): readonly ParsedEnvEntry[] {
  const entries: ParsedEnvEntry[] = [];
  const lines = contents.split("\n");

  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index] ?? "";
    const trimmed = raw.trim();
    if (trimmed === "" || trimmed.startsWith("#")) {
      continue;
    }

    const separator = trimmed.indexOf("=");
    if (separator <= 0) {
      continue;
    }

    const name = trimmed.slice(0, separator).trim();
    if (!NAME_PATTERN.test(name)) {
      continue;
    }

    let value = trimmed.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1);
    }

    entries.push({ name, value, line: index + 1 });
  }

  return entries;
}

export function toEnvRecord(entries: readonly ParsedEnvEntry[]): Readonly<Record<string, string>> {
  const record: Record<string, string> = {};
  for (const entry of entries) {
    record[entry.name] = entry.value;
  }
  return record;
}
