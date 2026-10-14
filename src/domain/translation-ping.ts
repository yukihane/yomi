import * as v from "valibot";

export const TranslatePingSchema = v.strictObject({ type: v.literal("ping") });
