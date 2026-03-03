import starlightPlugin from "@astrojs/starlight-tailwind";

export default {
  content: ["./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}"],
  theme: {
    extend: {
      colors: {
        accent: {
          200: "#b9a0fa",
          600: "#8B5CF6",
          900: "#3b1d8e",
          950: "#2a1566",
        },
        gray: {
          100: "#f3f4f8",
          200: "#e3e5ec",
          300: "#c0c3ce",
          400: "#888da2",
          500: "#555a6e",
          700: "#353849",
          800: "#232536",
          900: "#17182b",
        },
        "claw-purple": "#8B5CF6",
        "claw-green": "#10B981",
        "claw-cyan": "#06B6D4",
        "claw-pink": "#EC4899",
      },
      fontFamily: {
        sans: ['"Inter"', "system-ui", "sans-serif"],
        mono: ['"JetBrains Mono"', '"Fira Code"', "monospace"],
      },
    },
  },
  plugins: [starlightPlugin()],
};
