"use client";

import { IconButton } from "@lsw/ui";
import { useEffect, useState, type ReactNode } from "react";

import {
  CLOSING_NOTICE_COOKIE,
  isClosingNoticeDismissed,
  type ClosingNoticePhase,
} from "@/lib/closing-notice";

/**
 * El marco del aviso de cierre y su boton de cerrar (DEC-099).
 *
 * Lo unico del aviso que corre en el navegador. El texto llega ya compuesto del
 * servidor como `children`.
 */
export function ClosingNoticeFrame({
  phase,
  titleId,
  dismissLabel,
  children,
}: {
  readonly phase: ClosingNoticePhase;
  readonly titleId: string;
  readonly dismissLabel: string;
  readonly children: ReactNode;
}) {
  const [dismissed, setDismissed] = useState(false);

  // El servidor ya no lo pinta si esta cerrado, pero al volver atras el
  // navegador puede restaurar la pagina tal como estaba.
  useEffect(() => {
    if (isClosingNoticeDismissed(document.cookie, phase)) setDismissed(true);
  }, [phase]);

  if (dismissed) return null;

  function dismiss(): void {
    const secure = window.location.protocol === "https:" ? "; Secure" : "";
    document.cookie = `${CLOSING_NOTICE_COOKIE}=${phase}; Path=/; SameSite=Lax${secure}`;
    setDismissed(true);
  }

  return (
    <section
      aria-labelledby={titleId}
      className="lsw-enter lsw-topo relative isolate border-b border-border bg-surface"
    >
      <div aria-hidden="true" className="lsw-gold-rule" />
      <div className="lsw-container relative py-s4 lg:py-s5">
        {children}
        <IconButton
          label={dismissLabel}
          icon={<CloseIcon />}
          onClick={dismiss}
          className="absolute right-1 top-1 sm:right-3 lg:right-5"
        />
      </div>
    </section>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 16 16" focusable="false" className="h-4 w-4">
      <path
        d="M3.5 3.5l9 9m0-9l-9 9"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}
