"""Bind an OS-assigned loopback port and announce readiness to the Electron parent."""
import json
import multiprocessing
import os
import socket
from pathlib import Path
import uvicorn
from chemez.app import create_app

def main():
    token = os.environ.get('CHEMEZ_TOKEN','')
    directory = os.environ.get('CHEMEZ_DATA_DIR','')
    if len(token) < 32 or not directory:
        raise SystemExit('ChemEZ requires a parent-provided authentication token and data directory.')
    app = create_app(Path(directory),token)
    sock = socket.socket(socket.AF_INET,socket.SOCK_STREAM)
    sock.bind(('127.0.0.1',0))
    sock.listen(128)
    print(json.dumps({'ready':True,'port':sock.getsockname()[1]}),flush=True)
    uvicorn.Server(uvicorn.Config(app,log_level='warning',access_log=False)).run(sockets=[sock])

if __name__ == '__main__':
    multiprocessing.freeze_support()
    main()
