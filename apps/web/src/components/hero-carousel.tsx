"use client";

import { cn } from "@lsw/ui";
import Image from "next/image";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";

/** Una foto del carrusel, ya filtrada (`safeImageUrl`) y con su `alt` resuelto. */
export interface HeroSlide {
  readonly src: string;
  /** `""` si es decorativa. */
  readonly alt: string;
}

/** Cada cuanto cambia de foto. Por encima de 5 s, y con pausa (WCAG 2.2.2). */
const INTERVAL_MS = 6000;

/** Desplazamiento minimo, en pixeles, para que un gesto cuente como deslizar. */
const SWIPE_PX = 40;

/**
 * Carrusel de fotos del premio en el hero (DEC-066).
 *
 * Las fotos van APILADAS y se funden: no hay desplazamiento lateral, asi que el
 * degradado y el titular del hero no se mueven y el contraste medido en
 * DEC-042 sigue valiendo para todas. Se pinta dentro del hueco de la foto del
 * hero, que es quien decide su tamano en telefono y en escritorio.
 *
 * LO QUE LO DETIENE
 * -----------------
 * - El boton de pausa. Es obligatorio: contenido que se mueve solo mas de 5 s
 *   tiene que poder pararse (WCAG 2.2.2).
 * - Tener el foco en sus controles: nadie quiere que la foto cambie mientras
 *   elige otra.
 * - `prefers-reduced-motion`: no rota solo y el cambio es instantaneo.
 *
 * Solo la primera foto se pide con prioridad; las demas se cargan sin bloquear
 * la primera pantalla.
 */
export function HeroCarousel({
  slides,
  sizes,
  imageClassName,
}: {
  readonly slides: readonly HeroSlide[];
  readonly sizes: string;
  /** Encuadre de las fotos (`object-*`), el mismo que la foto unica del hero. */
  readonly imageClassName?: string;
}) {
  const t = useTranslations("home.heroCarousel");
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [focused, setFocused] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const touchStartX = useRef<number | null>(null);

  const count = slides.length;

  useEffect(() => {
    // Sin `matchMedia` (navegadores muy antiguos, jsdom) no hay preferencia que
    // leer: se rota, y la pausa sigue disponible.
    if (typeof window.matchMedia !== "function") return undefined;
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => {
      setReducedMotion(query.matches);
    };
    update();
    query.addEventListener("change", update);
    return () => {
      query.removeEventListener("change", update);
    };
  }, []);

  const rotating = count > 1 && !paused && !focused && !reducedMotion;

  useEffect(() => {
    if (!rotating) return undefined;
    const timer = window.setInterval(() => {
      setIndex((current) => (current + 1) % count);
    }, INTERVAL_MS);
    return () => {
      window.clearInterval(timer);
    };
  }, [rotating, count]);

  const goTo = (next: number) => {
    setIndex(((next % count) + count) % count);
  };

  return (
    <div
      aria-roledescription={t("roleDescription")}
      aria-label={t("label")}
      className="absolute inset-0"
      onTouchStart={(event) => {
        touchStartX.current = event.touches[0]?.clientX ?? null;
      }}
      onTouchEnd={(event) => {
        const start = touchStartX.current;
        const end = event.changedTouches[0]?.clientX;
        touchStartX.current = null;
        if (start === null || end === undefined) return;
        const delta = end - start;
        if (Math.abs(delta) < SWIPE_PX) return;
        goTo(delta < 0 ? index + 1 : index - 1);
      }}
    >
      {/* Mientras rota solo, el cambio no se anuncia: un lector de pantalla
          leyendo una foto nueva cada seis segundos seria ruido. Parado, si. */}
      <div aria-live={rotating ? "off" : "polite"} className="absolute inset-0">
        {slides.map((slide, slideIndex) => {
          const active = slideIndex === index;
          return (
            <div
              key={`${slide.src}-${String(slideIndex)}`}
              role="group"
              aria-roledescription={t("slideRoleDescription")}
              aria-label={t("slide", { current: slideIndex + 1, total: count })}
              aria-hidden={!active}
              className={cn(
                "absolute inset-0 transition-opacity duration-700 ease-standard motion-reduce:transition-none",
                active ? "opacity-100" : "opacity-0",
              )}
            >
              <Image
                src={slide.src}
                alt={slide.alt}
                fill
                priority={slideIndex === 0}
                sizes={sizes}
                className={cn("object-cover", imageClassName)}
              />
            </div>
          );
        })}
      </div>

      {/* Controles ARRIBA a la derecha en los dos tamanos: en telefono abajo
          cae el titular, y en escritorio el hero es mas alto que la ventana y
          abajo quedarian fuera de la primera pantalla. `pointer-events-auto`
          porque en escritorio la capa de la foto no recibe el raton (ver el
          hero). */}
      <div
        className={cn(
          "pointer-events-auto absolute right-s3 top-s3 z-20 flex items-center gap-s2",
          "rounded-pill bg-bg/65 px-s2 py-s1 backdrop-blur-sm",
          "lg:right-s8 lg:top-s8",
        )}
        onFocus={() => {
          setFocused(true);
        }}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
        }}
      >
        <button
          type="button"
          onClick={() => {
            setPaused((current) => !current);
          }}
          aria-label={paused ? t("play") : t("pause")}
          className="flex h-8 w-8 items-center justify-center rounded-pill text-text hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
        >
          {paused ? <PlayIcon /> : <PauseIcon />}
        </button>

        {slides.map((slide, slideIndex) => (
          <button
            key={`dot-${slide.src}-${String(slideIndex)}`}
            type="button"
            onClick={() => {
              goTo(slideIndex);
            }}
            aria-label={t("goTo", { current: slideIndex + 1, total: count })}
            aria-current={slideIndex === index ? "true" : undefined}
            className="flex h-8 w-6 items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
          >
            <span
              aria-hidden="true"
              className={cn(
                "block h-2 rounded-pill transition-all duration-base ease-standard",
                slideIndex === index ? "w-5 bg-brand" : "w-2 bg-text/60",
              )}
            />
          </button>
        ))}
      </div>
    </div>
  );
}

function PauseIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false" className="h-4 w-4">
      <rect x="3.5" y="3" width="3" height="10" rx="0.75" fill="currentColor" />
      <rect x="9.5" y="3" width="3" height="10" rx="0.75" fill="currentColor" />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false" className="h-4 w-4">
      <path
        d="M5 3.2v9.6a.6.6 0 0 0 .9.5l7.4-4.8a.6.6 0 0 0 0-1L5.9 2.7a.6.6 0 0 0-.9.5Z"
        fill="currentColor"
      />
    </svg>
  );
}
