# English: Local HTTP server for browser tests and local Studio development.
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import sys


class Handler(SimpleHTTPRequestHandler):
    # Windows 的系統 MIME 表可能把 ES module 當成純文字，瀏覽器會拒絕載入。
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map, ".mjs": "text/javascript"}


# 手機頁面同時載入多份程式與字型，避免預設佇列滿時重設連線。
class TestServer(ThreadingHTTPServer):
    allow_reuse_address = True
    request_queue_size = 128


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8876
    TestServer(("127.0.0.1", port), Handler).serve_forever()
