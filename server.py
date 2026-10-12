#!/usr/bin/env python3
"""
Lab Calendar Local Server
Serves the web application on http://127.0.0.1:8000 with CORS and correct MIME types.
Guarantees .js and .mjs files are delivered as 'text/javascript' even if Windows registry is misconfigured.
"""

import http.server
import socketserver
import webbrowser
import sys
import os

PORT = 8000
HOST = "127.0.0.1"
DIRECTORY = os.path.dirname(os.path.abspath(__file__))

class LabCalHTTPRequestHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

    def end_headers(self):
        # Allow cross-origin requests and disable aggressive caching for local dev
        self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

# Explicit MIME type mappings to guarantee execution on Windows
LabCalHTTPRequestHandler.extensions_map.update({
    '.js': 'text/javascript',
    '.mjs': 'text/javascript',
    '.css': 'text/css',
    '.html': 'text/html',
    '.json': 'application/json',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.webmanifest': 'application/manifest+json',
    '.ics': 'text/calendar',
})

def run_server():
    port = PORT
    max_tries = 10
    httpd = None

    for attempt in range(max_tries):
        try:
            httpd = socketserver.TCPServer((HOST, port), LabCalHTTPRequestHandler)
            break
        except OSError:
            print(f"Port {port} is occupied, trying port {port + 1}...")
            port += 1

    if not httpd:
        print("Could not find an available port to start server.")
        sys.exit(1)

    url = f"http://{HOST}:{port}/index.html"
    print("=" * 65)
    print(f"  [LabCal] Lab Calendar Web Application is running at:")
    print(f"  --> {url}")
    print("=" * 65)
    print("  Note: All ES modules and local storage run reliably on this origin.")
    print("  Press Ctrl+C to stop the server.\n")

    # Open browser automatically if not running in headless mode
    if "--no-browser" not in sys.argv:
        try:
            webbrowser.open(url)
        except Exception:
            pass

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping server.")
        httpd.server_close()

if __name__ == "__main__":
    run_server()
