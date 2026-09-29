import { readFile, writeFile, rm } from "node:fs/promises";
import { resolve, dirname, basename } from "node:path";

const dist = resolve("dist");
let html = await readFile(resolve(dist, "index.html"), "utf8");

const styles = [...html.matchAll(/<link[^>]+href=["']([^"']+\.css)["'][^>]*>/gi)];
for (const [, href] of styles) {
  const file = resolve(dist, href.replace(/^\//, ""));
  const css = await readFile(file, "utf8");
  html = html.replace(new RegExp(`<link[^>]+href=["']${href.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}['"][^>]*>`, "i"), () => `<style>${css}</style>`);
}

const scripts = [...html.matchAll(/<script[^>]+src=["']([^"']+\.js)["'][^>]*><\/script>/gi)];
for (const [, src] of scripts) {
  const file = resolve(dist, src.replace(/^\//, ""));
  // A raw </script> inside a JavaScript string would terminate the HTML
  // element before the browser can execute the bundle.
  const javascript = (await readFile(file, "utf8")).replaceAll("</script", "<\\\\/script");
  html = html.replace(new RegExp(`<script[^>]+src=["']${src.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}['"][^>]*><\\/script>`, "i"), () => `<script type="module">${javascript}</script>`);
}

await writeFile(resolve(dist, "index.html"), html);
for (const entry of [...styles, ...scripts]) await rm(resolve(dist, entry[1].replace(/^\//, "")), { force: true });
try { await rm(resolve(dist, "assets"), { recursive: true, force: true }); } catch {}
console.log(`Created self-contained ${basename(resolve(dist, "index.html"))}`);
