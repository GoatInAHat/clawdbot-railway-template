import assert from "node:assert/strict";
import test from "node:test";

import { patchTencentPluginSource } from "../scripts/patch-memory-tencentdb.mjs";

const fixture = `
var LocalStorageBackend = class {};
function register(api) {
	const pluginDataDir = "/data/.openclaw/memory-tdai";
	const hostAdapter = {};
	const cfg = {};
	const sessionFilter = {};
	const core = new TdaiCore({
		hostAdapter,
		config: cfg,
		sessionFilter
	});
}
`;

test("patch wires TencentDB local storage once", () => {
	const first = patchTencentPluginSource(fixture);
	assert.equal(first.changed, true);
	assert.match(first.source, /railway-local-storage-adapter-v1/);
	assert.match(first.source, /storage: new RailwayLocalStorageAdapter/);
	assert.match(first.source, /rootDir: pluginDataDir/);

	const second = patchTencentPluginSource(first.source);
	assert.equal(second.changed, false);
	assert.equal(second.source, first.source);
});

test("patch fails closed on an unknown bundle", () => {
	assert.throws(
		() => patchTencentPluginSource("function register(api) {}"),
		/does not match the expected patch points/
	);
});
