require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const CortexClient = require('./CortexClient');
const MouseController = require('./MouseController');

const fs = require('fs');

// Configuration
const PORT = process.env.PORT || 3000;
const MOVE_SPEED_DEFAULT = 20;
const CONFIG_PATH = path.join(__dirname, 'config.json');

function loadConfig() {
    let credentials = {
        clientId: process.env.EMOTIV_CLIENT_ID,
        clientSecret: process.env.EMOTIV_CLIENT_SECRET,
        appName: process.env.EMOTIV_APP_NAME || "MouseControlUI",
        appVersion: process.env.EMOTIV_APP_VERSION || "1.0.0",
        mappings: {
            moveUp: { type: 'com', action: 'push' },
            moveDown: { type: 'com', action: 'pull' },
            moveLeft: { type: 'com', action: 'left' },
            moveRight: { type: 'com', action: 'right' },
            leftClick: { type: 'fac', action: 'blink' },
            rightClick: { type: 'fac', action: 'clench' }
        }
    };

    if (fs.existsSync(CONFIG_PATH)) {
        try {
            const fileData = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
            credentials = { ...credentials, ...fileData };
            console.log("Loaded configuration from config.json");
        } catch (err) {
            console.error("Error reading config.json:", err.message);
        }
    }
    
    console.log("\n--- CREDENTIALS LOADED ---");
    console.log("Client ID:", credentials.clientId);
    console.log("Client Secret:", credentials.clientSecret);
    console.log("--------------------------\n");

    return credentials;
}

let config = loadConfig();

// State
let mouseControlEnabled = false;
let mouseControlMode = 'discrete'; // 'discrete' or 'joystick'
let moveSpeed = MOVE_SPEED_DEFAULT;
let mentalThreshold = 0.1;
let facialThreshold = 0.5;
let lastClickTime = 0;

// Initialize Server
const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// Initialize Controller & Client
const mouse = new MouseController();
let client = new CortexClient(config);

// Retry logic variables
let isConnecting = false;

function setupClient() {
    client.onEvent = (event) => {
        if (event.connection_closed) {
            console.log("Connection lost. Reconnecting in 5 seconds...");
            io.emit('headset-status', { connected: false, error: "Connection lost. Reconnecting..." });
            setTimeout(attemptConnection, 5000);
            return;
        }

        io.emit('emotiv-data', event);
        
        if (!mouseControlEnabled) return;
        const mappings = config.mappings || {};

        const executeMapping = async (key, power = 1.0) => {
            const isClick = key === 'leftClick' || key === 'rightClick';
            const now = Date.now();
            
            // System-wide Emergency Stop (Tab Check)
            const stopPressed = await mouse.isTabPressed();
            if (stopPressed) {
                mouseControlEnabled = false;
                io.emit('status-update', { mouseControlEnabled });
                console.log("--- SYSTEM EMERGENCY STOP: TAB PRESSED ---");
                return;
            }

            // Throttle Clicks to prevent spam
            if (isClick && (now - lastClickTime < 1000)) return;
            if (isClick) lastClickTime = now;

            // In joystick mode, speed is proportional to power
            const speed = (mouseControlMode === 'joystick' && !isClick) ? moveSpeed * power : moveSpeed;

            switch(key) {
                case 'moveUp': mouse.moveRelative(0, -speed); break;
                case 'moveDown': mouse.moveRelative(0, speed); break;
                case 'moveLeft': mouse.moveRelative(-speed, 0); break;
                case 'moveRight': mouse.moveRelative(speed, 0); break;
                case 'leftClick': mouse.click('left'); break;
                case 'rightClick': mouse.click('right'); break;
            }
        };

        if (event.com) {
            const action = event.com[0];
            const power = event.com[1];
            
            Object.entries(mappings).forEach(([key, mapping]) => {
                if (mapping.type === 'com' && mapping.action === action) {
                    const threshold = mapping.threshold !== undefined ? mapping.threshold : 0.1;
                    if (power > threshold) executeMapping(key, power);
                }
            });
        }

        if (event.fac) {
            const eyeAction = event.fac[0];
            const upperFaceAction = event.fac[1];
            const lowerFaceAction = event.fac[3];
            const lowerFacePower = event.fac[4];

            Object.entries(mappings).forEach(([key, mapping]) => {
                if (mapping.type === 'fac') {
                    let triggered = false;
                    if (mapping.action === eyeAction) triggered = true;
                    if (mapping.action === upperFaceAction) triggered = true;
                    if (mapping.action === lowerFaceAction) {
                        const threshold = mapping.threshold !== undefined ? mapping.threshold : 0.5;
                        if (lowerFacePower > threshold) triggered = true;
                    }

                    if (triggered) {
                        executeMapping(key, lowerFacePower || 1.0);
                    }
                }
            });
        }
    };
}

