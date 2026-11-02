"""Keep native chemistry failures and expensive depictions out of the API process."""
import asyncio
import multiprocessing


class ProcessingError(ValueError):
    pass


def _partial_result(payload):
    from .app import prepare_answer,error_block
    from .answer_format import complete_blocks
    import json
    candidates=[]
    for text in payload:
        blocks=complete_blocks(text)
        if blocks:
            candidate,_=prepare_answer(json.dumps({'blocks':blocks}))
            candidates.append(candidate)
    result=max(candidates,key=lambda blocks:sum(b['type']!='error' for b in blocks),default=[])
    if result:
        result.append(error_block('Part of the model answer was malformed. Only complete, validated parts are shown; retry for a complete answer.'))
    return result


def _run(operation, payload):
    try:
        if operation == 'answer':
            from .app import prepare_answer
            result = prepare_answer(payload)
        elif operation == 'partial':
            result = _partial_result(payload)
        elif operation == 'restore':
            from .app import restored_block
            result = [restored_block(block) for block in payload]
        elif operation == '3d':
            from .chemistry import structure_3d
            result = structure_3d(payload)
        elif operation == 'analysis':
            from .chemistry import analyse
            result = analyse(payload)
        elif operation == 'probe':
            # Used by the native-failure regression, never exposed by an API route.
            import os
            os._exit(17)
        else:
            raise ValueError('Unknown chemistry operation.')
        return ('ok', result)
    except Exception as exc:
        return ('error', str(exc)[:500] if isinstance(exc, ValueError) else 'The structure could not be processed.')


def _serve(connection):
    """A warm worker: RDKit and the answer pipeline are imported once, then jobs run one at a time."""
    from . import app as _warm  # noqa: F401  (the slow imports happen here, before any job)
    while True:
        try:
            job = connection.recv()
        except (EOFError, OSError):
            return
        if job is None:
            return
        connection.send(_run(*job))


class _WarmWorkers:
    """Idle worker processes kept ready. A worker that crashes or times out is killed and replaced,
    so native failures stay isolated exactly as with one process per job."""
    LIMIT = 2

    def __init__(self):
        self.idle = []

    def _spawn(self):
        context = multiprocessing.get_context('spawn')
        parent, child = context.Pipe()
        process = context.Process(target=_serve, args=(child,), daemon=True)
        process.start()
        child.close()
        return process, parent

    def take(self):
        while self.idle:
            worker = self.idle.pop()
            if worker[0].is_alive():
                return worker
        return self._spawn()

    def give(self, worker):
        if worker[0].is_alive() and len(self.idle) < self.LIMIT:
            self.idle.append(worker)
        else:
            self.retire(worker)

    def retire(self, worker):
        process, connection = worker
        if process.is_alive():
            process.kill()
        process.join(1)
        connection.close()

    def prewarm(self, count=1):
        while len([w for w in self.idle if w[0].is_alive()]) < min(count, self.LIMIT):
            self.idle.append(self._spawn())


WORKERS = _WarmWorkers()


def prewarm():
    """Start a worker in the background so the first answer doesn't pay for RDKit's import."""
    try:
        WORKERS.prewarm(1)
    except Exception:
        pass


async def process_chemistry(operation, payload, timeout=25):
    # Plain Markdown, clarifications and invalid JSON need no native code. Avoid
    # starting an RDKit process for a greeting or a formatting-only repair.
    if operation in ('answer','partial'):
        from .answer_format import decode_answer,complete_blocks
        if operation=='answer':
            try:
                decoded=decode_answer(payload)
                blocks=decoded.get('blocks',[]) if isinstance(decoded,dict) else []
            except (ValueError,TypeError):
                blocks=[]
        else:
            blocks=[block for text in payload for block in complete_blocks(text)]
        if not any(isinstance(block,dict) and block.get('type') in ('molecule','reaction','mechanism','resonance') for block in blocks):
            if operation=='partial':
                return _partial_result(payload)
            from .app import prepare_answer
            return prepare_answer(payload)
    worker = WORKERS.take()
    process, connection = worker
    healthy = False
    try:
        connection.send((operation, payload))
        # poll() is nonblocking. Receive the potentially large SVG result off the API loop.
        async def receive():
            while True:
                try:
                    if connection.poll():
                        break
                except (EOFError, OSError) as exc:
                    raise ProcessingError('The structure renderer stopped unexpectedly. Your chat is safe; retry this answer.') from exc
                if not process.is_alive():
                    raise ProcessingError('The structure renderer stopped unexpectedly. Your chat is safe; retry a smaller structure.')
                await asyncio.sleep(0.01)
            try:
                return await asyncio.to_thread(connection.recv)
            except (EOFError, OSError) as exc:
                raise ProcessingError('The structure renderer stopped unexpectedly. Your chat is safe; retry this answer.') from exc
        try:
            status, result = await asyncio.wait_for(receive(), timeout)
        except asyncio.TimeoutError as exc:
            raise ProcessingError('This structure took too long to draw. Try fewer or smaller structures; the chat is still available.') from exc
        healthy = True
        if status != 'ok':
            raise ProcessingError(result)
        return result
    finally:
        if healthy:
            WORKERS.give(worker)
        else:
            await asyncio.to_thread(WORKERS.retire, worker)
        # Keep one warm worker ready for the next job.
        await asyncio.to_thread(WORKERS.prewarm, 1)
