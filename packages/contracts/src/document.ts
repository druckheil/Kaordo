// Defines the bounded rich-text format shared by social posts and encrypted journal entries
import { z } from 'zod';
import type { FluoDocument } from './index.ts';
const mark = z.strictObject({ type: z.enum(['bold', 'italic', 'strike']) });
const inline = z.union([
	z.strictObject({
		type: z.literal('text'),
		text: z.string().max(100000),
		marks: z.array(mark).max(3).optional()
	}),
	z.strictObject({ type: z.literal('hardBreak'), marks: z.array(mark).max(3).optional() })
]);
export const documentSchema = z.strictObject({
	type: z.literal('doc'),
	content: z
		.array(
			z.strictObject({
				type: z.literal('paragraph'),
				content: z.array(inline).max(100000).optional()
			})
		)
		.max(100001)
});
export function documentPlainText(content: FluoDocument): string {
	return content.content
		.map((block) =>
			Array.isArray(block.content)
				? block.content
						.map((part: { type?: string; text?: string }) =>
							part.type === 'hardBreak' ? '\n' : (part.text ?? '')
						)
						.join('')
				: ''
		)
		.join('\n')
		.trim();
}