setupClient();

async function attemptConnection() {
    if (isConnecting) return;
    
    if (!config.clientId || !config.clientSecret) {
        console.log("No credentials found. Please configure them via the Dashboard.");
        io.emit('headset-status', { connected: false, error: "Please configure API credentials" });
        return;
    }

    isConnecting = true;
    io.emit('headset-status', { connected: false, error: "Connecting..." });
    
    try {
        let headset;
        try {
            headset = await client.initialize();
        } catch (e) {
            throw new Error("Initialize Failed: " + e.message);
        }
        
        console.log(`Connected to headset: ${headset.id}`);
        io.emit('headset-status', { connected: true, id: headset.id });
        
        try {
            await client.subscribe(['com', 'fac']);
        } catch (e) {
            throw new Error("Subscribe Failed: " + e.message);
        }
        
        isConnecting = false;
    } catch (err) {
        console.warn("\n=== EMOTIV ERROR DETECTED ===");
        console.warn(err.message);
        console.warn("=============================\n");
        io.emit('headset-status', { connected: false, error: err.message });
        isConnecting = false;
        setTimeout(attemptConnection, 5000);
    }
}

// UI Interactions
io.on('connection', (socket) => {
    console.log('UI Connected');
    socket.emit('status-update', { 
        mouseControlEnabled, 
        mouseControlMode,
        moveSpeed, 
        mentalThreshold,
        facialThreshold,
        hasConfig: !!(config.clientId && config.clientSecret),
        mappings: config.mappings 
    });

    socket.on('toggle-control', (enabled) => {
        mouseControlEnabled = enabled;
        io.emit('status-update', { mouseControlEnabled });
    });

    socket.on('toggle-mode', (mode) => {
        mouseControlMode = mode;
        io.emit('status-update', { mouseControlMode });
    });

    socket.on('update-speed', (val) => {
        moveSpeed = parseInt(val, 10) || MOVE_SPEED_DEFAULT;
        io.emit('status-update', { moveSpeed });
    });

    socket.on('update-mental-sensitivity', (val) => {
        mentalThreshold = parseFloat(val) || 0.1;
        io.emit('status-update', { mentalThreshold });
    });

    socket.on('update-facial-sensitivity', (val) => {
        facialThreshold = parseFloat(val) || 0.5;
        io.emit('status-update', { facialThreshold });
    });

    let lastSyncTime = 0;
    
    socket.on('test-move', (direction) => {
        if (direction === 'up') mouse.moveRelative(0, -moveSpeed);
        if (direction === 'down') mouse.moveRelative(0, moveSpeed);
        if (direction === 'left') mouse.moveRelative(-moveSpeed, 0);
        if (direction === 'right') mouse.moveRelative(moveSpeed, 0);
    });

    socket.on('save-mappings', (newMappings) => {
        console.log("Saving new mappings...");
        config.mappings = { ...config.mappings, ...newMappings };
        fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
        io.emit('status-update', { mappings: config.mappings });
    });

    socket.on('save-credentials', async (creds) => {
        console.log("Saving new credentials...");
        try {
            config.clientId = creds.clientId;
            config.clientSecret = creds.clientSecret;
            fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
            
            // Re-initialize client
            client = new CortexClient(config);
            setupClient();
            
            io.emit('status-update', { hasConfig: true });
            attemptConnection();
        } catch (err) {
            console.error("Re-initialization failed:", err.message);
            io.emit('headset-status', { connected: false, error: err.message });
        }
    });
});

async function start() {
    server.listen(PORT, () => {
        console.log(`\n--- Dashboard available at http://localhost:${PORT} ---`);
        if (process.send) {
            process.send('server-started');
        }
    });

    attemptConnection();
}

start();
