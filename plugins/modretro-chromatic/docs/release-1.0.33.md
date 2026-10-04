# 1.0.33

Fixes device discovery on Linux when a plugin installer recreates packed vendor directories as group-writable (0775), even though the upload ZIP specifies 0755. The runtime authenticates the packed input and automatically materializes the selected executable in its private cache. The private cache lives at `~/.modretro-chromatic-runtime`, so an existing group-writable `~/.cache` does not prevent preparation. Older caches are left untouched. It never changes installed plugin permissions or executes from the group-writable source directory.

File hashes, file ownership and modes, symlink rejection, exact bundle membership, and private executable-cache validation remain enforced. World-writable source directories and unpacked executable directories remain rejected. Packaging still requires safe directory permissions. No activation, driver, capture, or cartridge operation is automatically retried.

Includes the previously distributed 1.0.27–1.0.32 changes in main. Keeps the same six-platform universal ZIP, vendor binaries, capture helper, and emulator stack.
