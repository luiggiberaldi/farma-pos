/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {

        // ─────────────────────────────────────────────────────
        // 🎨 FARMACIA CÉSAR — PALETA SEMÁNTICA OFICIAL
        // Verde farmacéutico (cruz de farmacia)
        // ─────────────────────────────────────────────────────

        // 1. LA MARCA (Acción, Foco, Botones principales)
        primary: {
          DEFAULT: '#086B4D', // Accessible brand action color with white text.
          hover:   '#06573F',
          bright:  '#0AA577',
          light:   '#E8F5F0',
          focus:   '#C3EADC',
          dark:    '#04402E',
        },

        // 2. FONDOS DE PANTALLA
        app: {
          light: '#F8FAFB', // Gris hielo — fondo general
          dark:  '#0F172A', // Azul noche — modo oscuro
        },

        // 3. FONDOS DE TARJETAS / MODALES / SIDEBAR
        surface: {
          light: '#FFFFFF', // Blanco puro
          dark:  '#1E293B', // Slate-800 modo oscuro
        },

        // 4. TEXTOS (Legibilidad)
        content: {
          main:      '#334155', // Slate-700 — Títulos, precios
          secondary: '#64748B', // Slate-500 — Subtítulos, etiquetas
          inverse:   '#F8FAFC', // Texto claro para fondos oscuros
        },

        // 5. ESTADOS SEMÁNTICOS
        status: {
          success:   '#0B8D63', // Verde farmacia — Venta OK
          successBg: '#D1FAE5',
          danger:    '#DC2626', // Rojo — Error, vencidos, borrar
          dangerBg:  '#FEE2E2',
          warning:   '#F59E0B', // Amber — Vence pronto, alertas
          warningBg: '#FEF3C7',
          info:      '#0066CC', // Azul clínico — información
          infoBg:    '#E6F0FF',
        },

        // 6. BORDES Y SEPARADORES
        border: {
          subtle: '#E2E8F0', // Slate-200 — líneas finas
          focus:  '#086B4D', // Brand border for active inputs.
        },

        // Legacy brand token; semantic Tailwind palettes remain distinct.
        brand: {
          light:   '#E8F5F0',
          DEFAULT: '#086B4D',
          dark:    '#06573F',
        },

        // background (viejo token de fondo)
        background: {
          light: '#F8FAFB',
          dark:  '#0F172A',
        },

        // slate (neutros — sin cambios, son la base del sistema)
        slate: {
          50:  '#F8FAFC',
          100: '#F1F5F9',
          200: '#E2E8F0',
          300: '#CBD5E1',
          400: '#94A3B8',
          500: '#64748B',
          600: '#475569',
          700: '#334155',
          800: '#1E293B',
          900: '#0F172A',
          950: '#020617',
        },

        // emerald → success (ventas OK, stock disponible)
        emerald: {
          50:  '#ECFDF5',
          100: '#D1FAE5',
          400: '#34D399',
          500: '#0B8D63',
          600: '#086B4D',
          900: '#064E3B',
        },

        // red → danger (errores, borrar, vencidos)
        red: {
          50:  '#FEF2F2',
          100: '#FEE2E2',
          400: '#F87171',
          500: '#DC2626',
          600: '#B91C1C',
          900: '#7F1D1D',
        },

        // amber → warning (alertas, vencimientos próximos)
        amber: {
          50:  '#FFFBEB',
          100: '#FEF3C7',
          400: '#FBBF24',
          500: '#F59E0B',
          600: '#D97706',
          900: '#78350F',
        },
      },

      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'Menlo', 'Consolas', 'monospace'],
      },

      animation: {
        'fade-in':   'fadeIn 0.3s ease-out',
        'slide-up':  'slideUp 0.4s ease-out',
        'spin-slow': 'spin 1s linear infinite',
      },

      keyframes: {
        fadeIn: {
          '0%':   { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%':   { transform: 'translateY(10px)', opacity: '0' },
          '100%': { transform: 'translateY(0)',    opacity: '1' },
        },
      },
    },
  },
  plugins: [
    function ({ addUtilities }) {
      addUtilities({
        // Tabular nums para precios y tablas financieras
        '.font-numbers': {
          'font-variant-numeric': 'tabular-nums',
          'letter-spacing': '-0.02em',
        },
        // Ocultar scrollbar
        '.scrollbar-hide': {
          '-ms-overflow-style': 'none',
          'scrollbar-width': 'none',
          '&::-webkit-scrollbar': { display: 'none' },
        },
        // Scrollbar personalizado fino
        '.custom-scrollbar': {
          '&::-webkit-scrollbar': { width: '4px', height: '4px' },
          '&::-webkit-scrollbar-track': { backgroundColor: 'transparent' },
          '&::-webkit-scrollbar-thumb': {
            backgroundColor: '#CBD5E1',
            borderRadius: '2px',
          },
        },
      });
    },
  ],
}