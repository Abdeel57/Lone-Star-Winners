"use client";

import { Checkbox, FOCUS_VISIBLE_CLASSES, FormField, cn, useFormField } from "@lsw/ui";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";

import { ADMIN_MEDIA_CONTENT_TYPES, ADMIN_MEDIA_MAX_BYTES } from "@/lib/api";
import { safeImageUrl } from "@/lib/media-url";

/**
 * Foto de un producto o de una variante, elegida DESDE EL DISPOSITIVO (§14,
 * DEC-056).
 *
 * POR QUE NO ES UN CAMPO DE URL
 * -----------------------------
 * Quien edita el catalogo lo hace desde el telefono, y lo que tiene es la foto.
 * Un campo de URL le pedia dos cosas que no sabe hacer -alojar el fichero y
 * escribir su ruta- y convertia cada foto en un despliegue.
 *
 * ES UN `<input type="file">` DENTRO DEL FORMULARIO DE SIEMPRE, no una subida
 * aparte: el fichero viaja con el resto de campos hasta la Server Action, que es
 * quien lo sube. Por eso FUNCIONA SIN JAVASCRIPT, como el resto del panel. Lo
 * que este componente anade con JavaScript es comodidad, no funcion:
 *
 *   1. VISTA PREVIA de la foto elegida, con `blob:` -que la CSP ya admite en
 *      `img-src`-. Sin ella, quien elige entre veinte fotos de la misma gorra no
 *      sabe cual mando hasta despues de guardar.
 *   2. REDUCCION antes de enviar. La camara de un telefono produce 4-12 MB y el
 *      tope es 5 MiB: sin reducir, la mayoria de las fotos hechas en el momento
 *      rebotarian. Se reescala a 2000 px de lado mayor, que sobra para la ficha,
 *      y el formulario pasa de megas a cientos de KB -que en datos moviles es la
 *      diferencia entre guardar y quedarse mirando-.
 *
 * LA IMAGEN ACTUAL NO VIAJA EN UN CAMPO OCULTO. Si no se elige foto ni se marca
 * "quitar", la accion no manda `image_url` y la API deja la que habia. Un campo
 * oculto con la ruta se edita en cinco segundos.
 */

/** Lado mayor, en pixeles, al que se reduce una foto antes de enviarla. */
const MAX_DIMENSION = 2000;

/** Por debajo de esto no se toca: ya es ligera y recodificar solo pierde calidad. */
const RESIZE_THRESHOLD_BYTES = 1_000_000;

const JPEG_QUALITY = 0.86;

/**
 * Reduce una foto en el navegador. Devuelve el fichero original si no hace
 * falta, si el navegador no sabe, o si el resultado no mejora.
 *
 * NUNCA LANZA: es una mejora. Si algo falla, el fichero original sigue en el
 * input y el servidor decide.
 */
async function downscale(file: File): Promise<File> {
  if (file.size <= RESIZE_THRESHOLD_BYTES) return file;
  if (typeof createImageBitmap !== "function") return file;

  try {
    // `from-image` aplica la orientacion EXIF: sin ello, una foto hecha con el
    // telefono en vertical saldria tumbada al redibujarla.
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });

    const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext("2d");
    if (context === null) return file;

    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();

    // Se conserva el tipo: un PNG o un WebP pueden llevar transparencia, y
    // pasarlos a JPEG la pintaria de negro. Un navegador que no sepa codificar
    // el tipo pedido devuelve PNG, que tambien esta admitido.
    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, file.type, JPEG_QUALITY);
    });

    if (blob === null || blob.size >= file.size) return file;
    if (!(ADMIN_MEDIA_CONTENT_TYPES as readonly string[]).includes(blob.type)) return file;

    return new File([blob], file.name, { type: blob.type, lastModified: file.lastModified });
  } catch {
    return file;
  }
}

/** Sustituye el fichero del input. `false` si el navegador no lo permite. */
function replaceInputFile(input: HTMLInputElement, file: File): boolean {
  try {
    const transfer = new DataTransfer();
    transfer.items.add(file);
    input.files = transfer.files;
    return true;
  } catch {
    return false;
  }
}

