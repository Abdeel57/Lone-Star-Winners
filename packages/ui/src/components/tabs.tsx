"use client";

import * as TabsPrimitive from "@radix-ui/react-tabs";
import { createContext, useContext, type ReactNode } from "react";

import { cn } from "../lib/cn";
import { FOCUS_VISIBLE_CLASSES } from "../lib/focus";

/**
 * Pestanas, sobre Radix Tabs.
 *
 * Se usa Radix porque el patron de pestanas exige foco itinerante: la lista
 * entera es UNA sola parada de tabulacion y las flechas mueven entre pestanas
 * (WAI-ARIA Authoring Practices). Un conjunto de botones normales obliga a
 * tabular por todas las pestanas antes de llegar al contenido, y con muchas
 * pestanas eso convierte la navegacion por teclado en un castigo.
 *
 * `activationMode="manual"` por defecto, y es deliberado: con activacion
 * automatica, moverse con las flechas CARGA cada panel por el que se pasa. En
 * este producto los paneles piden datos al servidor (historial de
 * participaciones, pedidos), asi que la activacion automatica dispararia
 * peticiones que nadie pidio. Con `manual` se selecciona con Enter o Espacio.
 *
 * ADVERTENCIA DE USO: las pestanas ocultan contenido. Nada legalmente material
 * -Reglas Oficiales, metodo gratuito de participacion, disclaimers- puede vivir
 * detras de una pestana que el participante tenga que descubrir.
 */

/**
 * Nombre accesible de la lista, propagado de `Tabs` a `TabsList`.
 *
 * El `aria-label` TIENE que acabar en el elemento con `role="tablist"`, que lo
 * renderiza `TabsList`. Pero pedirselo a `TabsList` en vez de a `Tabs` invita a
 * olvidarlo, porque `TabsList` parece un contenedor sin identidad propia. Con
 * este contexto, la prop se pide una vez donde es evidente y llega sola a donde
 * hace falta.
 */
const TabsLabelContext = createContext<string | null>(null);

export interface TabsProps {
  /** Pestana seleccionada. */
  readonly value: string;
  readonly onValueChange: (value: string) => void;
  /**
   * Nombre accesible de la lista de pestanas, ya traducido. Obligatorio: sin
   * el, un lector de pantalla anuncia "lista de pestanas" sin decir de que.
   */
  readonly label: string;
  readonly orientation?: "horizontal" | "vertical";
  readonly className?: string;
  readonly children: ReactNode;
}

export function Tabs({
  value,
  onValueChange,
  label,
  orientation = "horizontal",
  className,
  children,
}: TabsProps) {
  return (
    <TabsLabelContext.Provider value={label}>
      <TabsPrimitive.Root
        value={value}
        onValueChange={onValueChange}
        orientation={orientation}
        activationMode="manual"
        className={cn("flex flex-col gap-s4", className)}
      >
        {children}
      </TabsPrimitive.Root>
    </TabsLabelContext.Provider>
  );
}

export interface TabsListProps {
  readonly className?: string;
  readonly children: ReactNode;
}

/**
 * Lista de pestanas.
 *
 * Con scroll horizontal propio: en un telefono de 360px, cuatro pestanas no
 * caben, y la alternativa -apilarlas o truncar el texto- es peor. El scroll es
 * de la lista, nunca del documento.
 */
export function TabsList({ className, children }: TabsListProps) {
  const label = useContext(TabsLabelContext);

  if (label === null) {
    throw new Error("TabsList must be rendered inside Tabs.");
  }

  return (
    <TabsPrimitive.List
      aria-label={label}
      className={cn(
        "flex gap-1 overflow-x-auto border-b border-border",
        "[scrollbar-width:thin]",
        className,
      )}
    >
      {children}
    </TabsPrimitive.List>
  );
}

export interface TabsTriggerProps {
  readonly value: string;
  readonly disabled?: boolean;
  readonly className?: string;
  /** Texto de la pestana, ya traducido. */
  readonly children: ReactNode;
}

export function TabsTrigger({ value, disabled, className, children }: TabsTriggerProps) {
  return (
    <TabsPrimitive.Trigger
      value={value}
      disabled={disabled}
      className={cn(
        "min-h-touch shrink-0 whitespace-nowrap rounded-t-md px-4 py-2",
        "text-body-sm font-medium text-text-muted",
        "border-b-2 border-transparent",
        "transition-colors duration-fast ease-standard",
        FOCUS_VISIBLE_CLASSES,
        "hover:text-text",
        // El estado seleccionado no se transmite solo con el color: Radix pone
        // `aria-selected`, y ademas el subrayado da una segunda senal visual.
        "data-[state=active]:border-brand data-[state=active]:font-semibold data-[state=active]:text-brand",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
    >
      {children}
    </TabsPrimitive.Trigger>
  );
}

export interface TabsPanelProps {
  readonly value: string;
  readonly className?: string;
  readonly children: ReactNode;
}

export function TabsPanel({ value, className, children }: TabsPanelProps) {
  return (
    <TabsPrimitive.Content
      value={value}
      // El panel es enfocable para que, al activar una pestana, el foco pueda
      // entrar en el contenido con una sola tabulacion.
      className={cn("rounded-md", FOCUS_VISIBLE_CLASSES, className)}
    >
      {children}
    </TabsPrimitive.Content>
  );
}
