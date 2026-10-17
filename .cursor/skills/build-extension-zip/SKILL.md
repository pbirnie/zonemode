---
name: build-extension-zip
description: >-
  Builds the Chrome extension into dist/ and produces extension-unpacked.zip
  at the repo root using .NET ZipFile (PowerShell). Use when the user asks to
  build the package, create a release zip, zip dist, or upload an unpacked
  extension zip to GitHub releases.
---

# Build extension package (ZIP)

## What to produce

1. Run **`bun run build`** from the repository root (writes **`dist/`** — load-unpacked target).
2. Create **`extension-unpacked.zip`** at the repo root with **`manifest.json`** at the **root** of the archive (contents of `dist/`, not a nested `dist/` folder).

`extension-unpacked.zip` is listed in **`.gitignore`**; do not commit it unless the user asks.

## Preferred method: PowerShell `ZipFile`

Works on Windows without the `zip` CLI. **`includeBaseDirectory: $false`** archives the **contents** of `dist`, so Chrome **Load unpacked** works on the extracted folder.

### From Git Bash / MSYS (agent shell)

1. **`cd`** to the repository root (workspace root).
2. Run **`bun run build`**.
3. Run PowerShell with **`-WorkingDirectory`** set to that same root so paths resolve without Bash expanding **`$false`**:

```bash
# From repo root; set ROOT to the workspace path (Git Bash: e.g. /c/projects/zonemode)
ROOT="$(pwd)"
cd "$ROOT" && bun run build && powershell.exe -NoProfile -WorkingDirectory "$ROOT" -ExecutionPolicy Bypass -Command 'if (Test-Path "extension-unpacked.zip") { Remove-Item "extension-unpacked.zip" -Force }; Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::CreateFromDirectory((Join-Path (Get-Location) "dist"), (Join-Path (Get-Location) "extension-unpacked.zip"), [System.IO.Compression.CompressionLevel]::Optimal, $false)'
```

If **`-WorkingDirectory`** rejects a Unix-style path, use the **absolute-path + single-quoted `-Command`** variant below instead.

**Alternative:** wrap the entire **`-Command`** argument in **single quotes** (Bash) and embed **absolute** `dist` / `zip` paths so **`$false`** is preserved:

```bash
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command 'Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::CreateFromDirectory("C:/path/to/repo/dist", "C:/path/to/repo/extension-unpacked.zip", [System.IO.Compression.CompressionLevel]::Optimal, $false)'
```

### From Windows CMD

```bat
cd /d C:\path\to\zonemode
bun run build
if exist extension-unpacked.zip del /f extension-unpacked.zip
powershell -NoProfile -ExecutionPolicy Bypass -Command "Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::CreateFromDirectory('%CD%\dist', '%CD%\extension-unpacked.zip', [System.IO.Compression.CompressionLevel]::Optimal, $false)"
```

In CMD, **`$false`** inside double quotes is passed through to PowerShell correctly.

## Avoid for this project

- **`zip`**: Often missing in Git Bash on Windows (`zip: command not found`).
- **`tar -a -c -f … .zip`**: Can produce archives some tools struggle to extract; prefer **`ZipFile`** above.

## Verify

- Archive exists: **`extension-unpacked.zip`** at repo root.
- Optional: extract to a temp folder and confirm **`manifest.json`** sits next to **`background/`**, **`content/`**, **`popup/`**.
