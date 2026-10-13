import { EMPTY_SITE_RULES, SiteRulesSchema } from "@/domain/site-rules";

import { defineValidatedItem } from "./item";

export const siteRulesItem = defineValidatedItem(
	"local:siteRules",
	SiteRulesSchema,
	EMPTY_SITE_RULES,
);
