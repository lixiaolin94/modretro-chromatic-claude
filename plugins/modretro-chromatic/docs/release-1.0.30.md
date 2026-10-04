# 1.0.30 — First-run preparation and preview recovery

- Added `toolchain_prepare` for compiler/emulator dependencies. It uses the existing managed installer, preserves its locks and ownership checks, and continues in the installed plugin. It never installs drivers, activates hardware, or registers another plugin.
- Added `web_preview` action `recover` to reopen an existing verified export without recompiling. Missing or changed exports are reported rather than opening an expired URL.
- Failed preview builds now distinguish missing game tools from build errors and provide a structured next action. Existing previews remain intact.
- The external ModRetro Updater handoff now says **Check again** and refreshes device selection before a separately confirmed installation. It does not claim that device discovery proves activation.

Physical capture implementation is unchanged from 1.0.29. Windows driver installation remains a separate, explicit system operation through the existing supported tool and administrator prompt. No automatic cartridge-write retries were added.
