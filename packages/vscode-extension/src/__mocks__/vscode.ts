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
    get: (_key: string, defaultValue: any) => defaultValue,
  }),
  openTextDocument: async () => ({}),
  workspaceFolders: [{ uri: "file:///test" }],
  fs: {
    writeFile: async () => {},
    readFile: async () => new Uint8Array(),
  },
};
