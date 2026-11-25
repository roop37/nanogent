import base64
import json
import os
import stat
import sys

request = json.loads(base64.b64decode(sys.argv[1]))
path = request['path']
if '%' in path or '\x00' in path:
    raise ValueError('Encoded or null paths are forbidden')
if not path.startswith('/'):
    path = '/workspace/' + path
path = os.path.normpath(path)
if path != '/workspace' and not path.startswith('/workspace/'):
    raise ValueError('Path escapes /workspace')
parts = path.split('/')[2:]
fd = os.open('/workspace', os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
try:
    for part in parts[:-1]:
        child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
        os.close(fd)
        fd = child
    name = parts[-1] if parts else '.'
    if request['op'] == 'read':
        target = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=fd)
        try:
            mode = os.fstat(target).st_mode
            if stat.S_ISDIR(mode):
                output = '\n'.join(sorted(os.listdir(target)))
                if len(output.encode()) > request['maxBytes']:
                    raise ValueError('Directory exceeds read limit')
                print(output, end='')
            elif stat.S_ISREG(mode):
                data = b''
                while len(data) <= request['maxBytes']:
                    chunk = os.read(target, min(65536, request['maxBytes'] + 1 - len(data)))
                    if not chunk:
                        break
                    data += chunk
                if len(data) > request['maxBytes']:
                    raise ValueError('File exceeds read limit')
                sys.stdout.buffer.write(data)
            else:
                raise ValueError('Only regular files and directories are readable')
        finally:
            os.close(target)
    else:
        target = os.open(name, os.O_WRONLY | os.O_CREAT | os.O_NOFOLLOW | os.O_NONBLOCK, 0o644, dir_fd=fd)
        try:
            if not stat.S_ISREG(os.fstat(target).st_mode):
                raise ValueError('Only regular files are writable')
            os.ftruncate(target, 0)
            data = request['content'].encode()
            while data:
                data = data[os.write(target, data):]
        finally:
            os.close(target)
finally:
    os.close(fd)
