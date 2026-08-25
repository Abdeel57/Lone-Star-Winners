# @lsw/design-system

Tokens semánticos y preset de Tailwind de Lone Star Winners.
Propiedad de `frontend-ux` (`docs/TASK_OWNERSHIP.md`).

## Qué contiene

| Ruta                    | Qué es                                                        |
| ----------------------- | ------------------------------------------------------------- |
| `src/styles/tokens.css` | Custom properties. Única fuente de verdad del sistema visual. |
| `tailwind-preset.mjs`   | Preset que expone esos tokens como clases de Tailwind.        |
| `src/index.ts`          | Nombres de token tipados para el uso ocasional desde TS.      |

## Cómo se consume

```ts
// tailwind.config.mjs de la app
import preset from "@lsw/design-system/tailwind-preset";
export default { presets: [preset], content: [...] };
```

```tsx
// layout raíz de la app
import "@lsw/design-system/tokens.css";
```

## Reglas

1. **Ningún componente define un color, un radio o una sombra literal.**
   Si falta un token, se añade aquí; no se improvisa en el componente.
2. Los nombres son semánticos (`surface`, `danger`, `text-muted`), nunca
   literales. La marca puede cambiar sin tocar un solo componente.
3. Los colores se declaran como canales RGB separados por espacio para que
   Tailwind pueda aplicar modificadores de opacidad (`bg-brand/10`).
4. El tema oscuro **reasigna** tokens; no redefine componentes. Ningún token
   existe solo dentro de un bloque de tema.
5. Dirección de marca: americana, premium, sobria. Azul marino profundo,
   carmesí contenido, neutros cálidos. **Prohibido** todo recurso de estética
   de casino: oro brillante, degradados neón, sombras de brillo, parpadeos
   (`CLAUDE.md` §1).
6. `prefers-reduced-motion` se respeta anulando los tokens de duración en el
   origen, para que ningún componente tenga que acordarse.
