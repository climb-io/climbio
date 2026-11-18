# English: Local HTTP server for browser tests and local Studio development (including /__/album proxy for Google Photos shared albums).
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import re
import sys
import urllib.error
import urllib.parse
import urllib.request

ALBUM_HOSTS = ("photos.app.goo.gl", "photos.google.com", "lh3.googleusercontent.com")


class Handler(SimpleHTTPRequestHandler):
    # Windows 的系統 MIME 表可能把 ES module 當成純文字，瀏覽器會拒絕載入。
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map, ".mjs": "text/javascript"}

    def do_GET(self):
        parsed = urllib.parse.urlsplit(self.path)
        if parsed.path in ("/album", "/__/album"):
            qs = urllib.parse.parse_qs(parsed.query)
            target = (qs.get("url") or [""])[0]
            u = urllib.parse.urlsplit(target)
            if u.scheme != "https" or u.hostname not in ALBUM_HOSTS:
                self.send_error(400, "Invalid album URL")
                return
            try:
                req = urllib.request.Request(target, headers={"User-Agent": "Mozilla/5.0"})
                with urllib.request.urlopen(req, timeout=30) as resp:
                    data = resp.read()
                    ctype = resp.headers.get("Content-Type", "application/octet-stream")
                    cdisp = resp.headers.get("Content-Disposition")
                self.send_response(200)
                self.send_header("Content-Type", ctype)
                self.send_header("Content-Length", str(len(data)))
                if cdisp:
                    self.send_header("Content-Disposition", cdisp)
                self.end_headers()
                self.wfile.write(data)
            except urllib.error.HTTPError as e:
                self.send_error(e.code, str(e.reason))
            except Exception as e:
                self.send_error(502, str(e))
            return
        super().do_GET()


# 手機頁面同時載入多份程式與字型，避免預設佇列滿時重設連線。
class TestServer(ThreadingHTTPServer):
    allow_reuse_address = True
    request_queue_size = 128


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8876
    TestServer(("127.0.0.1", port), Handler).serve_forever()
