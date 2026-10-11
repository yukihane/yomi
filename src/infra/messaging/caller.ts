import { browser } from "#imports";
import { parseMessageCaller } from "@/domain/message-caller";

export function getMessageCaller(sender: unknown) {
	return parseMessageCaller(sender, browser.runtime.id, browser.runtime.getURL(""));
}
