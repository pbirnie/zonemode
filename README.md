# ZoneMode  

A Chrome extension that :
   - Allows you to focus on a specific category of video content
   - Generates concise summaries of YouTube videos using AI. 
   - Supports access to 500 AI models via OpenRouter.

## Features

- Hides videos which do not match the category you have chosen to focus on 
- Generate summaries of YouTube videos
- Chat with AI about the video content


## Quick Installation

1. Go to the [Releases](../../releases) page
2. Download `extension-unpacked.zip`
3. Open Chrome and go to `chrome://extensions`
4. Enable "Developer mode" in the top right
5. Drag and drop `extension-unpacked.zip` directly onto the extensions page

That's it! No need to extract the ZIP or click any buttons.

## Configuration

1. Click the extension icon in Chrome — the popup uses **Profiles**, **API**, **Prompt**, **Debug**, and **Info** tabs (summary profiles; provider, key, models; prompt templates; optional link-metadata hover and test bench; changelog and links).
2. Or open a YouTube video and use the **gear** button next to **Summarize** for the same settings (single scroll with collapsible prompt templates).
3. On YouTube, expand **Prompt templates** to customize summary and chat instructions (`{{TRANSCRIPT}}` / `{{SUMMARY}}` placeholders).

## Usage

1. Navigate to any YouTube video
2. Click the "Summarize" button below the video
3. Wait for the AI to generate a summary
4. Use the chat feature to ask questions about the video

## Development

**Architecture:** [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — Mermaid diagrams (browser, content script, service worker, messages) render on GitHub.

```bash
# Install dependencies
bun install

# Watch for changes during development
bun run dev

# Build for production
bun run build
```

Then, click "Load unpacked" in chrome://extensions and select the `dist` folder

When rebuilding, you can click on the "Refresh" icon to see changes propagate to the extension.

Builds emit **linked source maps** (`*.js.map` next to each bundle under `dist/`) so Chrome DevTools can map stack traces back to TypeScript when you inspect the popup, content script, or service worker.

## Contributing

Pull requests are welcome! For major changes, please open an issue first to discuss the change.

## License

[MIT](LICENSE)
