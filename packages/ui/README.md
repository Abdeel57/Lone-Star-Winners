# @lsw/ui

Primitivas de interfaz de Lone Star Winners.
Propiedad de `frontend-ux` (`docs/TASK_OWNERSHIP.md`).

## Qué hay en FE-M0

`Button`, `Input`, `FormField`, `Card` (+ `CardTitle`, `CardHeader`, `CardBody`,
`CardFooter`), `Alert`, `Skeleton` (+ `SkeletonText`), `EmptyState`,
`ErrorState`, `VisuallyHidden`.

El catálogo completo (Modal, Drawer, Tabs, DataTable, Countdown, ProductCard,
EntrySummaryCard…) llega cuando haya pantallas que lo necesiten. Una primitiva
sin consumidor es una suposición, no un componente.

## Las tres reglas del paquete

1. **Ningún componente contiene texto visible.** Todo lo que se lee llega por
   props ya traducido desde `apps/web` (DEC-021, DEC-022). Esto incluye los
   nombres accesibles: si un botón de solo icono no recibe su etiqueta, el botón
   no se renderiza. Es deliberado — un control sin nombre accesible es
   inservible con lector de pantalla, y este paquete no puede inventarse la
   traducción.
2. **Ningún componente contiene reglas legales ni de negocio.** Ni edades, ni
   estados, ni ratios de entries, ni plazos (CLAUDE.md #2 y #14).
3. **Ningún componente define color, radio o sombra literales.** Todo sale de
   `@lsw/design-system`.

## Accesibilidad

- `FormField` cablea de una vez `label`/`for`, `aria-describedby`,
  `aria-invalid` y el anuncio del error, que son las cuatro conexiones que se
  olvidan por separado.
- `Alert` elige `role` según el tono: `warning`/`danger` interrumpen (`alert`),
  `info`/`success` esperan turno (`status`).
- `EmptyState` y `ErrorState` son componentes distintos a propósito: «todavía no
  tienes participaciones» y «no hemos podido cargar tus participaciones» no son
  el mismo mensaje, y confundirlos cuesta confianza.
- `Skeleton` está fuera del árbol de accesibilidad; el anuncio de carga es del
  contenedor.
- Un único anillo de foco (`FOCUS_VISIBLE_CLASSES`) para que nada se quede sin
  foco visible.

## Tests

```bash
pnpm --filter @lsw/ui test
```
