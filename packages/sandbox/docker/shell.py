import json
import os
import selectors
import shlex
import signal
import subprocess
import sys
import time
import uuid

shell = None

def stop():
    global shell
    if shell is not None:
        try:
            os.killpg(shell.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        except PermissionError:
            # macOS sandboxing can return EPERM for an already-exited process group.
            if sys.platform != "darwin" or shell.poll() is None:
                raise
        shell.wait()
        shell = None

def start():
    global shell
    os.makedirs('/tmp/home', exist_ok=True)
    shell = subprocess.Popen(['/bin/bash', '--noprofile', '--norc'], stdin=subprocess.PIPE,
                             stdout=subprocess.PIPE, stderr=subprocess.STDOUT, start_new_session=True)

try:
    for line in sys.stdin:
        request = json.loads(line)
        if request.get('restart'):
            stop()
        if shell is None:
            start()
        command = request.get('command')
        if command is None:
            print(json.dumps(dict(exitCode=0, stdout='Bash session restarted.', stderr='', timedOut=False, truncated=False)), flush=True)
            continue
        token = ('\nNANOGENT_' + uuid.uuid4().hex + ':').encode()
        source = 'eval -- ' + shlex.quote(command) + '\n' + "builtin printf '\\n" + token.decode().strip() + "%s\\n' \"$?\"\n"
        shell.stdin.write(source.encode())
        shell.stdin.flush()
        cap = request['maxOutputBytes']
        head = bytearray()
        tail = bytearray()
        total = 0
        pending = b''
        end = time.monotonic() + request['timeoutSec']
        timed_out = False
        code = None
        selector = selectors.DefaultSelector()
        selector.register(shell.stdout, selectors.EVENT_READ)
        def collect(data):
            global total
            total += len(data)
            if len(head) < cap:
                head.extend(data[:cap-len(head)])
            tail.extend(data)
            if len(tail) > cap:
                del tail[:-cap]
        while True:
            remaining = end - time.monotonic()
            if remaining <= 0:
                timed_out = True
                break
            ready = selector.select(remaining)
            if not ready:
                timed_out = True
                break
            data = os.read(shell.stdout.fileno(), 8192)
            if not data:
                break
            pending += data
            pos = pending.find(token)
            if pos >= 0 and b'\n' in pending[pos+len(token):]:
                collect(pending[:pos])
                try:
                    code = int(pending[pos+len(token):].split(b'\n', 1)[0])
                except ValueError:
                    code = None
                pending = b''
                break
            keep = len(token) + 32
            if len(pending) > keep:
                collect(pending[:-keep])
                pending = pending[-keep:]
        selector.close()
        collect(pending)
        if timed_out or code is None:
            stop()
            start()
            collect(b'\nBash session terminated and restarted.\n')
        truncated = total > cap
        if truncated:
            marker = b'\n[truncated]\n'
            available = max(0, cap-len(marker))
            output = bytes(head[:(available+1)//2]) + marker + (bytes(tail[-(available//2):]) if available//2 else b'')
            if cap < len(marker):
                output = b'.' * cap
        else:
            output = bytes(head)
        # Drop partial UTF-8 characters at truncation boundaries.
        print(json.dumps(dict(exitCode=code, stdout=output.decode('utf8', errors='ignore'), stderr='', timedOut=timed_out, truncated=truncated)), flush=True)
finally:
    stop()
