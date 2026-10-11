export const MAX_TEXT_LENGTH = 8_000;
export const MAX_PAGE_LENGTH = 20_000;
export const MAX_OUTPUT_LENGTH = 64_000;
export const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
export const REQUEST_TIMEOUT_MS = 120_000;
export const IDLE_PORT_TIMEOUT_MS = 15_000;

export class TranslationSlots {
	private readonly documents = new Map<string, number>();
	private total = 0;
	acquire(document: string): (() => void) | null {
		const count = this.documents.get(document) ?? 0;
		if (count >= 4 || this.total >= 16) return null;
		this.total++;
		this.documents.set(document, count + 1);
		let released = false;
		return () => {
			if (released) return;
			released = true;
			this.total--;
			const next = (this.documents.get(document) ?? 1) - 1;
			if (next === 0) this.documents.delete(document);
			else this.documents.set(document, next);
		};
	}
}
