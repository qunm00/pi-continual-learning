/**
 * Model resolution (config file first, then the session model) and the
 * one-shot completion call.
 */

import type { Api, Model } from "@earendil-works/pi-ai";
import { complete } from "@earendil-works/pi-ai/compat";
import { parseModelSpec, readModelConfig } from "./config.ts";

export type CompleteFn = typeof complete;

export interface ModelAuth {
	apiKey?: string;
	headers?: Record<string, string>;
	env?: Record<string, string>;
}

export type ResolvedModel =
	| { ok: true; model: Model<Api>; source: "config" | "session" }
	| { ok: false; reason: "bad-config" | "no-model"; detail: string };

export interface ResolveModelInput {
	agentDir: string;
	sessionModel: Model<Api> | undefined;
	registry: { find(provider: string, id: string): Model<Api> | undefined };
}

export function resolveModel(input: ResolveModelInput): ResolvedModel {
	const config = readModelConfig(input.agentDir);
	if (!config.ok) {
		return { ok: false, reason: "bad-config", detail: config.detail };
	}

	if (config.model === null) {
		if (!input.sessionModel) {
			return {
				ok: false,
				reason: "no-model",
				detail: "no model configured and the session has none",
			};
		}
		return { ok: true, model: input.sessionModel, source: "session" };
	}

	const spec = parseModelSpec(config.model);
	if (!spec) {
		return {
			ok: false,
			reason: "bad-config",
			detail: `invalid model value: ${config.model}`,
		};
	}

	const model = input.registry.find(spec.provider, spec.id);
	if (!model) {
		return {
			ok: false,
			reason: "no-model",
			detail: `model not found: ${config.model}`,
		};
	}

	return { ok: true, model, source: "config" };
}

export interface CallModelInput {
	model: Model<Api>;
	auth: ModelAuth;
	prompt: string;
	signal: AbortSignal;
	completeFn?: CompleteFn;
}

export interface CallModelResult {
	text: string;
	usage: { input: number; output: number; cost: number };
}

export async function callModel(
	input: CallModelInput,
): Promise<CallModelResult> {
	const completeFn = input.completeFn ?? complete;
	const response = await completeFn(
		input.model,
		{
			messages: [
				{
					role: "user",
					content: [{ type: "text", text: input.prompt }],
					timestamp: Date.now(),
				},
			],
		},
		{
			apiKey: input.auth.apiKey,
			headers: input.auth.headers,
			env: input.auth.env,
			signal: input.signal,
		},
	);

	const text = response.content
		.filter(
			(block): block is { type: "text"; text: string } =>
				block.type === "text" && typeof block.text === "string",
		)
		.map((block) => block.text)
		.join("\n");

	return {
		text,
		usage: {
			input: response.usage?.input ?? 0,
			output: response.usage?.output ?? 0,
			cost: response.usage?.cost?.total ?? 0,
		},
	};
}
