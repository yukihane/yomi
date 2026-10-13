import { CachePolicySchema } from "@/domain/translation-cache";

import { defineValidatedItem } from "./item";

export const cachePolicyItem = defineValidatedItem("local:cachePolicy", CachePolicySchema, {
	enabled: false,
	blocked: false,
});
