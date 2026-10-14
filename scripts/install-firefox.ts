import { resolve } from "node:path";

import { Browser, install } from "@puppeteer/browsers";

const installed = await install({
	browser: Browser.FIREFOX,
	buildId: process.argv[2] ?? "stable_156.0.1",
	cacheDir: resolve(".output/browsers"),
});
console.log(installed.executablePath);
