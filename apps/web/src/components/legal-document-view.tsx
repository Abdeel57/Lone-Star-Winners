import type { ReactNode } from "react";

import { Link } from "@/i18n/navigation";
import type { LegalBlock, LegalDocument, LegalRun } from "@/legal/types";

/**
 * Un documento legal del sitio (Terminos, Privacidad, Aviso de California).
 *
 * SE PINTA DESDE DATOS, NUNCA COMO HTML. El texto llega estructurado desde el
 * .docx del abogado (`src/legal/`), y cada bloque se convierte en su elemento:
 * no hay `dangerouslySetInnerHTML` en ninguna parte, por la misma razon que en
 * las Reglas Oficiales.
 *
 * `lang="en"` en el articulo: los documentos solo existen en ingles, y un
 * lector de pantalla tiene que leerlos con voz inglesa aunque la interfaz este
 * en espanol.
 *
 * Las direcciones web y de correo del texto se enlazan solas. Las del propio
 * sitio (`https://LoneStarWinners.com/privacychoices`) van como enlace INTERNO,
 * con el prefijo de idioma (DEC-021); las demas abren en otra pestana.
 */
export function LegalDocumentView({ document }: { readonly document: LegalDocument }) {
  return (
    <article lang="en" className="flex flex-col gap-s5">
      {document.blocks.map((block, index) => (
        <Block key={index} block={block} />
      ))}
    </article>
  );
}

function Block({ block }: { readonly block: LegalBlock }) {
  switch (block.t) {
    case "h":
      return (
        <h2
          id={anchorFor(block.text)}
          // `scroll-mt-32`: banda roja + cabecera fijas (DEC-082).
          className="mt-s4 scroll-mt-32 font-display text-heading-md font-semibold text-text"
        >
          {block.text}
        </h2>
      );
    case "p":
      return (
        <p className="whitespace-pre-line text-body-md text-text-muted">{renderRuns(block.runs)}</p>
      );
    case "list": {
      const items = block.items.map((item, index) => (
        <li key={index} className="pl-1">
          {renderRuns(item)}
        </li>
      ));
      const className = "flex flex-col gap-2 pl-s6 text-body-md text-text-muted";
      return block.ordered ? (
        <ol className={`list-decimal ${className}`}>{items}</ol>
      ) : (
        <ul className={`list-disc ${className}`}>{items}</ul>
      );
    }
    case "table":
      return <LegalTable rows={block.rows} />;
  }
}

/**
 * La tabla de categorias de la Politica de Privacidad.
 *
 * Con desplazamiento horizontal PROPIO: en 360px tres columnas de texto largo
 * no caben, y estirar la pagina entera seria peor que deslizar la tabla.
 */
function LegalTable({
  rows,
}: {
  readonly rows: readonly (readonly (readonly (readonly LegalRun[])[])[])[];
}) {
  const [header, ...body] = rows;

  return (
    <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <table className="w-full min-w-[36rem] border-collapse text-left text-body-sm">
        {header === undefined ? null : (
          <thead>
            <tr>
              {header.map((cell, index) => (
                <th
                  key={index}
                  scope="col"
                  className="border-b border-border-strong bg-surface-raised px-3 py-2 font-semibold text-text"
                >
                  {cell.map((paragraph, pIndex) => (
                    <span key={pIndex} className="block">
                      {renderRuns(paragraph)}
                    </span>
                  ))}
                </th>
              ))}
            </tr>
          </thead>
        )}
        <tbody>
          {body.map((row, rIndex) => (
            <tr key={rIndex} className="align-top">
              {row.map((cell, cIndex) => (
                <td key={cIndex} className="border-b border-border px-3 py-2 text-text-muted">
                  {cell.map((paragraph, pIndex) => (
                    <span key={pIndex} className="block">
                      {renderRuns(paragraph)}
                    </span>
                  ))}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function renderRuns(runs: readonly LegalRun[]): ReactNode[] {
  return runs.map((run, index) => {
    let content: ReactNode =
      run.href === undefined ? linkify(run.x) : <LegalLink url={run.href} text={run.x} />;
    if (run.i === true) content = <em>{content}</em>;
    if (run.b === true) content = <strong className="font-semibold text-text">{content}</strong>;
    return <span key={index}>{content}</span>;
  });
}

/**
 * Direcciones web y de correo dentro del texto.
 *
 * Solo recorre el texto FIJO de los documentos de `src/legal/`, que viaja en el
 * build; nunca algo que escriba un visitante, asi que el aviso de expresion
 * insegura de ESLint no tiene por donde entrar.
 */
const LINK_PATTERN = /https?:\/\/[^\s,;()<>"]+|[\w.%+-]+@[\w-]+(?:\.[\w-]+)+/gu;

function linkify(text: string): ReactNode {
  const parts: ReactNode[] = [];
  let last = 0;

  for (const match of text.matchAll(LINK_PATTERN)) {
    const start = match.index;
    // El punto o los dos puntos finales son de la frase, no del enlace.
    const raw = match[0].replace(/[.:]+$/u, "");
    if (start > last) parts.push(text.slice(last, start));
    parts.push(
      raw.includes("@") && !raw.startsWith("http") ? (
        <a
          key={start}
          href={`mailto:${raw}`}
          className="text-brand underline underline-offset-4 hover:text-text"
        >
          {raw}
        </a>
      ) : (
        <LegalLink key={start} url={raw} text={raw} />
      ),
    );
    last = start + raw.length;
  }

  if (last === 0) return text;
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

const LINK_CLASS = "break-words text-brand underline underline-offset-4 hover:text-text";

/** Enlace a una URL del documento: interno si es del propio sitio. */
function LegalLink({ url, text }: { readonly url: string; readonly text: string }) {
  const internal = internalPath(url);

  if (internal !== null) {
    return (
      <Link href={internal} className={LINK_CLASS}>
        {text}
      </Link>
    );
  }

  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className={LINK_CLASS}>
      {text}
    </a>
  );
}

/**
 * Ruta interna de una URL del propio dominio, o `null` si es externa.
 *
 * Se compara el host EXACTO, no un "contiene": `lonestarwinners.com.evil.example`
 * no es este sitio.
 */
function internalPath(url: string): string | null {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    if (host !== "lonestarwinners.com" && host !== "www.lonestarwinners.com") return null;
    const path = parsed.pathname.replace(/\/+$/u, "").toLowerCase();
    return path === "" ? "/" : path;
  } catch {
    return null;
  }
}

/** Ancla estable de un titulo: "COLLECTION OF YOUR INFORMATION" -> "collection-of-your-information". */
export function anchorFor(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 80);
}
