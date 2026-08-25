// ---------------------------------------------------------------------------
// Lone Star Winners - ESLint para tests/security.
//
// Extiende la configuracion raiz en vez de duplicarla: la raiz limita su bloque
// type-aware a `apps/**` y `packages/**`, asi que sin este fichero los tests de
// invariante quedarian sin lint. Duplicar las reglas seria crear una segunda
// fuente de verdad, que es justo lo que este agente debe impedir.
// ---------------------------------------------------------------------------

import tseslint from "typescript-eslint";
import root from "../../eslint.config.mjs";

export default tseslint.config(
  ...root,
  {
    files: ["src/**/*.ts", "*.config.ts"],
    extends: [...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-floating-promises": "error",
      "no-restricted-properties": [
        "error",
        {
          object: "Math",
          property: "random",
          message: "DEC-017: ni siquiera en tests. Usa node:crypto.",
        },
      ],
    },
  },

  // -------------------------------------------------------------------------
  // Excepciones acotadas: fichero concreto, regla concreta.
  //
  // Ninguna desactiva un gate. Desactivan un AVISO sobre el mecanismo con el
  // que los gates estan escritos, y solo donde ese mecanismo es el proposito
  // del fichero. Se declaran aqui y no con comentarios `eslint-disable`
  // sueltos, porque un comentario suelto es exactamente lo que el test de
  // aleatoriedad persigue en los paquetes criticos: conviene que este paquete
  // no predique una cosa y practique otra.
  //
  // Si manana aparece otro fichero que lea del disco o construya expresiones
  // regulares, NO queda cubierto. Habra que anadirlo aqui a proposito, que es
  // justo el momento en que alguien debe mirarlo.
  // -------------------------------------------------------------------------
  {
    // El recorredor del repositorio existe para leer rutas calculadas: es un
    // auditor que mira ficheros que no conoce de antemano. La regla avisa de
    // path traversal con entrada de usuario, y aqui no hay usuario: las rutas
    // salen de `readdirSync` sobre el arbol del propio repositorio, dentro de
    // un proceso de test que ya tiene permiso de lectura sobre el.
    files: ["src/helpers/repo.ts"],
    rules: { "security/detect-non-literal-fs-filename": "off" },
  },
  {
    // Los escaneres de invariante construyen sus patrones concatenando
    // fragmentos para no detectarse a si mismos (ver la cabecera de cada
    // fichero). Los argumentos son constantes de ambito de modulo formadas por
    // literales de cadena: no hay entrada externa, luego no hay ReDoS con dato
    // ajeno ni patron elegido por un tercero.
    files: [
      "src/invariants/internal-draw-disabled.test.ts",
      "src/invariants/weak-randomness.test.ts",
    ],
    rules: { "security/detect-non-literal-regexp": "off" },
  },
);
