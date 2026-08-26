# Fotografías de premio

**Para poner la foto real de la camioneta, deja el archivo aquí con este
nombre:**

```text
apps/web/public/prizes/gmc-2025.jpg
```

Y ya está. No hay que tocar ningún archivo de código, ni reiniciar nada más que
el servidor de desarrollo si estuviera parado: la API simulada comprueba si el
archivo existe y, si está, lo sirve como imagen del premio de la promoción
`gmc-2025`. Si no está, se dibuja la ilustración de estudio que hay en
`src/mocks/fixtures/media.ts`.

También valen `gmc-2025.jpeg`, `gmc-2025.png` y `gmc-2025.webp`, por si la foto
llega en otro formato. Se usa el primero que exista, en ese orden.

## Qué foto funciona mejor

El hero la pinta **a sangre**, apaisada, ocupando la mitad derecha en escritorio
y todo el ancho en móvil. Encima va un degradado hacia el negro por la izquierda
(escritorio) o por abajo (móvil), donde se apoya el titular.

- Apaisada, cuanto más ancha mejor (16:9 o más). Mínimo recomendado: 1600 px de
  ancho.
- El vehículo, **ligeramente a la derecha del centro**: la parte izquierda queda
  bajo el degradado.
- Nada importante en el borde inferior ni en las esquinas: el recorte cambia con
  el tamaño de pantalla.
- Fondo oscuro o de estudio. Una foto sobre fondo blanco recortado se verá como
  un rectángulo blanco dentro de una página negra.

## Lo que esta carpeta **no** decide

Ni qué es el premio, ni cuánto vale, ni las condiciones de la promoción. Todo
eso son datos de la promoción y de las Reglas Oficiales. Esta carpeta solo
guarda la imagen.
