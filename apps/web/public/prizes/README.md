# Fotografías de premio

**Para poner la foto real de la camioneta, deja el archivo aquí con este
nombre:**

```text
apps/web/public/prizes/gmc-2025.jpg
```

Y después, una sola orden:

```bash
node scripts/build-prize-assets.mjs   # desde apps/web
```

Eso genera los dos recortes que usa el sitio. No hay que tocar ningún archivo
de código; sí hay que **reiniciar el servidor de desarrollo** si estaba
levantado, porque la API simulada comprueba qué archivos existen una sola vez,
al arrancar.

También valen `gmc-2025.jpeg`, `gmc-2025.png` y `gmc-2025.webp`, por si la foto
llega en otro formato. Se usa el primero que exista, en ese orden.

## Qué hay en esta carpeta

| Archivo               | Quién lo pone | Para qué                          |
| --------------------- | ------------- | --------------------------------- |
| `gmc-2025.jpg`        | tú            | la fotografía original, sin tocar |
| `gmc-2025-hero.jpg`   | el script     | recorte del hero de la portada    |
| `gmc-2025-square.jpg` | el script     | recorte cuadrado, para tarjetas   |

Los dos recortes se derivan de la original **cortando, y nada más**: no se
inventan píxeles, no se amplía y no se retoca. Si borras los recortes, el sitio
sigue funcionando: sirve la fotografía original y la recorta el navegador.

Si cambias la foto y **no** ejecutas el script, seguirán usándose los recortes
antiguos, que son de la foto anterior. Ejecútalo siempre que la sustituyas.

## Por qué hace falta un recorte y no basta con la hoja de estilos

La foto que llegó está encuadrada como ficha de concesionario: sobre el techo
de la camioneta aparecen el rótulo del establecimiento y el toldo. En la
portada eso es la marca de otra empresa encima del premio.

No se puede quitar desde el CSS. El hueco del hero es casi **cuadrado** —una
columna del 56 % del ancho por toda la altura de la pantalla en escritorio, y
una banda a todo el ancho en teléfono— y la foto es apaisada. Cuando el hueco
es más estrecho que la imagen, el recorte automático se come los **lados** y
enseña la altura entera: la parte de arriba sale siempre, se ponga lo que se
ponga en la hoja de estilos. Por eso el rótulo se corta en origen, una vez.

## Qué foto funciona mejor

El hero la pinta **a sangre**, ocupando la mitad derecha en escritorio y todo el
ancho en móvil. Encima va un degradado hacia el negro por la izquierda
(escritorio) o por abajo (móvil), donde se apoya el titular.

- **Ancho: 1920 px o más.** La foto actual tiene 960 px, y en una pantalla
  grande el hero la escala por encima de su tamaño nativo: se ve algo blanda.
  Una foto más grande es la única forma legítima de ganar nitidez; ampliarla
  por software no añade detalle, lo inventa.
- Apaisada, cuanto más ancha mejor.
- El vehículo, **ligeramente a la derecha del centro**: la parte izquierda queda
  bajo el degradado.
- Aire por arriba sobre el techo, y nada escrito ahí: rótulos, carteles y
  toldos acaban en el encuadre.
- Nada importante en el borde inferior ni en las esquinas: el recorte cambia con
  el tamaño de pantalla.
- Fondo oscuro o de estudio. Una foto sobre fondo blanco recortado se verá como
  un rectángulo blanco dentro de una página negra.

Si el encuadre de una foto nueva no se parece al de la actual, hay que volver a
medir las dos ventanas de recorte, que están al principio de
`scripts/build-prize-assets.mjs` con su medida y su motivo.

## Lo que esta carpeta **no** decide

Ni qué es el premio, ni cuánto vale, ni las condiciones de la promoción. Todo
eso son datos de la promoción y de las Reglas Oficiales. Esta carpeta solo
guarda la imagen.
