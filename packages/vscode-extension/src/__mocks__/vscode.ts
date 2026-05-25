/**
 * Mock for the 'vscode' module so extension code can be loaded outside VS Code.
 */
export class EventEmitter {
  private listeners: Function[] = [];
  event = (listener: Function) => {
    this.listeners.push(listener);
    return { dispose: () => this.listeners.splice(this.listeners.indexOf(listener), 1) };
  };
  fire(value?: any) {
    for (const listener of this.listeners) listener(value);
  }
  dispose() {}
}

export class TreeItem {
  label: string;
  description?: string;
  iconPath?: any;
  collapsibleState?: number;
  constructor(label: string, collapsibleState?: number) {
    this.label = label;
    this.collapsibleState = collapsibleState;
  }
}

export const TreeItemCollapsibleState = {
  None: 0,
  Collapsed: 1,
  Expanded: 2,
};

export class ThemeIcon {
  id: string;
  constructor(id: string) { this.id = id; }
}

export const StatusBarAlignment = { Left: 1, Right: 2 };

export const Disposable = {
  from: (...items: any[]) => ({ dispose: () => items.forEach(item => item.dispose?.()) }),
};

export class RelativePattern {
  baseUri: any;
  pattern: string;
  constructor(baseUri: any, pattern: string) {
    this.baseUri = baseUri;
    this.pattern = pattern;
  }
}

let configurationValues: Record<string, any> = {};
const willSaveHandlers: Function[] = [];
const didSaveHandlers: Function[] = [];
const registeredCommands: Record<string, Function> = {};
const registeredProviders: Record<string, any> = {};
let activeEditor: any;

export function __setConfiguration(values: Record<string, any>): void {
  configurationValues = values;
}

export function __resetMockState(): void {
  configurationValues = {};
  willSaveHandlers.length = 0;
  didSaveHandlers.length = 0;
  for (const key of Object.keys(registeredCommands)) delete registeredCommands[key];
  for (const key of Object.keys(registeredProviders)) delete registeredProviders[key];
  activeEditor = undefined;
}

export async function __fireWillSaveTextDocument(document: any): Promise<void> {
  for (const handler of willSaveHandlers) handler({ document });
  await new Promise(resolve => setTimeout(resolve, 0));
}

export async function __fireDidSaveTextDocument(document: any): Promise<void> {
  for (const handler of didSaveHandlers) handler(document);
  await new Promise(resolve => setTimeout(resolve, 0));
}

export function __getRegisteredFileSystemProvider(scheme: string): any {
  return registeredProviders[scheme];
}

export async function __executeCommand(command: string, ...args: any[]): Promise<any> {
  return registeredCommands[command]?.(...args);
}

export function __setActiveTextEditor(editor: any): void {
  activeEditor = editor;
}

export const window = {
  registerTreeDataProvider: () => ({ dispose: () => {} }),
  showInputBox: async () => undefined,
  showQuickPick: async () => undefined,
  showInformationMessage: () => {},
  showWarningMessage: () => {},
  showErrorMessage: () => {},
  showTextDocument: async () => {},
  get activeTextEditor() { return activeEditor; },
  createStatusBarItem: () => ({
    text: "",
    tooltip: "",
    command: "",
    show: () => {},
    hide: () => {},
    dispose: () => {},
  }),
};

export const commands = {
  registerCommand: (cmd: string, cb: Function) => {
    registeredCommands[cmd] = cb;
    return { dispose: () => { delete registeredCommands[cmd]; } };
  },
};

export const Uri = {
  from: (input: any) => makeUri(input.scheme, input.path ?? "", input.fsPath),
  file: (fsPath: string) => makeUri("file", fsPath.replace(/\\/g, "/"), fsPath),
  parse: (value: string) => {
    const match = /^([^:]+):(.*)$/.exec(value);
    return makeUri(match?.[1] ?? "file", match?.[2] ?? value);
  },
  joinPath: (base: any, ...segments: string[]) => {
    const joined = [base.fsPath ?? base.path ?? "", ...segments].join("/").replace(/\/+/g, "/");
    return makeUri(base.scheme ?? "file", joined, joined);
  },
};

export const FileType = { Unknown: 0, File: 1, Directory: 2, SymbolicLink: 64 };
export const FileChangeType = { Changed: 1, Created: 2, Deleted: 3 };
export const FileSystemError = {
  FileNotFound: (uri?: any) => Object.assign(new Error(`File not found: ${uri?.toString?.() ?? ""}`), { code: "FileNotFound" }),
  NoPermissions: (uri?: any) => Object.assign(new Error(`No permissions: ${uri?.toString?.() ?? ""}`), { code: "NoPermissions" }),
};

export const env = {
  clipboard: {
    writeText: async () => {},
    readText: async () => "",
  },
};

export const workspace = {
  getConfiguration: () => ({
    get: (key: string, defaultValue: any) =>
      Object.prototype.hasOwnProperty.call(configurationValues, key) ? configurationValues[key] : defaultValue,
  }),
  createFileSystemWatcher: () => ({
    onDidCreate: () => ({ dispose: () => {} }),
    onDidChange: () => ({ dispose: () => {} }),
    onDidDelete: () => ({ dispose: () => {} }),
    dispose: () => {},
  }),
  onWillSaveTextDocument: (handler: Function) => {
    willSaveHandlers.push(handler);
    return { dispose: () => willSaveHandlers.splice(willSaveHandlers.indexOf(handler), 1) };
  },
  onDidSaveTextDocument: (handler: Function) => {
    didSaveHandlers.push(handler);
    return { dispose: () => didSaveHandlers.splice(didSaveHandlers.indexOf(handler), 1) };
  },
  openTextDocument: async () => ({}),
  registerFileSystemProvider: (scheme: string, provider: any) => {
    registeredProviders[scheme] = provider;
    return { dispose: () => { delete registeredProviders[scheme]; } };
  },
  workspaceFolders: [{ uri: makeUri("file", "/test", "/test") }],
  fs: {
    writeFile: async () => {},
    readFile: async () => new Uint8Array(),
    stat: async () => ({ type: FileType.File, ctime: 0, mtime: 0, size: 0 }),
    readDirectory: async () => [],
    createDirectory: async () => {},
    delete: async () => {},
    rename: async () => {},
  },
};

function makeUri(scheme: string, pathValue: string, fsPath?: string): any {
  const normalizedPath = pathValue.startsWith("/") ? pathValue : `/${pathValue}`;
  return {
    scheme,
    path: normalizedPath,
    fsPath: fsPath ?? normalizedPath,
    toString: () => `${scheme}:${normalizedPath}`,
  };
}
