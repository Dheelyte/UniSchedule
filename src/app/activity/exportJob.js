'use client';

// The export being built in this tab, kept outside React so it carries on when
// the modal closes (or you move to another page and come back).
//
// Up to 50,000 rows the file downloads as soon as it's ready. Above that it
// runs as a background job with progress, and ends with a download link.
// Closing or reloading the tab while either runs asks for confirmation.

let job = null;
let nextId = 1;
const listeners = new Set();

function emit() {
    for (const listener of listeners) listener();
}

export function getJob() {
    return job;
}

export function subscribeJob(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

function warnBeforeLeaving(event) {
    event.preventDefault();
    // Older browsers show the prompt only when returnValue is set.
    event.returnValue = '';
}

export function saveFile(url, fileName) {
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
}

export function isRunning() {
    return job?.status === 'running';
}

/**
 * Start a job. `task({ signal, onProgress })` resolves to { fileName, type, chunks }.
 * Resolves to the finished job.
 */
export function runJob({ fileName, total, background, task }) {
    if (isRunning()) return Promise.reject(new Error('An export is already being built. Wait for it to finish or cancel it.'));
    if (job?.url) URL.revokeObjectURL(job.url);
    const controller = new AbortController();
    const id = nextId++;
    job = { id, status: 'running', fileName, total, done: 0, background, controller };
    window.addEventListener('beforeunload', warnBeforeLeaving);
    emit();

    const update = (patch) => {
        if (job?.id !== id) return;
        job = { ...job, ...patch };
        emit();
    };

    return task({ signal: controller.signal, onProgress: (done, of) => update({ done, total: of }) })
        .then((file) => {
            const url = URL.createObjectURL(new Blob(file.chunks, { type: file.type }));
            update({ status: 'done', url, fileName: file.fileName, done: job?.total ?? 0 });
            if (!background) saveFile(url, file.fileName);
        })
        .catch((error) => {
            if (error?.name === 'AbortError') update({ status: 'cancelled' });
            else update({ status: 'error', message: error?.message || 'The export failed.' });
        })
        .finally(() => {
            window.removeEventListener('beforeunload', warnBeforeLeaving);
            return job;
        })
        .then(() => job);
}

export function cancelJob() {
    job?.controller?.abort();
}

export function dismissJob() {
    if (isRunning()) return;
    if (job?.url) URL.revokeObjectURL(job.url);
    job = null;
    emit();
}
