export class PlaytestError extends Error {
    code;
    recordingPath;
    constructor(code, message, recordingPath, options) {
        super(message, options);
        this.code = code;
        this.recordingPath = recordingPath;
        this.name = "PlaytestError";
    }
}
//# sourceMappingURL=playtest-errors.js.map