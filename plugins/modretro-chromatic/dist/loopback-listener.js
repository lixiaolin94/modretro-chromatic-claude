/** Reuse only an instance's positively closed port; never inspect or disturb its new owner. */
export async function listenLoopback(server, closedPort) {
    const listen = (port) => new Promise((resolve, reject) => {
        const ready = () => { server.off("error", failed); resolve(); };
        const failed = (error) => { server.off("error", failed); server.off("listening", ready); reject(error); };
        server.once("error", failed);
        try {
            server.listen(port, "127.0.0.1", ready);
        }
        catch (error) {
            failed(error);
        }
    });
    try {
        await listen(closedPort ?? 0);
    }
    catch (error) {
        if (closedPort === undefined || error.code !== "EADDRINUSE")
            throw error;
        await listen(0);
    }
}
//# sourceMappingURL=loopback-listener.js.map