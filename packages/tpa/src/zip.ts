/**
 * Empaquetado ZIP determinista (DEC-016: "SHA-256 del ZIP y de cada miembro").
 *
 * ---------------------------------------------------------------------------
 * POR QUE UN ZIP ESCRITO A MANO Y NO UNA LIBRERIA
 * ---------------------------------------------------------------------------
 *
 * Porque casi ninguna libreria de compresion es determinista por defecto, y las
 * dos fuentes de no determinismo son justo las que aqui importan:
 *
 *   - la MARCA DE TIEMPO de cada miembro, que suele tomarse del reloj;
 *   - el NIVEL DE COMPRESION, que cambia los bytes de salida sin cambiar el
 *     contenido y puede variar con la version de zlib del sistema.
 *
 * Un ZIP que cambia de bytes al regenerarlo hace inutil la frase "SHA-256 del
 * ZIP": el hash dejaria de identificar el contenido y pasaria a identificar el
 * momento en que se ejecuto el proceso.
 *
 * Aqui: metodo STORE -sin comprimir-, fecha fija 1980-01-01 00:00:00 en todos
 * los miembros, sin campos extra, sin comentarios, sin atributos de sistema.
 * Mismos miembros en el mismo orden, mismos bytes. El CRC-32 lo calcula
 * `node:zlib`, que forma parte de Node desde la v22.2 y por tanto no anade
 * ninguna dependencia.
 *
 * El precio es el tamano: un export de texto sin comprimir ocupa varias veces
 * mas. Se acepta a proposito. Un artefacto de evidencia que se puede verificar
 * byte a byte vale mas que uno pequeno, y quien lo transporte puede comprimirlo
 * por fuera sin tocar lo que se firmo.
 *
 * ---------------------------------------------------------------------------
 * LO QUE ESTE FICHERO NO ES
 * ---------------------------------------------------------------------------
 *
 * No es un implementador general de ZIP. Solo escribe: sin cifrado, sin
 * ZIP64 -y lo dice en voz alta si el paquete lo necesitara-, sin directorios,
 * sin nombres que no sean ASCII. Cada una de esas ausencias es una superficie
 * menos, y todas se comprueban antes de escribir un solo byte.
 */

import { crc32 } from "node:zlib";

import type { ArchivePort, ExportPackageMember } from "./ports.js";

const LOCAL_FILE_HEADER = 0x0403_4b50;
const CENTRAL_DIRECTORY_HEADER = 0x0201_4b50;
const END_OF_CENTRAL_DIRECTORY = 0x0605_4b50;

/** ZIP 2.0: suficiente para STORE, y no promete nada que no cumplamos. */
const VERSION = 20;
const METHOD_STORE = 0;

/**
 * 1980-01-01 00:00:00 en formato MS-DOS.
 *
 * Es el instante mas antiguo representable, y se usa en TODOS los miembros. No
 * es una fecha real ni pretende serlo: la fecha real del artefacto vive en la
 * procedencia, que es donde un auditor debe buscarla, y no en un campo que
 * ademas romperia la reproducibilidad.
 */
const DOS_DATE = 0x0021;
const DOS_TIME = 0x0000;

/** Limite de ZIP sin ZIP64. Por encima habria que cambiar de formato, no de limite. */
const ZIP32_MAX = 0xffff_ffff;
const ZIP32_MAX_ENTRIES = 0xffff;

export const DETERMINISTIC_ZIP_FORMAT = "LSW/EXPORT/ZIP-STORE/v1";

function assertWritable(members: readonly ExportPackageMember[]): void {
  if (members.length === 0) {
    throw new Error("Un paquete de export vacio no se escribe: no hay nada que entregar.");
  }
  if (members.length > ZIP32_MAX_ENTRIES) {
    throw new Error(
      `El paquete tiene ${String(members.length)} miembros y sin ZIP64 el maximo es ` +
        `${String(ZIP32_MAX_ENTRIES)}. Hace falta otro formato, no otro limite.`,
    );
  }

  const seen = new Set<string>();
  for (const member of members) {
    if (!/^[A-Za-z0-9._-]+$/u.test(member.name)) {
      throw new Error(
        `Nombre de miembro no admitido: ${JSON.stringify(member.name)}. Solo ASCII sin rutas: ` +
          "un nombre con separadores o con caracteres fuera de ASCII se interpreta distinto en " +
          "cada sistema, y el destinatario extraeria algo que no es lo que se firmo.",
      );
    }
    if (seen.has(member.name)) {
      throw new Error(`El miembro ${member.name} aparece dos veces en el paquete.`);
    }
    seen.add(member.name);
    if (member.bytes.length > ZIP32_MAX) {
      throw new Error(`El miembro ${member.name} supera el maximo de ZIP sin ZIP64.`);
    }
  }
}

