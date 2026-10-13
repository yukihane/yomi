import { TabStatesSchema } from "@/domain/tab-state";

import { defineValidatedItem } from "./item";

// タブ ID はブラウザーを再起動すると再利用されるため、永続保存しない。
export const tabStatesItem = defineValidatedItem("session:tabPageStates", TabStatesSchema, {});
