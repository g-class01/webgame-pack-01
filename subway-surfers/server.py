import os, webbrowser
from http.server import HTTPServer, SimpleHTTPRequestHandler

PORT = 8092
DIR = os.path.dirname(os.path.abspath(__file__))

class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIR, **kwargs)

    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Accept-Ranges', 'bytes')
        super().end_headers()

    def guess_type(self, path):
        if path.endswith('.wasm') or path.endswith('.unityweb'): return 'application/wasm'
        if path.endswith('.js'): return 'application/javascript'
        if path.endswith('.data') or path.endswith('.bundle'): return 'application/octet-stream'
        if path.endswith('.mp4'): return 'video/mp4'
        if path.endswith('.ogg'): return 'audio/ogg'
        if path.endswith('.mp3'): return 'audio/mpeg'
        return super().guess_type(path)

def main():
    try:
        httpd = HTTPServer(('127.0.0.1', PORT), Handler)
    except OSError:
        webbrowser.open(f"http://127.0.0.1:{PORT}/index.html")
        return
    url = f"http://127.0.0.1:{PORT}/index.html"
    print(f"[Offline Server] Running at: {url}")
    webbrowser.open(url)
    try: httpd.serve_forever()
    except KeyboardInterrupt: pass

if __name__ == "__main__": main()
