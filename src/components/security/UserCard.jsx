import React from 'react';
import { Crown } from 'lucide-react';
import LoginAvatar from './LoginAvatar';
import { CardBody, CardContainer, CardItem } from '../ui/3d-card';

const toTitleCase = (str) => {
  if (!str) return '';
  // Ajuste 2: "C&Y" siempre en mayúsculas (el title-case lo degradaba a "C&y").
  return str.toLowerCase().split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
    .replace(/\bC&y\b/g, 'C&Y');
};

export default function UserCard({ user, onClick, size = 'lg' }) {
  const isOwner = user.rol === 'DUENO';

  return (
    <div role="button" tabIndex={0} aria-label={`Seleccionar ${user.nombre}`} onClick={onClick}
      onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onClick(); } }}
      className="cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 rounded-2xl active:scale-95 transition-transform duration-200">
      <CardContainer className="inter-var py-0">
        <CardBody className="relative group/card w-auto h-auto rounded-xl p-0 border-transparent bg-transparent">

          <CardItem translateZ="100" rotateX={10} rotateZ={-5} className="w-full flex justify-center">
            <div className="relative">
              <style>{`
                @keyframes rotBGimg {
                  from { transform: rotate(0deg); }
                  to { transform: rotate(360deg); }
                }
              `}</style>

              {/* Fake thickness layers (3D depth) */}
              <div className="absolute inset-0 bg-black/40 rounded-3xl translate-y-4 translate-x-4 blur-xl" />
              <div className={`absolute inset-0 rounded-3xl translate-y-2 translate-x-1 ${isOwner ? 'bg-indigo-500/20' : 'bg-emerald-500/20'}`} />

              {/* Admin Crown */}
              {isOwner && (
                <div className="absolute -top-3 -left-3 z-50 animate-bounce duration-1000">
                  <div className="bg-gradient-to-br from-yellow-300 to-amber-500 p-1.5 rounded-full shadow-[0_0_15px_rgba(251,191,36,0.6)] border border-yellow-100/50">
                    <Crown size={20} className="text-yellow-900 fill-yellow-100" strokeWidth={2.5} />
                  </div>
                </div>
              )}

              {isOwner ? (
                <div className="relative z-10 flex justify-center items-center transition-transform hover:scale-105 duration-300">
                  <LoginAvatar user={user} size={size} className="relative z-10" />
                </div>
              ) : (
                <div className="relative z-10 flex justify-center items-center transition-transform hover:scale-105 duration-300">
                  <LoginAvatar user={user} size={size} className="relative z-10" />
                </div>
              )}
            </div>
          </CardItem>

          {/* Text floating below */}
          <CardItem translateZ="60" className="text-center w-full mt-8 group-hover/card:text-primary transition-colors space-y-1">
            <h3 className="text-lg font-bold text-slate-800 drop-shadow-sm">
              {toTitleCase(user.nombre)}
            </h3>
            <span className={`block text-[9px] font-black uppercase tracking-[0.2em] ${isOwner ? 'text-indigo-600' : 'text-teal-500'}`}>
              {isOwner ? 'Dueño' : 'Cajero'}
            </span>
          </CardItem>

        </CardBody>
      </CardContainer>
    </div>
  );
}
