// The worker-SIDE script. `@pierre/diffs/worker` is the main-thread pool API
// (WorkerPoolManager) and registers no message handler — importing that here
// leaves the pool waiting forever and every diff renders as an empty element.
import '@pierre/diffs/worker/worker.js';
