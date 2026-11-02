# Loading and background-work audit

2026-11-02. Reviewed against the current working tree without removing the warm
chemistry-worker design, provider repair logic or native Electron helper processes.

## Confirmed problems and fixes

- An empty pending answer mounted the lazy answer renderer. Its Suspense fallback
  could appear beside the pending-answer status, producing two preparation messages.
  Empty answers no longer mount it, and its pending fallback is silent. Saved-answer
  loading retains a separate appropriate fallback.
- React dev StrictMode can run startup effects twice. Concurrent configuration,
  startup-history and restoration reads are now coalesced only while in flight.
  Refreshes following mutations remain fresh requests, avoiding stale history. Responses
  are not cached, and late results cannot apply after effect cleanup.
- The existing submission ref now guards the small interval before busy state commits,
  preventing two synchronous submit events from starting two requests.
- Event subscriptions are explicitly cleaned up and callbacks ignore disposed effects.
  The renderer's backdrop listener is disposed during Vite hot replacement.
- A rapid close/reopen of References shares an in-flight lookup instead of issuing
  another identical request.
- Native wallpaper checks no longer overlap when load/focus/resize/poll events coincide.
  Closing the window suppresses late updates and clears polling/debounce timers.
- Scrollbar measurement preserves state objects when the measured geometry is unchanged,
  avoiding unnecessary renders while retaining its scroll/resize/mutation observers.

## Runtime inspection

One Electron app instance, one Python backend and its expected warm chemistry worker
were present. Electron renderer/GPU/network helpers and Python's multiprocessing
resource tracker are purposeful, not duplicate application instances. They were not
blindly terminated. No additional model engine was found. Process inspection does not
prove the absence of every possible future leak.

## Validation

- Dev UI regression: one preparation status, one active stream listener, one initial
  configuration read, coalesced startup history read, and one submission even when
  submit is dispatched twice synchronously. No duplicate loading status observed
  while streaming completes.
- Chat switching and creating a new chat during a running answer remain covered.
- Read coalescing tests ensure failures are evicted, fresh reads remain fresh, and
  separate reads are not combined.
- Native backdrop regression verifies overlapping triggers make one wallpaper query,
  window closure clears polling, and no update is sent after closure.
- These are mock-provider/transport checks, not a live-model chemistry evaluation.

Follow-up hints: reuse a valid model-provided hint when it matches the selected
answer mode instead of requesting another model inference. In-flight hint requests
are shared, and successful hints are retained in a bounded 64-entry per-renderer
cache keyed by conversation, answer ID, mode and command. Mode/context changes still
get the corresponding hint. A UI regression confirms an existing hint produces
zero additional suggestion requests.
