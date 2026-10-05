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

/** Cada cuanto pasa sola a la siguiente foto. */
const INTERVAL_MS = 6000;

/**
 * Margen tras un desplazamiento automatico durante el que los eventos `scroll`
 * se atribuyen a la animacion y no al visitante. Cubre de sobra el `smooth`
 * mas lento, que es el de volver de la ultima foto a la primera.
 */
const AUTO_SCROLL_MS = 1500;

/**
 * Carrusel de fotos del premio en el hero (DEC-066; sin controles, DEC-073).
 *
 * SE DESLIZA CON EL DEDO
 * ----------------------
 * Es una tira con desplazamiento horizontal NATIVO y `scroll-snap`: la foto
 * sigue al dedo, conserva la inercia del sistema y se asienta sola en la foto
 * mas cercana. No hay gesto programado a mano que pueda pelearse con el scroll
 * vertical de la pagina: el navegador decide si el gesto es horizontal o
 * vertical, como en cualquier galeria del telefono. El degradado y el titular
 * del hero estan FUERA de la tira, asi que no se mueven y el contraste medido en
 * DEC-042 vale para todas las fotos.
 *
 * SIN CONTROLES A LA VISTA
 * ------------------------
 * El cliente pidio quitar la pausa y las barras. Pasa sola cada seis segundos,
 * que es lo que avisa de que hay mas fotos, y se detiene:
 * - para siempre en cuanto alguien la desliza: ya ha tomado el control;
 * - mientras el dedo esta encima, para no moverle la foto debajo;
 * - mientras tiene el foco del teclado;
 * - con `prefers-reduced-motion`, en el que no rota sola.
 *
 * WCAG 2.2.2 sigue pidiendo una pausa, y existe: solo aparece al llegar con el
 * teclado y la leen los lectores de pantalla, como un enlace de "saltar al
 * contenido". Con el dedo o el raton no se ve.
 *
 * Todas las fotos se cargan con la pagina (solo la primera con prioridad): en
 * una tira horizontal, una foto diferida no empieza a bajar hasta que asoma, y
 * se veria un hueco negro a mitad del gesto.
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
  const trackRef = useRef<HTMLDivElement>(null);
  const autoScrollUntil = useRef(0);
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [takenOver, setTakenOver] = useState(false);
  const [holding, setHolding] = useState(false);
  const [focused, setFocused] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);

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

  const rotating = count > 1 && !paused && !takenOver && !holding && !focused && !reducedMotion;

  // Un temporizador POR FOTO, no un intervalo fijo: si la foto cambia por otra
  // via, el plazo vuelve a empezar y la siguiente tambien dura seis segundos.
  useEffect(() => {
    if (!rotating) return undefined;
    const timer = window.setTimeout(() => {
      const next = (index + 1) % count;
      setIndex(next);
      const track = trackRef.current;
      // jsdom no implementa `scrollTo`; ahi basta con el estado.
      if (track !== null && typeof track.scrollTo === "function") {
        autoScrollUntil.current = Date.now() + AUTO_SCROLL_MS;
        track.scrollTo({ left: next * track.clientWidth, behavior: "smooth" });
      }
    }, INTERVAL_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [rotating, count, index]);

  // La foto activa sale de la POSICION de la tira, la mueva quien la mueva. Un
  // desplazamiento que no es el automatico es del visitante -dedo, trackpad o
  // flechas del teclado- y desde ese momento ya no rota sola.
  const syncWithScroll = () => {
    const track = trackRef.current;
    if (track === null || track.clientWidth === 0) return;
    const nearest = Math.round(track.scrollLeft / track.clientWidth);
    setIndex(Math.min(Math.max(nearest, 0), count - 1));
    if (Date.now() > autoScrollUntil.current) setTakenOver(true);
  };

  return (
    <div
      className="absolute inset-0"
      onFocus={() => {
        setFocused(true);
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
      }}
    >
      {/* Pausa solo para teclado y lectores de pantalla (WCAG 2.2.2). */}
      {count > 1 ? (
        <div className="absolute left-s4 top-s4 z-20 lg:left-auto lg:right-s8 lg:top-s8">
          <button
            type="button"
            onClick={() => {
              setPaused((current) => !current);
            }}
            className={cn(
              "sr-only rounded-pill bg-bg/80 text-body-sm text-text backdrop-blur-sm",
              "focus:not-sr-only focus:block focus:px-s3 focus:py-s2",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus",
            )}
          >
            {paused ? t("play") : t("pause")}
          </button>
        </div>
      ) : null}

      <div
        ref={trackRef}
        role="group"
        aria-roledescription={t("roleDescription")}
        aria-label={t("label")}
        // Una tira con scroll tiene que poder recibir el foco, o el teclado no
        // tendria como recorrerla (axe: `scrollable-region-focusable`). Con el
        // foco, las flechas pasan de foto.
        // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- region con scroll
        tabIndex={0}
        // Mientras rota sola, el cambio no se anuncia: un lector de pantalla
        // leyendo una foto nueva cada seis segundos seria ruido. Parado, si.
        aria-live={rotating ? "off" : "polite"}
        onScroll={syncWithScroll}
        onTouchStart={() => {
          setHolding(true);
        }}
        onTouchEnd={() => {
          setHolding(false);
        }}
        onTouchCancel={() => {
          setHolding(false);
        }}
        className={cn(
          "absolute inset-0 flex snap-x snap-mandatory overflow-x-auto overflow-y-hidden overscroll-x-contain",
          "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus",
        )}
      >
        {slides.map((slide, slideIndex) => {
          const active = slideIndex === index;
          return (
            <div
              key={`${slide.src}-${String(slideIndex)}`}
              role="group"
              aria-roledescription={t("slideRoleDescription")}
              aria-label={t("slide", { current: slideIndex + 1, total: count })}
              aria-hidden={!active}
              className="relative h-full w-full shrink-0 snap-center snap-always"
            >
              <Image
                src={slide.src}
                alt={slide.alt}
                fill
                priority={slideIndex === 0}
                loading={slideIndex === 0 ? undefined : "eager"}
                sizes={sizes}
                draggable={false}
                className={cn("select-none object-cover", imageClassName)}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