interface CentralEntry {
  readonly name: Buffer;
  readonly crc: number;
  readonly size: number;
  readonly offset: number;
}

/**
 * Escribe el ZIP.
 *
 * El orden de los miembros es el que llega: lo fija quien construye el paquete
 * (`export-package.ts`), y es parte de lo que se hashea. Reordenar aqui -por
 * ejemplo "para que quede alfabetico"- cambiaria los bytes sin cambiar el
 * contenido, que es exactamente lo que este fichero existe para impedir.
 */
export function packDeterministicZip(members: readonly ExportPackageMember[]): Uint8Array {
  assertWritable(members);

  const chunks: Buffer[] = [];
  const central: CentralEntry[] = [];
  let offset = 0;

  for (const member of members) {
    const name = Buffer.from(member.name, "ascii");
    const data = Buffer.from(member.bytes);
    const crc = crc32(data) >>> 0;

    const header = Buffer.alloc(30);
    header.writeUInt32LE(LOCAL_FILE_HEADER, 0);
    header.writeUInt16LE(VERSION, 4);
    header.writeUInt16LE(0, 6); // sin banderas: ni cifrado, ni descriptor de datos
    header.writeUInt16LE(METHOD_STORE, 8);
    header.writeUInt16LE(DOS_TIME, 10);
    header.writeUInt16LE(DOS_DATE, 12);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(data.length, 18);
    header.writeUInt32LE(data.length, 22);
    header.writeUInt16LE(name.length, 26);
    header.writeUInt16LE(0, 28); // sin campos extra

    chunks.push(header, name, data);
    central.push({ name, crc, size: data.length, offset });
    offset += header.length + name.length + data.length;
  }

  const centralStart = offset;
  for (const entry of central) {
    const record = Buffer.alloc(46);
    record.writeUInt32LE(CENTRAL_DIRECTORY_HEADER, 0);
    record.writeUInt16LE(VERSION, 4); // version made by
    record.writeUInt16LE(VERSION, 6); // version needed
    record.writeUInt16LE(0, 8);
    record.writeUInt16LE(METHOD_STORE, 10);
    record.writeUInt16LE(DOS_TIME, 12);
    record.writeUInt16LE(DOS_DATE, 14);
    record.writeUInt32LE(entry.crc, 16);
    record.writeUInt32LE(entry.size, 20);
    record.writeUInt32LE(entry.size, 24);
    record.writeUInt16LE(entry.name.length, 28);
    record.writeUInt16LE(0, 30); // extra
    record.writeUInt16LE(0, 32); // comentario
    record.writeUInt16LE(0, 34); // disco
    record.writeUInt16LE(0, 36); // atributos internos
    record.writeUInt32LE(0, 38); // atributos externos: sin permisos de sistema
    record.writeUInt32LE(entry.offset, 42);

    chunks.push(record, entry.name);
    offset += record.length + entry.name.length;
  }

  const end = Buffer.alloc(22);
  end.writeUInt32LE(END_OF_CENTRAL_DIRECTORY, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(central.length, 8);
  end.writeUInt16LE(central.length, 10);
  end.writeUInt32LE(offset - centralStart, 12);
  end.writeUInt32LE(centralStart, 16);
  end.writeUInt16LE(0, 20);
  chunks.push(end);

  return new Uint8Array(Buffer.concat(chunks));
}

export function createDeterministicZipArchivePort(): ArchivePort {
  return {
    formatId: DETERMINISTIC_ZIP_FORMAT,
    fileExtension: "zip",
    pack: (members) => packDeterministicZip(members),
  };
}
