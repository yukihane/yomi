import "@wxt-dev/browser";

declare module "@wxt-dev/browser" {
	namespace Browser.commands {
		function openShortcutSettings(): Promise<void>;
	}
}
