module.exports = {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        night: {
          500: '#2d3b58',
          600: '#24304a',
          700: '#1a2438',
          800: '#131b2c',
          850: '#0f1626',
          900: '#0b101d',
          950: '#070a13'
        },
        steam: {
          DEFAULT: '#66c0f4',
          dim: '#4a9fd8',
          deep: '#1b2838'
        },
        grape: {
          DEFAULT: '#7c5cff',
          soft: '#a78bfa'
        }
      },
      fontFamily: {
        sans: ['"Segoe UI"', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['"Cascadia Code"', 'Consolas', '"Courier New"', 'monospace']
      },
      animation: {
        'pulse-slow': 'pulse 2.4s cubic-bezier(0.4, 0, 0.6, 1) infinite'
      }
    }
  },
  plugins: []
};
