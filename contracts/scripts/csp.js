// npm run csp   (run after editing the inline <script> in index.html)
// Rewrites the script-src hashes in _headers so the browser only runs our own scripts: the in-wallet game key lives
// in localStorage, and an injected script could take it. Inline scripts are allowed by their exact sha256 only.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.join(__dirname, "..", "..");

/** sha256 of each inline <script> (no src) in the page, in CSP form. Git stores and Cloudflare serves the page with
 *  LF line endings (a Windows checkout may have CRLF), so the hash is taken over LF. */
function inlineHashes(html) {
  html = html.replace(/\r\n/g, "\n");
  const out = [];
  for (const m of html.matchAll(/<script(\s[^>]*)?>([\s\S]*?)<\/script>/gi)) {
    if (/\ssrc\s*=/.test(m[1] || "")) continue;
    out.push(`'sha256-${crypto.createHash("sha256").update(m[2], "utf8").digest("base64")}'`);
  }
  return out;
}

const HOSTS = "https://cdnjs.cloudflare.com https://esm.sh https://challenges.cloudflare.com";
const scriptSrc = (hashes) => `script-src 'self' ${hashes.join(" ")} ${HOSTS}`;

function update(root = ROOT) {
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const file = path.join(root, "_headers");
  const src = fs.readFileSync(file, "utf8");
  const next = src.replace(/script-src [^;\n]*/g, scriptSrc(inlineHashes(html)));
  fs.writeFileSync(file, next);
  return next !== src;
}

if (require.main === module) console.log(update() ? "Đã cập nhật script-src trong _headers." : "_headers đã khớp, không đổi.");

module.exports = { inlineHashes, scriptSrc, update };
