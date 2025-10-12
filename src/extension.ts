import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";

interface LibFunction {
  name: string;
  argType: string; // comma-separated types, e.g., "list:str,int,str"
  alias: string;
  returnType: string;
}

const libFunctions = new Map<string, LibFunction[]>(); // Map<libraryName, Array<LibFunction>>

const ARX_KEYWORDS = [
  "if", "else", "while", "for", "break", "continue", "in",
  "list", "string", "int", "float", "bool", "and", "or", "not",
  "return", "class", "using", "this", "void", "any",
  "true", "false", "_init", "_exec"
];

function getMapDir(): string | null {
  const folders = vscode.workspace.workspaceFolders;
  return folders && folders.length > 0
    ? path.join(folders[0].uri.fsPath, "c_map")
    : null;
}

function loadMapFiles(): void {
  const mapDir = getMapDir();
  libFunctions.clear();

  if (!mapDir || !fs.existsSync(mapDir)) return;

  for (const file of fs.readdirSync(mapDir)) {
    if (!file.endsWith(".map")) continue;

    const libName = path.basename(file, ".map");
    const content = fs.readFileSync(path.join(mapDir, file), "utf8");
    const functions: LibFunction[] = [];

    const funcSection = content.split("[functions]")[1];
    if (!funcSection) continue;

    for (const line of funcSection.split("\n")) {
      const match = line.match(/^(\w+:\w+(?:,\w+)*)\s*=\s*(\w+)\s*>\s*(\w+)/);
      if (match) {
        const [_, argString, alias, returnType] = match;
        const [name, ...args] = argString.split(":");
        functions.push({
          name,
          argType: args.join(":"),
          alias,
          returnType,
        });
      }
    }

    libFunctions.set(libName, functions);
  }

  console.log("[ARX] Loaded libraries:", Array.from(libFunctions.keys()));
}

function watchMapFiles(): void {
  const mapDir = getMapDir();
  if (!mapDir || !fs.existsSync(mapDir)) return;

  fs.watch(mapDir, (eventType, filename) => {
    if (filename && filename.endsWith(".map")) {
      console.log(`[ARX] Reloading map: ${filename}`);
      loadMapFiles();
    }
  });
}

export function activate(context: vscode.ExtensionContext): void {
  loadMapFiles();
  watchMapFiles();

  // Library name autocomplete after 'using'
  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider("arx", {
      provideCompletionItems(document: vscode.TextDocument, position: vscode.Position): vscode.CompletionItem[]  {
        const lineText = document.lineAt(position).text;
        if (/^\s*using\s+/.test(lineText)) {
          return Array.from(libFunctions.keys()).map((name) => {
            const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Module);
            item.detail = "ARX Library";
            return item;
          });
        }
        return [];
      },
    })
  );

  // Function autocomplete with library prefix
  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(
      "arx",
      {
        provideCompletionItems(document: vscode.TextDocument, position: vscode.Position): vscode.CompletionItem[]  {
          const lineText = document.lineAt(position).text;
          const libMatch = lineText.match(/(\w+)\.(\w*)$/);
          if (!libMatch) return [];

          const [_, libName, prefix] = libMatch;
          const funcs = libFunctions.get(libName);
          if (!funcs) return [];

          return funcs
            .filter((fn) => fn.name.startsWith(prefix))
            .map((fn) => {
              const item = new vscode.CompletionItem(fn.name, vscode.CompletionItemKind.Function);
              item.detail = `${libName} library`;
              item.insertText = fn.name;
              item.documentation = `${fn.name}(${fn.argType}) -> ${fn.returnType}`;
              return item;
            });
        },
      },
      "." // Trigger completion after typing '.'
    )
  );

  // Keyword autocomplete
  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(
      "arx",
      {
        provideCompletionItems() {
          return ARX_KEYWORDS.map(keyword => {
            const item = new vscode.CompletionItem(
              keyword,
              vscode.CompletionItemKind.Keyword
            );
            item.detail = "ARX Keyword";
            return item;
          });
        },
      }
    )
  );

  // Signature help
  context.subscriptions.push(
    vscode.languages.registerSignatureHelpProvider(
      { language: "arx" },
      {
        provideSignatureHelp(document, position) {
          const line = document.lineAt(position).text;
          const textUntilPos = line.slice(0, position.character);

          // Match up to cursor position, not end of line
          const match = textUntilPos.match(/(\w+)\.(\w+)\(/);
          if (!match) return null;

          const [, libName, funcName] = match;
          const funcs = libFunctions.get(libName);
          if (!funcs) return null;

          const fn = funcs.find(f => f.name === funcName);
          if (!fn) return null;

          const args = fn.argType ? fn.argType.split(",").map(a => a.trim()) : [];

          const sig = new vscode.SignatureInformation(
            `${fn.name}(${args.join(", ")}) -> ${fn.returnType}`,
            `From library: ${libName}`
          );
          sig.parameters = args.map(type => new vscode.ParameterInformation(type));

          // Count commas before cursor to highlight active parameter
          const commaCount = (textUntilPos.match(/,/g) || []).length;

          const help = new vscode.SignatureHelp();
          help.signatures = [sig];
          help.activeSignature = 0;
          help.activeParameter = Math.min(commaCount, args.length - 1);
          return help;
        }
      },
      "(", "," // triggers
    )
  );
}

export function deactivate(): void {}
