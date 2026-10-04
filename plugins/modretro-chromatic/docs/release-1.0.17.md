# ModRetro Chromatic 1.0.17

## Correct capture guidance for Linux

The `device_capture` tool description and deployment guide now describe Linux
support introduced in 1.0.16. Linux x64/ARM64 uses **Connect** without an Enable
step or macOS permission prompt. It records video only, and device listing
briefly opens matching nodes to query capabilities without streaming.

macOS still requires the user's explicit Enable and normal OS access; its
optional USB audio must match the selected player. Windows device capture
remains unavailable, while other supported device actions remain available.

A regression test checks this guidance through the real MCP tool-list response.
The capture backend, UI and native binaries are unchanged. Physical Linux
capture, long recordings and rendered UI behavior remain unverified; this patch
does not add hardware validation.
