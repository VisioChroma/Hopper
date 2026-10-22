// src/services/files/FileStore.ts
// Holds the files the sender has picked. Later, TransferEngine reads from here.
export type PickedFile = {
  uri: string;
  name: string;
  size: number | null;
  type: string | null;
};

type Listener = (files: PickedFile[]) => void;

class FileStoreClass {
  private files: PickedFile[] = [];
  private listeners: Listener[] = [];

  get(): PickedFile[] {
    return this.files;
  }

  // Adds files, skipping any that were already picked (same uri).
  add(incoming: PickedFile[]) {
    const known = new Set(this.files.map((f) => f.uri));
    this.files = [...this.files, ...incoming.filter((f) => !known.has(f.uri))];
    this.emit();
  }

  remove(uri: string) {
    this.files = this.files.filter((f) => f.uri !== uri);
    this.emit();
  }

  clear() {
    this.files = [];
    this.emit();
  }

  subscribe(l: Listener) {
    this.listeners.push(l);
    return () => {
      this.listeners = this.listeners.filter((x) => x !== l);
    };
  }

  private emit() {
    this.listeners.forEach((l) => l(this.files));
  }
}

export const FileStore = new FileStoreClass();

export function formatSize(bytes: number | null): string {
  if (bytes == null) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}