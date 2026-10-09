// Defines button variants and shared button prop types
import { type VariantProps, tv } from 'tailwind-variants';
import type { WithElementRef } from '../../../utils.js';
import type { HTMLAnchorAttributes, HTMLButtonAttributes } from 'svelte/elements';

const baseButtonClasses = [
	'focus-visible:border-ring focus-visible:ring-ring/35 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive dark:aria-invalid:border-destructive/50',
	'rounded-xl border border-transparent bg-clip-padding text-sm font-semibold focus-visible:ring-3 aria-invalid:ring-3 active:not-aria-[haspopup]:translate-y-px',
	"[&_svg:not([class*='size-'])]:size-4 group/button inline-flex shrink-0 items-center justify-center whitespace-nowrap",
	'transition-[background-color,color,border-color,box-shadow,transform] duration-200 outline-none select-none',
	'disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0'
].join(' ');

export const buttonVariants = tv({
	base: baseButtonClasses,
	variants: {
		variant: {
			default: ['bg-primary text-primary-foreground', 'shadow-sm hover:shadow-md'].join(' '),
			outline: [
				'border-border bg-background dark:bg-transparent hover:bg-muted hover:text-foreground',
				'dark:hover:bg-input/30 aria-expanded:bg-muted aria-expanded:text-foreground'
			].join(' '),
			secondary: [
				'bg-secondary text-secondary-foreground hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)]',
				'aria-expanded:bg-secondary aria-expanded:text-secondary-foreground'
			].join(' '),
			ghost: [
				'hover:bg-muted hover:text-foreground dark:hover:bg-muted/50',
				'aria-expanded:bg-muted aria-expanded:text-foreground'
			].join(' '),
			destructive: [
				'bg-destructive/10 hover:bg-destructive/20 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40',
				'dark:bg-destructive/20 text-destructive focus-visible:border-destructive/40 dark:hover:bg-destructive/30'
			].join(' '),
			link: 'text-link underline-offset-4 hover:underline'
		},
		size: {
			default: 'h-10 gap-2 px-4 has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3',
			xs: "h-8 gap-1.5 px-2.5 text-xs [&_svg:not([class*='size-'])]:size-3.5",
			sm: 'h-9 gap-1.5 px-3',
			lg: 'h-11 gap-2 px-5',
			icon: 'size-10',
			'icon-xs': "size-8 [&_svg:not([class*='size-'])]:size-3.5",
			'icon-sm': 'size-9',
			'icon-lg': 'size-11'
		}
	},
	defaultVariants: {
		variant: 'default',
		size: 'default'
	}
});

export type ButtonVariant = VariantProps<typeof buttonVariants>['variant'];
export type ButtonSize = VariantProps<typeof buttonVariants>['size'];

export type ButtonProps = WithElementRef<HTMLButtonAttributes> &
	WithElementRef<HTMLAnchorAttributes> & {
		variant?: ButtonVariant;
		size?: ButtonSize;
	};
