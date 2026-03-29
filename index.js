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
let moveSpeed = MOVE_SPEED_DEFAULT;

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
        
        // Evaluate Mental Commands
        if (event.com) {
            const action = event.com[0];
            const power = event.com[1];
            if (power > 0.1) {
                if (mappings.moveUp?.type === 'com' && mappings.moveUp?.action === action) mouse.moveRelative(0, -moveSpeed);
                if (mappings.moveDown?.type === 'com' && mappings.moveDown?.action === action) mouse.moveRelative(0, moveSpeed);
                if (mappings.moveLeft?.type === 'com' && mappings.moveLeft?.action === action) mouse.moveRelative(-moveSpeed, 0);
                if (mappings.moveRight?.type === 'com' && mappings.moveRight?.action === action) mouse.moveRelative(moveSpeed, 0);
                if (mappings.leftClick?.type === 'com' && mappings.leftClick?.action === action) mouse.click('left');
                if (mappings.rightClick?.type === 'com' && mappings.rightClick?.action === action) mouse.click('right');
            }
        }
        
        // Evaluate Facial Expressions
        if (event.fac) {
            const eyeAction = event.fac[0];
            const upperFaceAction = event.fac[1];
            const lowerFaceAction = event.fac[2];
            const lowerFacePower = event.fac[3];

            const evalFac = (mapping) => {
                if (mapping?.type !== 'fac') return false;
                if (mapping.action === eyeAction) return true;
                if (mapping.action === upperFaceAction) return true;
                if (mapping.action === lowerFaceAction && lowerFacePower > 0.5) return true;
                return false;
            };

            if (evalFac(mappings.moveUp)) mouse.moveRelative(0, -moveSpeed);
            if (evalFac(mappings.moveDown)) mouse.moveRelative(0, moveSpeed);
            if (evalFac(mappings.moveLeft)) mouse.moveRelative(-moveSpeed, 0);
            if (evalFac(mappings.moveRight)) mouse.moveRelative(moveSpeed, 0);
            if (evalFac(mappings.leftClick)) mouse.click('left');
            if (evalFac(mappings.rightClick)) mouse.click('right');
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
        moveSpeed, 
        hasConfig: !!(config.clientId && config.clientSecret),
        mappings: config.mappings 
    });

    socket.on('toggle-control', (enabled) => {
        mouseControlEnabled = enabled;
        io.emit('status-update', { mouseControlEnabled });
    });

    socket.on('update-speed', (speed) => {
        moveSpeed = parseInt(speed) || MOVE_SPEED_DEFAULT;
        io.emit('status-update', { moveSpeed });
    });

    let lastSyncTime = 0;
    
    socket.on('test-move', async (direction) => {
        // Obtener la posición física una vez por cada "ráfaga" de movimientos
        // Si mantienes la tecla pulsada, usa la posición calculada sin latencia
        try {
            if (Date.now() - lastSyncTime > 1000) {
                const pos = await mouse.getMousePosition();
                mouse.currentX = pos.x;
                mouse.currentY = pos.y;
            }
        } catch (e) {
            console.error("Error syncing mouse:", e);
        }
        
        lastSyncTime = Date.now();

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
    });

    attemptConnection();
}

start();
