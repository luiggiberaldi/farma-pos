import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { logEvent } from '../../services/auditService';

// ─── PIN Hashing (SHA-256 via Web Crypto) ───────────────────────────────────
export async function hashPin(pin) {
    const encoder = new TextEncoder();
    const data = encoder.encode(String(pin));
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hashBuffer))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
}

const DEFAULT_USERS = [
    { id: 1, nombre: 'Administrador', rol: 'ADMIN', pin: '123456', pinHashed: false },
    { id: 2, nombre: 'Cajero', rol: 'CAJERO', pin: '0000', pinHashed: false }
];

export const useAuthStore = create(
    persist(
        (set, get) => ({
            usuarioActivo: (() => {
                try {
                    const saved = localStorage.getItem('abasto-device-session');
                    return saved ? JSON.parse(saved) : null;
                } catch { return null; }
            })(),
            usuarios: DEFAULT_USERS,
            requireLogin: false, // Login opcional, por defecto desactivado
            adminEmail: '',
            adminPassword: '',


            // ACCIONES
            login: async (pinInput, userId) => {
                // Simular un pequeño retardo para feedback visual (UX)
                await new Promise(r => setTimeout(r, 400));

                const { usuarios } = get();
                const hashedInput = await hashPin(pinInput);

                let userEncontrado = null;
                let needsMigration = false;

                const candidates = userId
                    ? usuarios.filter(u => u.id === userId)
                    : usuarios;

                for (const u of candidates) {
                    const matches = u.pinHashed
                        ? u.pin === hashedInput
                        : u.pin === String(pinInput);

                    if (matches) {
                        userEncontrado = u;
                        // Si el PIN es texto plano, migrarlo a hash
                        if (!u.pinHashed) needsMigration = true;
                        break;
                    }
                }

                if (userEncontrado) {
                    // Migrar PIN a hash silenciosamente
                    if (needsMigration) {
                        set(state => ({
                            usuarios: state.usuarios.map(u =>
                                u.id === userEncontrado.id
                                    ? { ...u, pin: hashedInput, pinHashed: true }
                                    : u
                            )
                        }));
                    }
                    const sessionUser = { ...userEncontrado, pin: undefined, pinHashed: undefined };
                    set({ usuarioActivo: sessionUser });
                    localStorage.setItem('abasto-device-session', JSON.stringify(sessionUser));
                    logEvent('AUTH', 'LOGIN', `${userEncontrado.nombre} inicio sesion`, sessionUser);
                    return true;
                }

                return false;
            },

            // Acceso de emergencia (modal oculto de la pantalla de bloqueo):
            // inicia sesión como el primer ADMIN sin PIN. La validación de la
            // clave maestra ocurre en SuperAdminModal antes de llamar esto.
            loginAsSuperAdmin: () => {
                const { usuarios } = get();
                const admin = usuarios.find(u => u.rol === 'ADMIN');
                if (!admin) return false;
                const sessionUser = { ...admin, pin: undefined, pinHashed: undefined };
                set({ usuarioActivo: sessionUser });
                localStorage.setItem('abasto-device-session', JSON.stringify(sessionUser));
                logEvent('AUTH', 'SUPER_ADMIN_LOGIN', `Acceso super admin como ${admin.nombre}`, sessionUser);
                return true;
            },

            // Restaura los PINs de fábrica (ADMIN: 123456, resto: 0000)
            resetPinsToDefault: async () => {
                const adminPin = await hashPin('123456');
                const otherPin = await hashPin('0000');
                set(state => ({
                    usuarios: state.usuarios.map(u => ({
                        ...u,
                        pin: u.rol === 'ADMIN' ? adminPin : otherPin,
                        pinHashed: true,
                    }))
                }));
                logEvent('AUTH', 'PINS_RESETEADOS', 'PINs restaurados a valores de fábrica (super admin)');
            },

            logout: () => {
                const { usuarioActivo } = get();
                if (usuarioActivo) logEvent('AUTH', 'LOGOUT', `${usuarioActivo.nombre} cerro sesion`, usuarioActivo);
                set({ usuarioActivo: null });
                localStorage.removeItem('abasto-device-session');
            },

            cambiarPin: async (userId, nuevoPin) => {
                const hashed = await hashPin(nuevoPin);
                set((state) => ({
                    usuarios: state.usuarios.map(u =>
                        u.id === userId ? { ...u, pin: hashed, pinHashed: true } : u
                    )
                }));

                // Si el usuario que cambió el PIN es el activo, su sesión no cambia (no guardamos pin en sesión)
                const target = get().usuarios.find(u => u.id === userId);
                logEvent('AUTH', 'PIN_CAMBIADO', `PIN cambiado para ${target?.nombre || 'usuario'}`, get().usuarioActivo);
            },

            agregarUsuario: async (nombre, rol, pin) => {
                const hashed = await hashPin(pin);
                set((state) => {
                    const maxId = state.usuarios.reduce((max, u) => Math.max(max, u.id), 0);
                    return {
                        usuarios: [...state.usuarios, { id: maxId + 1, nombre, rol, pin: hashed, pinHashed: true }]
                    };
                });
                logEvent('USUARIO', 'USUARIO_CREADO', `Usuario "${nombre}" (${rol}) creado`, get().usuarioActivo);
            },

            eliminarUsuario: (userId) => {
                const { usuarios, usuarioActivo } = get();
                // No permitir eliminar al último ADMIN
                const admins = usuarios.filter(u => u.rol === 'ADMIN');
                const target = usuarios.find(u => u.id === userId);
                if (target?.rol === 'ADMIN' && admins.length <= 1) return false;
                // No permitir eliminarse a sí mismo
                if (usuarioActivo?.id === userId) return false;
                
                set({ usuarios: usuarios.filter(u => u.id !== userId) });
                logEvent('USUARIO', 'USUARIO_ELIMINADO', `Usuario "${target.nombre}" (${target.rol}) eliminado`, usuarioActivo);
                return true;
            },

            editarUsuario: (userId, datos) => {
                set((state) => ({
                    usuarios: state.usuarios.map(u => 
                        u.id === userId ? { ...u, ...datos } : u
                    )
                }));
                const { usuarioActivo } = get();
                if (usuarioActivo && usuarioActivo.id === userId) {
                    const nuevoActivo = { ...usuarioActivo, ...datos };
                    set({ usuarioActivo: nuevoActivo });
                    localStorage.setItem('abasto-device-session', JSON.stringify(nuevoActivo));
                }
            },

            setRequireLogin: (val) => {
                set({ requireLogin: val });
                logEvent('CONFIG', 'LOGIN_REQUERIDO_MODIFICADO', `Login requerido establecido a ${val ? 'SI' : 'NO'}`);
            },

            setAdminCredentials: (email, password) => {
                set({ adminEmail: email, adminPassword: password });
                logEvent('CONFIG', 'CREDENCIALES_REMOTAS_ESTABLECIDAS', `Se ha registrado el acceso remoto para la cuenta administradora.`);
            }
        }),
        {
            name: 'abasto-auth-storage', // Nombre para localStorage
            version: 2,
            migrate: (persistedState, fromVersion) => {
                // v0 → v1: admin PIN cambia de 4 a 6 dígitos (1234 → 123456)
                if (fromVersion < 1 && persistedState?.usuarios) {
                    persistedState.usuarios = persistedState.usuarios.map(u =>
                        u.rol === 'ADMIN' && u.pin === '1234'
                            ? { ...u, pin: '123456' }
                            : u
                    );
                }
                // v1 → v2: marcar todos los PINs como plaintext para migración lazy en login
                if (fromVersion < 2 && persistedState?.usuarios) {
                    persistedState.usuarios = persistedState.usuarios.map(u =>
                        u.pinHashed === undefined ? { ...u, pinHashed: false } : u
                    );
                }
                return persistedState;
            },
            partialize: (state) => ({
                usuarios: state.usuarios,
                requireLogin: state.requireLogin,
                adminEmail: state.adminEmail,
                adminPassword: state.adminPassword
            }),
            storage: {
                getItem: (name) => {
                    const str = localStorage.getItem(name);
                    if (!str) return null;
                    try { return JSON.parse(str); } catch (e) { return null; }
                },
                setItem: (name, value) => {
                    localStorage.setItem(name, JSON.stringify(value));
                    // Disparar a la nube para P2P (Lazy import para evitar ciclos)
                    import('../useCloudSync').then(({ pushCloudSync }) => {
                        pushCloudSync(name, value);
                    }).catch(err => console.warn('No se pudo inyectar Auth Cloud', err));
                },
                removeItem: (name) => localStorage.removeItem(name)
            }
        }
    )
);
