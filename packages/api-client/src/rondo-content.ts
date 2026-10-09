// Opens signed community names and prepares member-encrypted metadata and LiveKit keys
import type { RondoServer, RondoChannel, RondoDetail } from '@kaordo/contracts';
import { envelopeText, textEnvelope, sealContent } from '@kaordo/crypto';
import type { ContentCodec } from './content-codec.ts';
export function createRondoContent(codec: ContentCodec) {
	async function server(value: RondoServer): Promise<RondoServer> {
		const envelope = textEnvelope(value.name);
		if (!envelope) throw new Error('The community name is not encrypted.');
		const body = await codec.open<{ name: string; description: string }>(
			envelope,
			value.ownerId,
			`rondo:${value.id}`
		);
		validateName(body.name, 100);
		if (typeof body.description !== 'string' || [...body.description].length > 500)
			throw new Error('Invalid encrypted server description.');
		return { ...value, ...body };
	}
	async function channel(value: RondoChannel, ownerId: string): Promise<RondoChannel> {
		const envelope = textEnvelope(value.name);
		if (!envelope) throw new Error('The channel name is not encrypted.');
		const body = await codec.open<{ name: string }>(
			envelope,
			ownerId,
			`rondo-channel:${value.serverId}:${value.id}`
		);
		validateName(body.name, 80);
		return { ...value, name: body.name };
	}
	async function detail(value: RondoDetail): Promise<RondoDetail> {
		return {
			...value,
			server: await server(value.server),
			channels: await Promise.all(value.channels.map((item) => channel(item, value.server.ownerId)))
		};
	}
	async function metadata(value: RondoDetail, previousName: string, extraId?: string) {
		const audience = await codec.audience('rondo', value.server.id);
		if (extraId && !audience.public && !audience.users.some((item) => item.id === extraId))
			audience.users.push(await codec.identity(extraId));
		const name = envelopeText(
			await sealContent(
				{ name: value.server.name, description: value.server.description },
				`rondo:${value.server.id}`,
				audience
			)
		);
		const channels: Record<string, string> = {};
		for (const item of value.channels)
			channels[item.id] = envelopeText(
				await sealContent(
					{ name: item.name },
					`rondo-channel:${item.serverId}:${item.id}`,
					audience
				)
			);
		return { expectedName: previousName, name, channels };
	}
	return { server, channel, detail, metadata };
}
export function validateName(name: string, limit: number) {
	if (
		typeof name !== 'string' ||
		!name.trim() ||
		[...name].length > limit ||
		/[\x00-\x1f\x7f]/.test(name)
	)
		throw new Error(`Use a name with 1–${limit} characters.`);
}
