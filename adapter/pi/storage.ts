import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
	ensureCanonicalStorageData,
	migrateStorageData,
	type StorageAdapter,
	type StorageData,
} from "../../core";

const STORAGE_FILE = path.join(os.homedir(), ".pi", "agent", "multicodex.json");
const LOCK_RETRY_DELAY_MS = 25;
const LOCK_WAIT_TIMEOUT_MS = Number.parseInt(
	process.env.MNEMOS_MULTICODEX_STORAGE_LOCK_TIMEOUT_MS ?? "4000",
	10,
);
const LOCK_STALE_MS = Number.parseInt(
	process.env.MNEMOS_MULTICODEX_STORAGE_LOCK_STALE_MS ?? "30000",
	10,
);
const LOCK_WAIT_TIMEOUT = Number.isFinite(LOCK_WAIT_TIMEOUT_MS)
	? LOCK_WAIT_TIMEOUT_MS
	: 4000;
const LOCK_STALE = Number.isFinite(LOCK_STALE_MS) ? LOCK_STALE_MS : 30000;
const SLEEP_BUFFER = new SharedArrayBuffer(4);
const SLEEP_VIEW = new Int32Array(SLEEP_BUFFER);

export function getMulticodexStoragePath(): string {
	return STORAGE_FILE;
}

function sleepSync(ms: number): void {
	Atomics.wait(SLEEP_VIEW, 0, 0, ms);
}

function ensureStorageDir(storageFile: string): void {
	const dir = path.dirname(storageFile);
	if (!fs.existsSync(dir)) {
		fs.mkdirSync(dir, { recursive: true });
	}
}

function readStorageData(storageFile: string): StorageData {
	if (!fs.existsSync(storageFile)) {
		return { schemaVersion: 1, accounts: [] };
	}
	const parsed = JSON.parse(fs.readFileSync(storageFile, "utf-8"));
	return migrateStorageData(parsed);
}

function writeStorageData(storageFile: string, data: StorageData): void {
	ensureStorageDir(storageFile);
	const canonical = ensureCanonicalStorageData(data);
	const dir = path.dirname(storageFile);
	const tempFile = path.join(
		dir,
		`.multicodex.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`,
	);
	fs.writeFileSync(tempFile, JSON.stringify(canonical, null, 2));
	fs.renameSync(tempFile, storageFile);
}

function withStorageLock<T>(storageFile: string, action: () => T): T {
	ensureStorageDir(storageFile);
	const lockFile = `${storageFile}.lock`;
	const startedAt = Date.now();
	while (true) {
		let lockFd: number | undefined;
		try {
			lockFd = fs.openSync(lockFile, "wx");
			fs.writeFileSync(lockFd, `${process.pid}@${Date.now()}\n`, "utf-8");
			return action();
		} catch (error) {
			const code = (error as NodeJS.ErrnoException).code;
			if (code !== "EEXIST") {
				throw error;
			}
			try {
				const stat = fs.statSync(lockFile);
				if (Date.now() - stat.mtimeMs > LOCK_STALE) {
					fs.unlinkSync(lockFile);
					continue;
				}
			} catch {
				// lock released between exists/stat checks
			}
			if (Date.now() - startedAt >= LOCK_WAIT_TIMEOUT) {
				throw new Error(
					`Timed out waiting for multicodex storage lock: ${lockFile}`,
				);
			}
			sleepSync(LOCK_RETRY_DELAY_MS);
		} finally {
			if (lockFd !== undefined) {
				try {
					fs.closeSync(lockFd);
				} catch {
					// ignore close races
				}
				try {
					fs.unlinkSync(lockFile);
				} catch {
					// ignore unlink races
				}
			}
		}
	}
}

export function createPiStorageAdapter(
	storageFile = STORAGE_FILE,
): StorageAdapter {
	return {
		load(): StorageData {
			try {
				return readStorageData(storageFile);
			} catch (error) {
				console.error("Failed to load multicodex accounts:", error);
				return { schemaVersion: 1, accounts: [] };
			}
		},
		save(data: StorageData): void {
			try {
				withStorageLock(storageFile, () => {
					writeStorageData(storageFile, data);
				});
			} catch (error) {
				console.error("Failed to save multicodex accounts:", error);
			}
		},
		update(mutator: (current: StorageData) => StorageData): StorageData {
			try {
				return withStorageLock(storageFile, () => {
					const current = readStorageData(storageFile);
					const next = ensureCanonicalStorageData(mutator(current));
					writeStorageData(storageFile, next);
					return next;
				});
			} catch (error) {
				console.error(
					"Failed to atomically update multicodex accounts:",
					error,
				);
				return this.load();
			}
		},
	};
}
