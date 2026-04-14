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

export function getMulticodexStoragePath(): string {
	return STORAGE_FILE;
}

export function createPiStorageAdapter(
	storageFile = STORAGE_FILE,
): StorageAdapter {
	return {
		load(): StorageData {
			try {
				if (fs.existsSync(storageFile)) {
					const parsed = JSON.parse(fs.readFileSync(storageFile, "utf-8"));
					const migrated = migrateStorageData(parsed);
					if (JSON.stringify(parsed) !== JSON.stringify(migrated)) {
						const dir = path.dirname(storageFile);
						if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
						fs.writeFileSync(storageFile, JSON.stringify(migrated, null, 2));
					}
					return migrated;
				}
			} catch (error) {
				console.error("Failed to load multicodex accounts:", error);
			}
			return { schemaVersion: 1, accounts: [] };
		},
		save(data: StorageData): void {
			try {
				const dir = path.dirname(storageFile);
				if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
				fs.writeFileSync(
					storageFile,
					JSON.stringify(ensureCanonicalStorageData(data), null, 2),
				);
			} catch (error) {
				console.error("Failed to save multicodex accounts:", error);
			}
		},
	};
}
