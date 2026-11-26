import base64
import json
import os
import signal
import socket
import subprocess
import sys
import time

root = os.path.dirname(os.path.abspath(__file__))
address = os.path.join(root, 'shell.sock')

if sys.argv[1] == 'once':
    request = base64.b64decode(sys.argv[2])
    subprocess.run([sys.executable, '-u', os.path.join(root, 'shell.py')], input=request + b'\n', check=True)
elif sys.argv[1] == 'serve':
    if os.path.exists(address):
        os.unlink(address)
    server = socket.socket(socket.AF_UNIX)
    server.bind(address)
    os.chmod(address, 0o600)
    server.listen(1)
    child = subprocess.Popen([sys.executable, '-u', os.path.join(root, 'shell.py')], stdin=subprocess.PIPE,
                             stdout=subprocess.PIPE)
    def stop(signum, frame):
        child.stdin.close()
        child.wait(timeout=5)
        sys.exit(0)
    signal.signal(signal.SIGTERM, stop)
    try:
        while True:
            connection, _ = server.accept()
            with connection, connection.makefile('rb') as source:
                request = source.readline(2_000_000)
                child.stdin.write(request)
                child.stdin.flush()
                response = child.stdout.readline()
                if not response:
                    raise RuntimeError('Shell closed')
                try:
                    connection.sendall(response)
                except BrokenPipeError:
                    pass
    finally:
        child.stdin.close()
        child.wait(timeout=5)
        server.close()
else:
    request = base64.b64decode(sys.argv[2])
    options = json.loads(request)
    client = socket.socket(socket.AF_UNIX)
    client.settimeout(options['timeoutSec'] + 5)
    deadline = time.monotonic() + 5
    while True:
        try:
            client.connect(address)
            break
        except (FileNotFoundError, ConnectionRefusedError):
            if time.monotonic() >= deadline:
                raise
            time.sleep(0.02)
    with client, client.makefile('rb') as source:
        client.sendall(request + b'\n')
        response = source.readline(options['maxOutputBytes'] * 6 + 2000)
        sys.stdout.buffer.write(response)
