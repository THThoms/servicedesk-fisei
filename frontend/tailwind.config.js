/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Paleta institucional en tonos azules
        uta: {
          50:  "#EFF6FF",
          100: "#DBEAFE",
          300: "#93C5FD",
          500: "#2563EB",
          700: "#1D4ED8",
          900: "#1E3A8A",
        },
        ok: {
          50:  "#D1FAE5",
          900: "#14532D",
        },
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};
