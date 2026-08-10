import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

const expectedSha256 =
  "b08c75016f4095e2929289a18a88a74ab95181ed4f8b444798dd563a8f72c9a7";

async function renderRoot() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("redirects the root route to the original calculator file", async () => {
  const response = await renderRoot();
  assert.equal(response.status, 307);
  assert.equal(
    new URL(response.headers.get("location"), "http://localhost/").pathname,
    "/grid-calculator.html",
  );
});

test("publishes the calculator byte-for-byte with its CSP and sandbox intact", async () => {
  const [source, built] = await Promise.all([
    readFile(new URL("../public/grid-calculator.html", import.meta.url)),
    readFile(new URL("../dist/client/grid-calculator.html", import.meta.url)),
  ]);

  assert.deepEqual(built, source);
  assert.equal(createHash("sha256").update(source).digest("hex"), expectedSha256);

  const html = source.toString("utf8");
  assert.match(html, /http-equiv=["']Content-Security-Policy["']/i);
  assert.match(html, /<iframe\b[^>]*\bsandbox=["']allow-scripts["'][^>]*>/i);
});
