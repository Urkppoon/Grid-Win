import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render(pathname = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}-${pathname}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request(`http://localhost${pathname}`, { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("redirects the root route to the sandboxed calculator", async () => {
  const response = await render();
  assert.equal(response.status, 307);
  assert.equal(new URL(response.headers.get("location"), "http://localhost/").pathname, "/grid-calculator.html");
});

test("keeps the public calculator wrapper sandboxed with a restrictive CSP", async () => {
  const [html, embedded] = await Promise.all([
    readFile(new URL("../public/grid-calculator.html", import.meta.url), "utf8"),
    readFile(new URL("../public/calculator-embedded.html", import.meta.url), "utf8"),
  ]);
  assert.match(html, /http-equiv="Content-Security-Policy"/i);
  assert.match(html, /default-src 'none'/i);
  assert.match(html, /<iframe\b[^>]*\bsandbox="allow-scripts"[^>]*>/i);
  assert.match(html, /src="\/calculator-embedded\.html"/i);
  assert.doesNotMatch(html, /allow-same-origin/i);
  assert.match(embedded, /script-src 'unsafe-inline'/i);
  assert.doesNotMatch(embedded, /<script\s+src=/i);
  assert.doesNotMatch(embedded, /<link\b[^>]*stylesheet/i);
});

test("renders the T+1 calculator route", async () => {
  const response = await render("/calculator");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /grid win · A股 T\+1 网格设计/);
  assert.match(html, /单边行情承受力/);
  assert.match(html, /昨日可卖底仓/);
});
