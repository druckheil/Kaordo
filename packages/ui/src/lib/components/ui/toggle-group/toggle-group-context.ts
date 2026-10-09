// Shares Rhea toggle-group variants through reactive context

import { createContext } from 'svelte';
import type { ToggleGroupVariants } from './toggle-group-variants.js';

type ToggleGroupContext = Required<ToggleGroupVariants> & {
	spacing: number;
};

export const [getToggleGroupContext, setToggleGroupContext] = createContext<ToggleGroupContext>();
