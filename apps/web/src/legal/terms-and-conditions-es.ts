/*
 * Terminos y Condiciones — Segunda Edicion, EN ESPANOL (DEC-104).
 *
 * Transcritos tal cual del PDF que entrego el cliente el 2026-11-12
 * ("LSW_Terminos_Condiciones_Espanol.pdf"). Solo se corrigio una errata
 * evidente del titulo de una seccion ("Contrannotificacion"). El propio
 * documento dice que, en caso de conflicto, prevalece el texto en ingles
 * (`terms-and-conditions.ts`, del abogado), que no cambia.
 */

import type { LegalDocument } from "./types";

const p = (text: string) => ({ t: "p", runs: [{ x: text }] }) as const;
const bold = (text: string) => ({ t: "p", runs: [{ x: text, b: true }] }) as const;
const h = (text: string) => ({ t: "h", text }) as const;

export const TERMS_AND_CONDITIONS_ES = {
  key: "terms",
  version: "2026-11-12",
  language: "es-US",
  title: "Términos y Condiciones — Segunda Edición",
  lastUpdated: "Fecha de actualización y entrada en vigor: 12 de noviembre de 2026.",
  source: "LSW_Terminos_Condiciones_Espanol.pdf",
  blocks: [
    h("Introducción"),
    p(
      "Bienvenido al sitio web de Lone Star Winners LLC, sociedad de responsabilidad limitada de Texas («Lone Star Winners»). El acceso, visita, registro o uso del Sitio constituye la aceptación de este acuerdo vinculante («Acuerdo»). Lone Star Winners podrá modificar estos Términos publicándolos en el Sitio o notificándolos por otros medios. Las modificaciones se aplicarán de forma prospectiva y no modificarán las condiciones de pedidos ya realizados ni de sorteos en los que ya se haya participado. El usuario acepta recibir electrónicamente comunicaciones y documentos relativos al Sitio y reconoce que su consentimiento electrónico constituye una firma vinculante.",
    ),
    h("Aviso de arbitraje"),
    bold(
      "ESTOS TÉRMINOS INCLUYEN UNA CLÁUSULA DE ARBITRAJE INDIVIDUAL VINCULANTE Y RENUNCIA A ACCIONES COLECTIVAS Y JUICIO POR JURADO. LÉANSE DETENIDAMENTE.",
    ),
    h("Definiciones"),
    p(
      "«Acuerdo» significa estos Términos y Condiciones, la Política de Privacidad y las demás políticas aplicables publicadas en el Sitio. «Reglas Oficiales» son las reglas independientes que gobiernan cada sorteo. «Información personal identificable» es cualquier dato que permita identificar a una persona, incluidos nombre, domicilio, fecha de nacimiento, teléfono e identificadores gubernamentales. «Persona» incluye personas físicas y entidades, salvo indicación contraria. «Sitio» significa https://LoneStarWinners.com y otros sitios operados por Lone Star Winners que publiquen estos Términos. «Usuario», «usted» o «su» designan a quienes acceden, visitan, se registran, compran o usan el Sitio y sus servicios.",
    ),
    h("Seguridad de la cuenta"),
    p(
      "El usuario deberá mantener confidencial su contraseña y no permitir que terceros accedan a su cuenta. Cuando el usuario opte por ello, Lone Star Winners podrá enviar por SMS códigos para verificar la identidad o recuperar cuentas; pueden aplicarse cargos de mensajería y datos. Para asistencia: info@LoneStarWinners.com. Para dejar de recibir mensajes, responder STOP. Las operadoras no responden por mensajes demorados o no entregados. Salvo que el Sitio lo indique expresamente, las comunicaciones por internet no deben presumirse seguras o cifradas.",
    ),
    h("Denegación o cancelación del servicio"),
    p(
      "Lone Star Winners podrá denegar, limitar o cancelar el acceso al servicio por incumplimiento de este Acuerdo u otras razones permitidas por ley. La terminación no elimina las obligaciones pendientes sobre pedidos ni los derechos de un participante conforme a las Reglas Oficiales aplicables.",
    ),
    h("Control de exportaciones"),
    p(
      "No se podrá exportar, reexportar ni utilizar el Sitio o su contenido en contravención de las leyes estadounidenses, incluidas prohibiciones relativas a países embargados y personas incluidas en listas de sanciones o prohibiciones comerciales. El usuario declara no estar sujeto a tales restricciones.",
    ),
    h("Licencia de uso"),
    p(
      "Lone Star Winners concede una licencia limitada, personal, no exclusiva, intransferible y no sublicenciable para visitar y utilizar el Sitio y su contenido únicamente con fines legítimos y conforme a este Acuerdo.",
    ),
    h("Propiedad intelectual y derechos de autor"),
    p(
      "Los textos, fotografías, videos, marcas, diseños y demás materiales del Sitio pertenecen a Lone Star Winners o a sus respectivos titulares y están protegidos por las leyes de propiedad intelectual. Se permite ver o descargar porciones únicamente para uso personal y no comercial; cualquier reproducción, redistribución, publicación, explotación o modificación no autorizada está prohibida. LONE STAR WINNERS es una marca de Lone Star Winners LLC; las marcas de terceros pertenecen a sus propietarios.",
    ),
    h("Notificaciones DMCA"),
    p(
      "Las reclamaciones de infracción de derechos de autor conforme a 17 U.S.C. § 512 deben enviarse a: Lone Star Winners LLC, Attn: DMCA Agent, 3601 N Grimes St Ste 400 PMB 263, Hobbs, NM 88240. La notificación debe incluir: (i) firma física o electrónica del titular o representante autorizado; (ii) descripción de la obra protegida y del material presuntamente infractor; (iii) localización del material; (iv) datos de contacto; (v) declaración de creencia de buena fe de que el uso no está autorizado; y (vi) declaración bajo pena de perjurio sobre exactitud y facultades del remitente.",
    ),
    h("Contranotificación DMCA"),
    p(
      "Si considera que un material fue retirado por error, el usuario puede remitir al agente designado: (i) su firma; (ii) identificación del material y ubicación previa; (iii) declaración de buena fe de que la retirada fue un error; (iv) nombre, dirección, teléfono, correo y aceptación de la jurisdicción federal competente y de notificaciones de la parte reclamante. Una contranotificación podrá transmitirse al reclamante original. Salvo acción judicial, el contenido podrá restablecerse en un plazo de diez (10) a catorce (14) días hábiles o más, a discreción de la empresa y conforme a la ley.",
    ),
    h("Productos, precios y pagos"),
    p(
      "Lone Star Winners vende mercancía identificada con su marca y, durante sorteos activos, podrá ofrecer paquetes de participaciones conforme a las Reglas Oficiales pertinentes. Los precios se expresan en dólares estadounidenses. Impuestos y cargos de envío aplicables se muestran antes de finalizar la compra. El cliente garantiza que está autorizado a usar el método de pago elegido. Al efectuar el pedido, autoriza el cobro indicado. La empresa podrá rechazar o cancelar pedidos por falta de inventario, errores de precio, sospecha de fraude o problemas de pago. Si cancela un pedido ya cobrado, devolverá el importe correspondiente.",
    ),
    p(
      "Paquetes de la Segunda Edición (precio en USD; participaciones fijas por paquete): Bronce — $15, 20 participaciones; Plata — $50, 100 participaciones; Oro — $100, 200 participaciones; Diamante — $200, 500 participaciones. Los impuestos y cargos adicionales aplicables se informan al finalizar la compra. Las participaciones correspondientes a compras reembolsadas, revertidas o sujetas a contracargos serán anuladas.",
    ),
    h("Sorteos y Segunda Edición"),
    bold(
      "NO SE REQUIERE COMPRA PARA PARTICIPAR O GANAR Y UNA COMPRA NO AUMENTA LAS PROBABILIDADES DE GANAR.",
    ),
    p(
      "Cada sorteo se rige por sus propias Reglas Oficiales, que determinan elegibilidad, premios, métodos de participación, límites y fechas. En caso de conflicto sobre el sorteo, prevalecen las Reglas Oficiales. La Segunda Edición comienza a las 12:00:00 a. m. MT del 12 de noviembre de 2026 y termina a las 11:59:59 p. m. MT del 20 de diciembre de 2026. Las compras elegibles en línea y en el punto de venta autorizado deben completarse dentro de ese período. Después del cierre, el Sitio puede continuar vendiendo mercancía sin otorgar participaciones o cerrarse temporalmente mientras se prepara la información para el Administrador independiente, Enteractive Solutions Group. El sorteo en vivo de cuatro (4) ganadores se realizará el 23 de diciembre de 2026, a la hora MT que se anuncie. El premio principal será la elección entre un Dodge Challenger SRT Hellcat morado y la pickup restante de la Primera Edición (Chevrolet Silverado 1500 2025 o GMC Sierra Single Cab 2024); tres ganadores adicionales distintos recibirán $1,000 cada uno. El método gratuito por correo, incluidos un (1) paquete Bronce de veinte (20) participaciones por cada carta válida, hasta cinco (5) cartas por participante (máximo cien [100] participaciones gratuitas), un máximo de dos (2) cartas por sobre y recepción obligatoria a más tardar el 18 de diciembre de 2026, se describe exclusivamente en las Reglas Oficiales.",
    ),
    h("Contenido aportado por los usuarios"),
    p(
      "El Sitio puede permitir publicar reseñas, textos, fotografías u otros materiales («Contenido del usuario»). El usuario conserva su propiedad, pero concede a Lone Star Winners una licencia mundial, gratuita, no exclusiva, transferible y sublicenciable para reproducir, distribuir, adaptar, exhibir y usar ese contenido en relación con el funcionamiento, promoción y mejora del Sitio. El usuario declara contar con los derechos pertinentes y que su contenido no infringe leyes ni derechos de terceros. Los datos personales se rigen por la Política de Privacidad; los materiales de participación en sorteos se rigen por dicha política y las Reglas Oficiales, no por esta licencia.",
    ),
    h("Moderación del contenido"),
    p(
      "El usuario responde por su contenido y las consecuencias de compartirlo. Lone Star Winners no garantiza exactitud ni calidad del contenido aportado, ni está obligado a supervisarlo previamente; podrá eliminar, bloquear o modificar contenidos que infrinjan este Acuerdo, la ley o derechos de terceros.",
    ),
    h("Seguridad e informes"),
    p(
      "Lone Star Winners busca mantener un entorno seguro, pero no garantiza la conducta de otros usuarios ni la exactitud de sus publicaciones. Las conductas peligrosas, abusivas o presuntamente ilícitas pueden reportarse a info@LoneStarWinners.com. La empresa podrá investigar, restringir cuentas y colaborar con autoridades, sin asumir obligación de resolver controversias entre usuarios.",
    ),
    h("Declaraciones y garantías del usuario"),
    p(
      "El usuario declara tener al menos 18 años y la mayoría de edad donde reside; contar con capacidad legal para aceptar el Acuerdo; y proporcionar información verdadera, actualizada y completa. La información falsa o incompleta puede dar lugar a cancelación de la cuenta. El usuario se compromete a no proporcionar datos personales de menores de trece (13) años.",
    ),
    h("Ley aplicable; jurisdicción; arbitraje"),
    p(
      "El uso del Sitio y este Acuerdo se rigen por las leyes del estado de Texas y leyes federales estadounidenses, sin aplicar disposiciones sobre conflictos de leyes. Las controversias se someterán a arbitraje individual vinculante, administrado por la American Arbitration Association conforme a sus Consumer Arbitration Rules, incluidas reglas de sede y cuotas. La Federal Arbitration Act regula la interpretación y aplicación del arbitraje. Para solicitar, confirmar, ejecutar o revisar un laudo, las partes aceptan, en la medida legal, tribunales estatales del condado de El Paso, Texas, y tribunales federales que correspondan a ese condado. Antes de iniciar arbitraje deberá enviarse aviso escrito sobre la reclamación y concederse al menos veinte (20) días para intentar resolverla informalmente. Se permiten demandas individuales en tribunales de reclamos menores competentes, si reúnen los requisitos. Una cláusula inexigible podrá separarse sin invalidar las demás. Las controversias relativas a un sorteo se sujetarán a sus Reglas Oficiales.",
    ),
    h("Renuncia a acciones colectivas y juicio por jurado"),
    bold(
      "EL ARBITRAJE SE REALIZARÁ SOLO DE MANERA INDIVIDUAL. HASTA DONDE LA LEY LO PERMITA, EL USUARIO RENUNCIA A INTEGRAR O PRESENTAR ACCIONES COLECTIVAS, REPRESENTATIVAS O ACUMULADAS, Y RENUNCIA A JUICIO POR JURADO.",
    ),
    h("Indemnización"),
    p(
      "En la máxima medida permitida por la ley, el usuario acepta defender, indemnizar y mantener indemnes a Lone Star Winners LLC, sus afiliados, sucesores, propietarios, empleados, directivos, representantes, contratistas y asesores frente a pérdidas, reclamaciones, gastos y honorarios razonables derivados de incumplimientos reales o alegados de este Acuerdo, del uso del Sitio o de conductas negligentes o intencionales. Cualquier acuerdo que afecte sus derechos requerirá autorización previa escrita.",
    ),
    h("Limitación de responsabilidad"),
    p(
      "El Sitio se proporciona «tal como está». En la máxima medida permitida por la ley, Lone Star Winners y las personas y entidades relacionadas no responderán por daños directos, indirectos, incidentales, punitivos, especiales o consecuenciales derivados del uso del Sitio, de compras o de materiales propios o de terceros. Ninguna disposición elimina obligaciones sobre premios establecidas por las Reglas Oficiales o derechos que no puedan excluirse legalmente.",
    ),
    h("Exclusión de otras garantías"),
    p(
      "Los bienes, servicios, materiales y contenidos del Sitio se proporcionan «tal como están», sin garantías adicionales expresas o implícitas, incluidas comerciabilidad e idoneidad para un fin particular, hasta donde lo permita la ley y sin perjuicio de garantías escritas de productos. Lone Star Winners sigue siendo responsable de sus obligaciones de premios de acuerdo con las Reglas Oficiales aplicables.",
    ),
    h("Política de uso del Sitio"),
    p(
      "El Sitio solo puede utilizarse para fines legales. Está prohibido utilizarlo para fraude, acoso, amenazas, actividades ilegales, infringir marcas, patentes o derechos de autor, divulgar información restringida o violar controles de exportación.",
    ),
    h("Usos expresamente prohibidos"),
    p(
      "Se prohíbe: (a) enviar publicidad no solicitada, spam o cadenas; (b) enviar spam a correos publicados en el Sitio; (c) anunciar esquemas piramidales o mercadeo multinivel; (d) incluir texto oculto; (e) alterar contenido ajeno; (f) compartir acceso a áreas privadas; (g) utilizar bots, rastreadores o agentes automatizados no autorizados, salvo navegadores normales y búsquedas permitidas; (h) acceder por interfaces no ofrecidas; (i) intentar ingeniería inversa del software; (j) copiar o agregar materiales sin permiso; y (k) incorporar o enlazar materiales mediante marcos u otros mecanismos prohibidos por el Acuerdo.",
    ),
    h("Idioma"),
    p(
      "Si existe conflicto entre esta versión en español y los Términos y Condiciones en inglés, prevalecerá el texto en inglés. Para cuestiones propias del Sorteo prevalecerán las Reglas Oficiales aplicables.",
    ),
  ],
} as const satisfies LegalDocument;
