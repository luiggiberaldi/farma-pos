import React from 'react';

const AVATAR_COLORS = {
  DUENO: {
    bg: 'bg-gradient-to-b from-indigo-500 to-violet-600 border-t-2 border-indigo-300 shadow-[0_6px_0_#4338ca,_0_12px_25px_rgba(79,70,229,0.4)]',
    text: 'text-white font-black'
  },
  CAJERO: { 
    bg: 'bg-gradient-to-b from-teal-400 to-teal-500 border-t-2 border-teal-300 shadow-[0_6px_0_#0f766e,_0_12px_25px_rgba(20,184,166,0.4)]', 
    text: 'text-white font-black' 
  },
};

export default function LoginAvatar({ user, size = 'lg', className = '' }) {
  const initial = (user?.nombre || 'U').charAt(0).toUpperCase();
  const colors = AVATAR_COLORS[user?.rol] || AVATAR_COLORS.CAJERO;
  const sizeClasses = size === 'lg' ? 'w-24 h-24 sm:w-28 sm:h-28 text-4xl sm:text-5xl' : 'w-10 h-10 text-base';

  return (
    <div className={`${sizeClasses} rounded-[1.25rem] sm:rounded-[1.5rem] ${colors.bg} flex items-center justify-center ${colors.text} select-none transition-all ${className}`}>
      {initial}
    </div>
  );
}
