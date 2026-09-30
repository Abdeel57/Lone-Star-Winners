/** En quien confia la API para saber la IP del visitante (DEC-061). */

import { describe, expect, it } from "vitest";

import {
  isPrivateNetworkAddress,
  maskAddress,
  trustImmediatePrivatePeer,
} from "../src/http/trusted-proxy.js";

describe("isPrivateNetworkAddress", () => {
  it("reconoce las redes privadas, la de Railway (fd..) incluida", () => {
    for (const address of [
      "10.0.0.5",
      "172.20.1.1",
      "192.168.1.10",
      "100.64.3.4",
      "127.0.0.1",
      "::1",
      "fd12:3456:789a::1",
      "::ffff:10.0.0.5",
    ]) {
      expect(isPrivateNetworkAddress(address), address).toBe(true);
    }
  });

  it("no confunde una IP publica con una privada", () => {
    for (const address of ["203.0.113.7", "8.8.8.8", "172.32.0.1", "2001:db8::1", "no-es-ip"]) {
      expect(isPrivateNetworkAddress(address), address).toBe(false);
    }
  });
});

describe("trustImmediatePrivatePeer", () => {
  it("confia solo en el salto inmediato, y solo si es privado", () => {
    expect(trustImmediatePrivatePeer("10.0.0.5", 0)).toBe(true);
    expect(trustImmediatePrivatePeer("10.0.0.5", 1)).toBe(false);
    expect(trustImmediatePrivatePeer("203.0.113.7", 0)).toBe(false);
  });
});

describe("maskAddress", () => {
  it("no deja la IP entera en el log", () => {
    expect(maskAddress("203.0.113.7")).toBe("203.0.x.x");
    expect(maskAddress("::ffff:203.0.113.7")).toBe("203.0.x.x");
    expect(maskAddress("2001:db8:1:2::9")).toBe("2001:db8:x");
    expect(maskAddress("basura")).toBe("desconocida");
  });
});
