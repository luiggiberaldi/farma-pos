export const LogoIcon = ({ className = 'w-10 h-10' }) => {
  return (
    <svg
      viewBox="0 0 64 64"
      alt="Farma POS"
      className={`object-contain select-none ${className}`}
      draggable={false}
      aria-label="Farma POS"
    >
      <circle cx="32" cy="32" r="30" fill="#0B8D63" />
      <circle cx="32" cy="32" r="30" fill="none" stroke="#086B4D" strokeWidth="2" />
      <rect x="26" y="12" width="12" height="40" rx="3.5" fill="#FFFFFF" />
      <rect x="12" y="26" width="40" height="12" rx="3.5" fill="#FFFFFF" />
    </svg>
  );
};

export const LogoFull = ({ className = '', height = 56 }) => {
  return (
    <div className={`flex items-center justify-center gap-3 ${className}`}>
      <LogoIcon className="shrink-0" />
      <div className="flex flex-col leading-none">
        <span className="text-xl font-black tracking-tight text-[#334155]">
          Farma <span className="text-[#0B8D63]">POS</span>
        </span>
        <span className="text-[9px] font-bold uppercase tracking-[0.25em] text-[#086B4D]">
          Sistema Multi-Sede
        </span>
      </div>
    </div>
  );
};
export const LogoWordmark = ({ className = '' }) => {
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <LogoIcon className="w-8 h-8" />
      <div className="flex flex-col leading-none">
        <span className="text-base font-black tracking-tight text-[#334155]">
          Farma <span className="text-[#0B8D63]">POS</span>
        </span>
        <span className="text-[8px] font-bold uppercase tracking-[0.25em] text-[#086B4D]">
          Sistema Multi-Sede
        </span>
      </div>
    </div>
  );
};

export default LogoFull;
