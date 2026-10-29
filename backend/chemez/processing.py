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


def _worker(connection, operation, payload):
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
        connection.send(('ok', result))
    except Exception as exc:
        connection.send(('error', str(exc)[:500] if isinstance(exc, ValueError) else 'The structure could not be processed.'))
    finally:
        connection.close()


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
    context = multiprocessing.get_context('spawn')
    reader, writer = context.Pipe(duplex=False)
    worker = context.Process(target=_worker, args=(writer, operation, payload), daemon=True)
    worker.start()
    writer.close()
    try:
        # poll() is nonblocking. Receive the potentially large SVG result off the API loop.
        async def receive():
            while True:
                try:
                    if reader.poll():
                        break
                except (EOFError, OSError) as exc:
                    raise ProcessingError('The structure renderer stopped unexpectedly. Your chat is safe; retry this answer.') from exc
                if not worker.is_alive():
                    raise ProcessingError('The structure renderer stopped unexpectedly. Your chat is safe; retry a smaller structure.')
                await asyncio.sleep(0.025)
            try:
                return await asyncio.to_thread(reader.recv)
            except (EOFError, OSError) as exc:
                raise ProcessingError('The structure renderer stopped unexpectedly. Your chat is safe; retry this answer.') from exc
        try:
            status, result = await asyncio.wait_for(receive(), timeout)
        except asyncio.TimeoutError as exc:
            raise ProcessingError('This structure took too long to draw. Try fewer or smaller structures; the chat is still available.') from exc
        if status != 'ok':
            raise ProcessingError(result)
        return result
    finally:
        if worker.is_alive():
            worker.terminate()
        await asyncio.to_thread(worker.join, 2)
        if worker.is_alive():
            worker.kill()
            await asyncio.to_thread(worker.join, 1)
        reader.close()