export function ImageUploadField({
  name,
  label,
  currentUrl,
  error,
}: {
  /**
   * Prefijo de los campos: el fichero viaja en `${name}_file` y la casilla de
   * quitar en `${name}_remove`. Es lo que lee `imageFrom` en el servidor.
   */
  readonly name: string;
  readonly label: string;
  /** Imagen guardada, si la hay. `undefined` en un alta. */
  readonly currentUrl?: string | null | undefined;
  /** Error ya traducido, atribuido a `${name}_file`. */
  readonly error?: string | undefined;
}) {
  const t = useTranslations("admin.catalog");

  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [tooLarge, setTooLarge] = useState(false);

  const current = safeImageUrl(currentUrl);

  // Estable entre renders: `FileInput` se suscribe con el al `reset` del
  // formulario, y una funcion nueva en cada render lo resuscribiria cada vez.
  const handlePicked = useCallback((url: string | null, isTooLarge: boolean): void => {
    setPreviewUrl(url);
    setTooLarge(isTooLarge);
  }, []);

  // Un `blob:` retiene el fichero en memoria hasta que se revoca.
  useEffect(() => {
    if (previewUrl === null) return undefined;
    return () => {
      URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const shown = previewUrl ?? current;

  return (
    <div className="flex flex-col gap-s3">
      <FormField
        label={label}
        description={t("fieldImageHint")}
        error={tooLarge ? t("imageTooLarge") : error}
      >
        <FileInput name={`${name}_file`} onPicked={handlePicked} />
      </FormField>

      {shown === null ? null : (
        <figure className="flex items-center gap-s3">
          {/*
           * `<img>` y no `next/image`: la vista previa es un `blob:` local y la
           * guardada sale de `/media/...`, que ya se sirve reducida e inmutable.
           * `shown` es un `blob:` creado aqui o una ruta que paso por
           * `safeImageUrl`.
           */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={shown}
            alt=""
            className="h-20 w-20 shrink-0 rounded-md border border-border bg-surface-sunken object-cover"
          />
          <figcaption className="text-caption text-text-subtle">
            {previewUrl === null ? t("imageCurrent") : t("imageSelected")}
          </figcaption>
        </figure>
      )}

      {/* Solo cuando hay algo guardado que quitar. */}
      {current === null ? null : <Checkbox name={`${name}_remove`} label={t("imageRemove")} />}
    </div>
  );
}

/**
 * El `<input type="file">`, cableado al `FormField` que lo envuelve.
 *
 * Componente aparte porque `useFormField` lee el contexto del `FormField`, y un
 * hook solo ve el contexto de SUS ancestros: llamado desde `ImageUploadField`
 * -que es quien pinta el `FormField`- devolveria `null`.
 */
function FileInput({
  name,
  onPicked,
}: {
  readonly name: string;
  readonly onPicked: (previewUrl: string | null, tooLarge: boolean) => void;
}) {
  const field = useFormField();
  const inputRef = useRef<HTMLInputElement>(null);

  /*
   * EL FORMULARIO SE REINICIA DESPUES DE CADA ENVIO -React lo hace con los
   * campos no controlados- y el input se queda sin fichero. Sin escuchar ese
   * `reset`, la vista previa seguiria ensenando una foto que ya no esta elegida,
   * y quien volviera a pulsar "Guardar" creeria estar mandandola.
   */
  useEffect(() => {
    const form = inputRef.current?.form;
    if (form === null || form === undefined) return undefined;

    const clear = (): void => {
      onPicked(null, false);
    };

    form.addEventListener("reset", clear);
    return () => {
      form.removeEventListener("reset", clear);
    };
  }, [onPicked]);

  async function handleChange(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const input = event.currentTarget;
    const picked = input.files?.[0];

    if (picked === undefined) {
      onPicked(null, false);
      return;
    }

    const reduced = await downscale(picked);
    const sent = reduced !== picked && replaceInputFile(input, reduced) ? reduced : picked;

    // Ni reducida cabe. Se vacia el input en vez de dejar enviar un formulario
    // que el servidor va a rechazar entero, con todo lo demas ya tecleado.
    if (sent.size > ADMIN_MEDIA_MAX_BYTES) {
      input.value = "";
      onPicked(null, true);
      return;
    }

    onPicked(URL.createObjectURL(sent), false);
  }

  return (
    <input
      ref={inputRef}
      type="file"
      name={name}
      // Lista cerrada, la misma que valida la API. En iOS ademas hace que una
      // foto HEIC de la galeria llegue ya convertida a JPEG.
      accept={ADMIN_MEDIA_CONTENT_TYPES.join(",")}
      id={field?.controlId}
      aria-describedby={field?.describedBy}
      aria-invalid={field?.invalid === true ? true : undefined}
      onChange={(event) => {
        void handleChange(event);
      }}
      className={cn(
        "block w-full rounded-md border bg-surface text-body-sm text-text-muted",
        "file:mr-3 file:cursor-pointer file:border-0 file:border-r file:border-border",
        "file:bg-surface-sunken file:px-3 file:py-2.5 file:text-body-sm file:font-medium file:text-text",
        FOCUS_VISIBLE_CLASSES,
        field?.invalid === true ? "border-danger" : "border-border-strong",
      )}
    />
  );
}
