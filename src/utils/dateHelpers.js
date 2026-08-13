export function getLocalISODate(d = new Date()) {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

export function getLocalISOTime(d = new Date()) {
    const hours = String(d.getHours()).padStart(2, '0');
    const minutes = String(d.getMinutes()).padStart(2, '0');
    return `${hours}:${minutes}`;
}

export function getDateRange(rangeId) {
    const now = new Date();
    const todayStr = getLocalISODate(now);

    switch (rangeId) {
        case 'today': {
            return { from: todayStr, to: todayStr };
        }
        case 'week': {
            const d = new Date(now);
            d.setDate(d.getDate() - d.getDay()); // domingo
            return { from: getLocalISODate(d), to: todayStr };
        }
        case 'month': {
            const d = new Date(now.getFullYear(), now.getMonth(), 1);
            return { from: getLocalISODate(d), to: todayStr };
        }
        case 'lastMonth': {
            const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
            const end = new Date(now.getFullYear(), now.getMonth(), 0);
            return { from: getLocalISODate(d), to: getLocalISODate(end) };
        }
        default:
            return { from: todayStr, to: todayStr };
    }
}
