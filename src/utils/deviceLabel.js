// Etiqueta legible automática para la matrícula de equipos ("Chrome · Windows · oct 2026").
// Solo usa el user agent local; nunca sale del dispositivo salvo como label del equipo.
export function deviceLabel(now = new Date()) {
    const ua = typeof navigator !== 'undefined' ? navigator.userAgent || '' : '';
    const browser = /Edg\//.test(ua) ? 'Edge'
        : /OPR\//.test(ua) ? 'Opera'
        : /Chrome\//.test(ua) ? 'Chrome'
        : /Firefox\//.test(ua) ? 'Firefox'
        : /Version\//.test(ua) && /Safari\//.test(ua) ? 'Safari'
        : 'Navegador';
    const os = /Android/.test(ua) ? 'Android'
        : /iPhone|iPad|iPod/.test(ua) ? 'iOS'
        : /Windows/.test(ua) ? 'Windows'
        : /Mac OS/.test(ua) ? 'macOS'
        : /Linux/.test(ua) ? 'Linux'
        : 'Equipo';
    const month = now.toLocaleString('es', { month: 'short' }).replace('.', '');
    const label = `${browser} · ${os} · ${month} ${now.getFullYear()}`;
    return label.length > 120 ? label.slice(0, 120) : label;
}
