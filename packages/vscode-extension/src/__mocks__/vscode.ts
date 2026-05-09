/**
 * Mock for the 'vscode' module so extension code can be loaded outside VS Code.
 */
export class EventEmitter {
  event = () => {};
  fire() {}
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

let configurationValues: Record<string, any> = {};
const willSaveHandlers: Function[] = [];
const didSaveHandlers: Function[] = [];

export function __setConfiguration(values: Record<string, any>): void {
  configurationValues = values;
}

export function __resetMockState(): void {
  configurationValues = {};
  willSaveHandlers.length = 0;
  didSaveHandlers.length = 0;
}

export async function __fireWillSaveTextDocument(document: any): Promise<void> {
  for (const handler of willSaveHandlers) handler({ document });
  await new Promise(resolve => setTimeout(resolve, 0));
}

export async function __fireDidSaveTextDocument(document: any): Promise<void> {
  for (const handler of didSaveHandlers) handler(document);
  await new Promise(resolve => setTimeout(resolve, 0));
}

export const window = {
  registerTreeDataProvider: () => ({ dispose: () => {} }),
  showInputBox: async () => undefined,
  showQuickPick: async () => undefined,
  showInformationMessage: () => {},
  showWarningMessage: () => {},
  showErrorMessage: () => {},
  showTextDocument: async () => {},
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
  registerCommand: (_cmd: string, _cb: Function) => ({ dispose: () => {} }),
};

export const Uri = {
  joinPath: (...args: any[]) => args.join("/"),
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
  onWillSaveTextDocument: (handler: Function) => {
    willSaveHandlers.push(handler);
    return { dispose: () => willSaveHandlers.splice(willSaveHandlers.indexOf(handler), 1) };
  },
  onDidSaveTextDocument: (handler: Function) => {
    didSaveHandlers.push(handler);
    return { dispose: () => didSaveHandlers.splice(didSaveHandlers.indexOf(handler), 1) };
  },
  openTextDocument: async () => ({}),
  workspaceFolders: [{ uri: { fsPath: "/test" } }],
  fs: {
    writeFile: async () => {},
    readFile: async () => new Uint8Array(),
  },
};
