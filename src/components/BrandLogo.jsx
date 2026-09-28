import { useSedeStore } from '../hooks/store/useSedeStore.js';
import { getBranding } from '../config/branding.js';

export default function BrandLogo({ className = '', style, sedeId, onClick }) {
    const activeSedeId = useSedeStore(state => state.sedeActivaId);
    const branding = getBranding(sedeId ?? activeSedeId);

    return (
        <img
            src={branding.logo}
            alt={branding.name}
            draggable={false}
            style={style}
            className={`object-contain select-none ${className}`}
            onClick={onClick}
        />
    );
}