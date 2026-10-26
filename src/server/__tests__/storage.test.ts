import assert from "node:assert/strict";
import { test } from "bun:test";

import { bodyTooBig, imageType } from "~/server/storage";

const bytes = (...parts: (string | number[])[]) =>
  new Uint8Array(parts.flatMap((p) => (typeof p === "string" ? [...p].map((c) => c.charCodeAt(0)) : p)));

test("imageType trusts magic bytes, not names or claims", () => {
  assert.equal(imageType(bytes([0x89], "PNG\r\n")), "image/png");
  assert.equal(imageType(bytes([0xff, 0xd8, 0xff, 0xe0])), "image/jpeg");
  assert.equal(imageType(bytes("GIF89a")), "image/gif");
  assert.equal(imageType(bytes("RIFF", [0, 0, 0, 0], "WEBPVP8 ")), "image/webp");
  assert.equal(imageType(bytes("<svg xmlns=")), null);
  assert.equal(imageType(bytes("<html><script>")), null);
  assert.equal(imageType(new Uint8Array()), null);
});

test("bodyTooBig rejects oversized and length-less uploads", () => {
  const req = (len?: number) => new Request("http://x", { method: "POST", headers: len === undefined ? {} : { "content-length": String(len) } });
  assert.equal(bodyTooBig(req(1000), 2000), false);
  assert.equal(bodyTooBig(req(2000 + 64 * 1024 + 1), 2000), true);
  assert.equal(bodyTooBig(req(), 2000), true);
});
