const WebSocket = require('ws');

class CortexClient {
    constructor(config) {
        this.config = config;
        this.socket = null;
        this.requestId = 1;
        this.authToken = null;
        this.sessionId = null;
        this.callbacks = {};
        this.onEvent = (event) => {}; // Callback to be overridden
    }

    connect() {
        return new Promise((resolve, reject) => {
            this.socket = new WebSocket('wss://localhost:6868', {
                rejectUnauthorized: false
            });
            
            this.socket.on('error', (error) => {
                reject(new Error("Cortex API connection failed. Is EMOTIV Launcher running?"));
            });

            this.socket.on('open', () => {
                resolve();
            });

            this.socket.on('message', (data) => {
                const message = JSON.parse(data);
                if (message.id && this.callbacks[message.id]) {
                    this.callbacks[message.id](message);
                    delete this.callbacks[message.id];
                } else if (message.sid) {
                    this.onEvent(message);
                }
            });
            
            this.socket.on('close', () => {
                this.onEvent({ connection_closed: true });
                this.socket = null;
            });
        });
    }

    sendRequest(method, params = {}) {
        return new Promise((resolve, reject) => {
            if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
                return reject(new Error("WebSocket is not connected."));
            }
            const id = this.requestId++;
            const msg = {
                jsonrpc: "2.0",
                method,
                params,
                id
            };
            this.callbacks[id] = (response) => {
                if (response.error) {
                    reject(response.error);
                } else {
                    resolve(response.result);
                }
            };
            this.socket.send(JSON.stringify(msg));
        });
    }

    async authenticate() {
        const accessResult = await this.sendRequest("requestAccess", {
            clientId: this.config.clientId,
            clientSecret: this.config.clientSecret
        });

        if (!accessResult.accessGranted) {
            throw new Error("Please open Emotiv Launcher and click 'Approve' to grant access.");
        }

        const result = await this.sendRequest("authorize", {
            clientId: this.config.clientId,
            clientSecret: this.config.clientSecret
        });
        this.authToken = result.cortexToken;
        return result;
    }

    async queryHeadsets() {
        return await this.sendRequest("queryHeadsets");
    }

    async createSession(headset) {
        const result = await this.sendRequest("createSession", {
            cortexToken: this.authToken,
            headset,
            status: "open"
        });
        this.sessionId = result.id;
        return result;
    }

    async subscribe(streams) {
        return await this.sendRequest("subscribe", {
            cortexToken: this.authToken,
            session: this.sessionId,
            streams
        });
    }

    async initialize() {
        await this.connect();
        await this.authenticate();
        const headsets = await this.queryHeadsets();
        if (headsets.length === 0) {
            throw new Error("No headset detected. Please connect your Emotiv headset.");
        }
        await this.createSession(headsets[0].id);
        return headsets[0];
    }
}

module.exports = CortexClient;
