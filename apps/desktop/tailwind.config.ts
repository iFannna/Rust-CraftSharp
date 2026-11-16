import type { Config } from "tailwindcss";
import animate from "tailwindcss-animate";

export default {
  darkMode: ["class"],
  content: ["./pages/**/*.html", "./src/**/*.{ts,tsx}"],
  theme: {
  	extend: {
  		colors: {
  			border: 'hsl(var(--border))',
  			input: 'hsl(var(--input))',
  			ring: 'hsl(var(--ring))',
  			background: 'hsl(var(--background))',
  			foreground: 'hsl(var(--foreground))',
  			primary: {
  				DEFAULT: 'hsl(var(--primary))',
  				foreground: 'hsl(var(--primary-foreground))'
  			},
  			secondary: {
  				DEFAULT: 'hsl(var(--secondary))',
  				foreground: 'hsl(var(--secondary-foreground))'
  			},
  			destructive: {
  				DEFAULT: 'hsl(var(--destructive))',
  				foreground: 'hsl(var(--destructive-foreground))'
  			},
  			muted: {
  				DEFAULT: 'hsl(var(--muted))',
  				foreground: 'hsl(var(--muted-foreground))'
  			},
  			accent: {
  				DEFAULT: 'hsl(var(--accent))',
  				foreground: 'hsl(var(--accent-foreground))'
  			},
  			popover: {
  				DEFAULT: 'hsl(var(--popover))',
  				foreground: 'hsl(var(--popover-foreground))'
  			},
  			card: {
  				DEFAULT: 'hsl(var(--card))',
  				foreground: 'hsl(var(--card-foreground))'
  			}
  		},
  		borderRadius: {
  			lg: 'var(--radius)',
  			md: 'calc(var(--radius) - 2px)',
  			sm: 'calc(var(--radius) - 4px)'
  		},
  		fontSize: {
  			xs: [
  				'calc(var(--ui-font, 14px) - 2px)',
  				{
  					lineHeight: '1.4'
  				}
  			],
  			sm: [
  				'var(--ui-font, 14px)',
  				{
  					lineHeight: '1.45'
  				}
  			],
  			base: [
  				'calc(var(--ui-font, 14px) + 1px)',
  				{
  					lineHeight: '1.5'
  				}
  			],
  			lg: [
  				'calc(var(--ui-font, 14px) + 3px)',
  				{
  					lineHeight: '1.4'
  				}
  			],
  			xl: [
  				'calc(var(--ui-font, 14px) + 6px)',
  				{
  					lineHeight: '1.3'
  				}
  			],
  			'2xl': [
  				'calc(var(--ui-font, 14px) + 10px)',
  				{
  					lineHeight: '1.25'
  				}
  			]
  		},
  		keyframes: {
  			'accordion-down': {
  				from: {
  					height: '0'
  				},
  				to: {
  					height: 'var(--radix-accordion-content-height)'
  				}
  			},
  			'accordion-up': {
  				from: {
  					height: 'var(--radix-accordion-content-height)'
  				},
  				to: {
  					height: '0'
  				}
  			}
  		},
  		animation: {
  			'accordion-down': 'accordion-down 0.2s cubic-bezier(0.2, 0, 0, 1)',
  			'accordion-up': 'accordion-up 0.2s cubic-bezier(0.2, 0, 0, 1)'
  		}
  	}
  },
  plugins: [animate]
} satisfies Config;
