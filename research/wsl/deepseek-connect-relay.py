import select
import socket
import socketserver
import sys


class Relay(socketserver.BaseRequestHandler):
    def handle(self):
        if self.client_address[0] != self.server.guest:
            return
        self.request.settimeout(8)
        header = bytearray()
        try:
            while b"\r\n\r\n" not in header and len(header) <= 4096:
                part = self.request.recv(512)
                if not part:
                    return
                header.extend(part)
            end = header.find(b"\r\n\r\n")
            first = bytes(header).split(b"\r\n", 1)[0]
            if end < 0 or first not in (
                b"CONNECT api.deepseek.com:443 HTTP/1.1",
                b"CONNECT api.deepseek.com:443 HTTP/1.0",
            ):
                self.request.sendall(b"HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n")
                return
            with socket.create_connection(("127.0.0.1", 7892), timeout=10) as upstream:
                upstream.sendall(b"CONNECT api.deepseek.com:443 HTTP/1.1\r\nHost: api.deepseek.com:443\r\n\r\n")
                if header[end + 4:]:
                    upstream.sendall(header[end + 4:])
                while True:
                    ready, _, _ = select.select([self.request, upstream], [], [], 240)
                    if not ready:
                        return
                    for source in ready:
                        data = source.recv(65536)
                        if not data:
                            return
                        (upstream if source is self.request else self.request).sendall(data)
        except OSError:
            return


class Server(socketserver.ThreadingTCPServer):
    daemon_threads = True


with Server((sys.argv[1], 18792), Relay) as server:
    server.guest = sys.argv[2]
    print("DeepSeek CONNECT relay ready", flush=True)
    server.serve_forever()
