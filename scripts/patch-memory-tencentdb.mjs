import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PATCH_MARKER = "railway-local-storage-adapter-v1";
const SUPPORTED_VERSION = "1.0.1";

const adapterSource = `// ${PATCH_MARKER}
class RailwayLocalStorageAdapter {
	constructor(backend) {
		this.backend = backend;
	}
	get type() {
		return this.backend.type;
	}
	async readFile(key) {
		const object = await this.backend.getObject(key);
		return object ? object.content.toString("utf-8") : null;
	}
	async readFileOrThrow(key) {
		const content = await this.readFile(key);
		if (content === null) throw new Error(\`File not found: \${key}\`);
		return content;
	}
	async readFileBuffer(key) {
		const object = await this.backend.getObject(key);
		return object?.content ?? null;
	}
	async writeFile(key, content) {
		return this.backend.putObject(key, content);
	}
	async appendFile(key, content) {
		return this.backend.appendObject(key, content);
	}
	async readdir(prefix, suffix) {
		const result = await this.backend.listObjects(prefix, { maxKeys: 10000 });
		return suffix ? result.entries.filter((entry) => entry.key.endsWith(suffix)) : result.entries;
	}
	async readdirNames(prefix, suffix) {
		return (await this.readdir(prefix, suffix))
			.filter((entry) => !entry.isDirectory)
			.map((entry) => entry.key.startsWith(prefix) ? entry.key.slice(prefix.length) : entry.key);
	}
	async unlink(key) {
		return this.backend.deleteObject(key);
	}
	async rmdir(prefix) {
		await this.backend.deleteByPrefix(prefix);
	}
	async mkdir() {}
	async exists(key) {
		return this.backend.exists(key);
	}
	async stat(key) {
		const object = await this.backend.getObject(key);
		if (!object) return null;
		const lastModified = object.lastModified?.getTime() ?? Date.now();
		return { key, size: object.size ?? object.content.length, lastModified, createdAt: lastModified };
	}
	async rename(sourceKey, destKey) {
		const object = await this.backend.getObject(sourceKey);
		if (!object) throw new Error(\`Source not found: \${sourceKey}\`);
		await this.backend.putObject(destKey, object.content, {
			contentType: object.contentType,
			metadata: object.metadata
		});
		await this.backend.deleteObject(sourceKey);
	}
	async copyFile(sourceKey, destKey) {
		const object = await this.backend.getObject(sourceKey);
		if (!object) throw new Error(\`Source not found: \${sourceKey}\`);
		await this.backend.putObject(destKey, object.content, {
			contentType: object.contentType,
			metadata: object.metadata
		});
	}
	getBackend() {
		return this.backend;
	}
}
`;

const registerNeedle = "function register(api) {";
const coreNeedle = `const core = new TdaiCore({
		hostAdapter,
		config: cfg,
		sessionFilter
	});`;
const coreReplacement = `const core = new TdaiCore({
		hostAdapter,
		config: cfg,
		sessionFilter,
		storage: new RailwayLocalStorageAdapter(new LocalStorageBackend({
			rootDir: pluginDataDir,
			logger: api.logger
		}))
	});
	api.logger.info(\`${"${TAG}"} Local StorageAdapter initialized (root=\${pluginDataDir})\`);`;

export function patchTencentPluginSource(source) {
	if (source.includes(PATCH_MARKER)) return { source, changed: false };
	if (!source.includes(registerNeedle) || !source.includes(coreNeedle)) {
		throw new Error("TencentDB 1.0.1 bundle does not match the expected patch points");
	}
	const patched = source
		.replace(registerNeedle, `${adapterSource}\n${registerNeedle}`)
		.replace(coreNeedle, coreReplacement);
	return { source: patched, changed: true };
}

function readPlugin(openclawEntry, stateDir) {
	const output = execFileSync(process.execPath, [openclawEntry, "plugins", "list", "--json"], {
		encoding: "utf8",
		env: { ...process.env, OPENCLAW_STATE_DIR: stateDir },
		stdio: ["ignore", "pipe", "ignore"]
	});
	const parsed = JSON.parse(output);
	const plugins = Array.isArray(parsed) ? parsed : (parsed.plugins ?? []);
	return plugins.find((plugin) => plugin.id === "memory-tencentdb");
}

export function patchInstalledPlugin(openclawEntry, stateDir) {
	const plugin = readPlugin(openclawEntry, stateDir);
	if (!plugin) return { status: "not-installed" };
	if (plugin.version !== SUPPORTED_VERSION) {
		return { status: `unsupported-version-${plugin.version}` };
	}
	const sourcePath = path.resolve(plugin.source);
	const allowedRoot = path.resolve(stateDir, "npm", "projects") + path.sep;
	if (!sourcePath.startsWith(allowedRoot) || path.basename(sourcePath) !== "index.mjs") {
		throw new Error(`Refusing unexpected memory-tencentdb source path: ${sourcePath}`);
	}
	const original = fs.readFileSync(sourcePath, "utf8");
	const result = patchTencentPluginSource(original);
	if (!result.changed) return { status: "already-patched", sourcePath };

	const backupPath = `${sourcePath}.upstream-${SUPPORTED_VERSION}`;
	if (!fs.existsSync(backupPath)) fs.copyFileSync(sourcePath, backupPath, fs.constants.COPYFILE_EXCL);
	const temporary = `${sourcePath}.tmp-${process.pid}`;
	fs.writeFileSync(temporary, result.source);
	fs.renameSync(temporary, sourcePath);
	return { status: "patched", sourcePath, backupPath };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const [openclawEntry, stateDir] = process.argv.slice(2);
	if (!openclawEntry || !stateDir) {
		console.error("usage: patch-memory-tencentdb.mjs <openclaw-entry> <state-dir>");
		process.exit(2);
	}
	const result = patchInstalledPlugin(openclawEntry, stateDir);
	console.log(`[bootstrap] memory-tencentdb storage patch: ${result.status}`);
}
