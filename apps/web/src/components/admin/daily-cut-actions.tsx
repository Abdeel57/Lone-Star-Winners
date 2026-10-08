"use client";

import { Button } from "@lsw/ui";

/**
 * Imprimir y descargar el corte de caja (DEC-085).
 *
 * El CSV llega YA HECHO del servidor: aqui solo se convierte en un archivo. Se
 * crea un `Blob` al pulsar en vez de un enlace `data:`, que con un dia largo de
 * ventas se vuelve una URL enorme que algunos navegadores cortan.
 */
export function DailyCutActions({
  csv,
  filename,
  printLabel,
  downloadLabel,
}: {
  readonly csv: string;
  readonly filename: string;
  readonly printLabel: string;
  readonly downloadLabel: string;
}) {
  function download(): void {
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex flex-wrap gap-s2 print:hidden">
      <Button type="button" variant="secondary" size="sm" onClick={() => window.print()}>
        {printLabel}
      </Button>
      <Button type="button" variant="ghost" size="sm" onClick={download}>
        {downloadLabel}
      </Button>
    </div>
  );
}
