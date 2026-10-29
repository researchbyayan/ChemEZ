import {existsSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export const python = path.join(root,'.venv',process.platform==='win32'?'Scripts/python.exe':'bin/python');

const nativeRuntime=path.join(root,'build/runtime-venv',process.platform==='win32'?'Scripts/python.exe':'bin/python');
export const runtimePython=process.env.CHEMEZ_BUILD_PYTHON||(existsSync(nativeRuntime)?nativeRuntime:python);
