import * as v from "valibot";

import { SerializedFailureSchema } from "@/domain/failure";
import type { MessageAudience } from "@/domain/message-caller";
import { ModelInfoSchema } from "@/domain/models";
import { SignOutResultSchema } from "@/domain/sign-out";
import { TranslationOutputSchema } from "@/domain/translation-request";

export { TranslateRequestSchema } from "@/domain/translation-request";
export type { TranslateRequest } from "@/domain/translation-request";

export const TRANSLATE_PORT = "translate";

export const TranslateEventSchema = v.variant("type", [
	TranslationOutputSchema,
	v.object({ type: v.literal("done") }),
	v.object({ type: v.literal("error"), failure: SerializedFailureSchema }),
]);

export type TranslateEvent = v.InferOutput<typeof TranslateEventSchema>;

const AuthStateSchema = v.object({
	signedIn: v.boolean(),
	email: v.nullable(v.string()),
});

export type AuthState = v.InferOutput<typeof AuthStateSchema>;

const endpoint = <P extends v.GenericSchema, R extends v.GenericSchema>(
	params: P,
	result: R,
	audience: MessageAudience,
) => ({
	params,
	result,
	audience,
});

export const BACKGROUND_API = {
	"auth:getState": endpoint(v.void(), AuthStateSchema, "extension"),
	"auth:signIn": endpoint(v.void(), v.void(), "extension"),
	"auth:signOut": endpoint(v.void(), SignOutResultSchema, "extension"),
	"models:list": endpoint(v.void(), v.array(ModelInfoSchema), "extension"),
	"open:options": endpoint(v.void(), v.void(), "either"),
	"open:usage": endpoint(v.void(), v.void(), "either"),
	"open:shortcuts": endpoint(v.void(), v.void(), "extension"),
};

type BackgroundApi = typeof BACKGROUND_API;

export type BackgroundMethod = keyof BackgroundApi;

export type ParamsOf<K extends BackgroundMethod> = v.InferOutput<BackgroundApi[K]["params"]>;

export type ParamlessMethod = {
	[K in BackgroundMethod]: [ParamsOf<K>] extends [void] ? K : never;
}[BackgroundMethod];

export type ResultOf<K extends BackgroundMethod> = v.InferOutput<BackgroundApi[K]["result"]>;

export const BackgroundRequestSchema = v.object({
	type: v.custom<BackgroundMethod>(
		(type) => typeof type === "string" && Object.hasOwn(BACKGROUND_API, type),
	),
	// undefined のキーはメッセージングで落ちる。中身は type ごとのスキーマで検証する
	params: v.optional(v.unknown()),
});

export const BackgroundResponseSchema = v.variant("ok", [
	// undefined のキーはメッセージングで落ちる。中身は type ごとのスキーマで検証する
	v.object({ ok: v.literal(true), value: v.optional(v.unknown()) }),
	v.object({ ok: v.literal(false), failure: SerializedFailureSchema }),
]);

export type BackgroundResponse = v.InferOutput<typeof BackgroundResponseSchema>;

export const ContentMessageSchema = v.variant("type", [
	v.object({ type: v.literal("page:getState") }),
	v.object({ type: v.literal("page:translate") }),
	v.object({ type: v.literal("page:stop") }),
	v.object({ type: v.literal("page:showOriginal") }),
	v.object({ type: v.literal("page:showTranslation") }),
	v.object({ type: v.literal("command:translate") }),
	v.object({ type: v.literal("command:toggleOriginal") }),
	v.object({ type: v.literal("selection:translate"), text: v.string() }),
]);

export type ContentMessage = v.InferOutput<typeof ContentMessageSchema>;

export const CommandNameSchema = v.picklist(["translate-page", "toggle-original"]);

export type CommandName = v.InferOutput<typeof CommandNameSchema>;
