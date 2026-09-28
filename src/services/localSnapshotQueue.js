const queues = new Map();
const namespace = context => JSON.stringify([context.accountId, context.sedeId]);

// Shared across provider instances in this tab. It is an ordering barrier, not
// a cross-tab lock or a multi-record database transaction.
export function enqueueSnapshotWrite(context, write) {
    const key = namespace(context);
    const task = (queues.get(key) || Promise.resolve()).catch(() => {}).then(write);
    queues.set(key, task);
    task.finally(() => { if (queues.get(key) === task) queues.delete(key); }).catch(() => {});
    return task;
}

export async function drainSnapshotWrites(context) {
    const key = namespace(context);
    let pending;
    while ((pending = queues.get(key))) {
        await pending.catch(() => {});
        if (queues.get(key) === pending) return;
    }
}
