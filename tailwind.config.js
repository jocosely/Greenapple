/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Inter", "system-ui", "Segoe UI", "sans-serif"]
      },
      colors: {
        ghost: {
          green: "#00FF9C",
          bg: "#0D0D0D",
          land: "#1A1A1A"
        }
      },
      boxShadow: {
        glass: "0 18px 60px rgba(0,0,0,0.45)"
      }
    }
  },
  plugins: []
};
