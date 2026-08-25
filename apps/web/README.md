# apps/web

Storefront, portal del participante y shell de admin de Lone Star Winners.
Next.js (App Router), `output: "standalone"` (DEC-004). Propiedad de
`frontend-ux` (`docs/TASK_OWNERSHIP.md`).

## Estado: hito FE-M0 (fundaciones)

Lo que hay es la base, no el producto:

- enrutado i18n con prefijo en **ambos** idiomas (`/en`, `/es`) y middleware de
  negociación (DEC-021);
- diccionarios `messages/en-US.json` y `messages/es-US.json`, con test de
  paridad de claves;
- design system (`@lsw/design-system`) y primitivas (`@lsw/ui`);
- capa de API tipada, sustituible, servida por MSW mientras no exista backend;
- portada mínima que demuestra que todo lo anterior funciona junto.

**No** hay tienda, carrito, cuenta, AMOE ni Official Rules. Llegan en hitos
posteriores, cuando exista contrato de API.

## Comandos

```bash
pnpm --filter @lsw/web dev        # http://localhost:3000/en  y  /es
pnpm --filter @lsw/web build
pnpm --filter @lsw/web typecheck
pnpm --filter @lsw/web lint
pnpm --filter @lsw/web test
```

## API simulada

`apps/api` todavía no existe y `docs/API_CONTRACT.md` está vacío. En desarrollo,
`src/instrumentation.ts` arranca MSW dentro del proceso de servidor de Next, de
modo que los Server Components hacen `fetch` real contra endpoints simulados.

- Se apaga con `WEB_ENABLE_API_MOCKS=false`.
- **Nunca** se carga con `NODE_ENV=production`.
- Los handlers **no son un contrato**: lo acordado se escribe en
  `docs/API_CONTRACT.md`.

## Reglas de este workspace

1. **Ningún texto visible fuera de los diccionarios.** Tres redes lo vigilan:
   el tipado de claves (`src/global.d.ts`), el test de paridad
   (`src/test/i18n-parity.test.ts`) y el escáner heurístico
   (`src/test/no-hardcoded-copy.test.ts`).
2. **Ninguna regla legal en el código.** Ni edades, ni estados, ni ratios, ni
   plazos. Todo llega de la API o de configuración (CLAUDE.md #2 y #14).
3. **Ninguna aritmética de entries en el frontend.** Las cifras las produce el
   backend. Aquí solo se formatean (`src/i18n/formatters.ts`).
4. **Feature flags leídos en servidor y apagados por defecto** (DEC-013,
   `src/lib/flags-server.ts`).
5. **Navegación siempre por `@/i18n/navigation`**, nunca por `next/link`: el
   `Link` de Next pierde el prefijo de idioma. Hay una regla de ESLint que lo
   impide.
6. **Mobile-first** y foco visible en todo lo interactivo.
