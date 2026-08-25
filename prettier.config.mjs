// ---------------------------------------------------------------------------
// Lone Star Winners - Prettier (zona neutral raiz, DEC-024).
//
// `endOfLine: "lf"` no es cosmetico: DEC-016 exige que los artefactos de export
// sean byte a byte reproducibles (UTF-8 sin BOM, saltos LF). Un CRLF filtrado
// desde una maquina Windows cambiaria el hash de un fixture o de una migracion.
// ---------------------------------------------------------------------------

/** @type {import("prettier").Config} */
const config = {
  printWidth: 100,
  tabWidth: 2,
  useTabs: false,
  semi: true,
  singleQuote: false,
  quoteProps: "as-needed",
  trailingComma: "all",
  bracketSpacing: true,
  arrowParens: "always",
  endOfLine: "lf",
  overrides: [
    {
      files: ["*.md", "*.mdx"],
      options: {
        proseWrap: "preserve",
        printWidth: 80,
      },
    },
    {
      files: ["*.json", "*.jsonc", "*.yml", "*.yaml"],
      options: {
        printWidth: 100,
      },
    },
  ],
};

export default config;
