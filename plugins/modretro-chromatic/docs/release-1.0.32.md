# 1.0.32

Includes the previously distributed 1.0.27–1.0.31 improvements in repository main: managed compiler preparation, portable plugin startup, ModRetro Updater activation handoff, clearer preview recovery, 8x device recordings, recording stop without disconnect, and removal of obsolete capture UI. Fixes standalone capture startup after that UI cleanup.

Fixes Linux/POSIX payload permissions by creating staged directories with mode 0755 and including explicit directory permissions in upload ZIPs. Retains runtime ownership and write-permission checks. Existing unsafe installations need replacement with the corrected package; this release does not recursively change user directories. ZIP extraction was tested with Info-ZIP under umask 0002; stores that ignore archive directory permissions require their own extraction correction.

Keeps the existing browser/PyBoy emulation stack and MP4 encoder. No experimental codec or emulator replacement is included.
