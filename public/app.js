const socket = io();

// UI Elements
const statusBadge = document.getElementById('connection-status');
const statusText = statusBadge.querySelector('.text');
const mouseToggle = document.getElementById('mouse-toggle');
const speedRange = document.getElementById('speed-range');
const speedValueDisplay = document.getElementById('speed-value');
const logContainer = document.getElementById('log-container');

// Config Modal Elements
const configModal = document.getElementById('config-modal');
const openConfigBtn = document.getElementById('open-config');
const closeConfigBtn = document.getElementById('close-config');
const saveConfigBtn = document.getElementById('save-config');
const clientIdInput = document.getElementById('client-id');
const clientSecretInput = document.getElementById('client-secret');

// Mapping Elements
const mappingSelects = {
    moveUp: document.getElementById('map-moveUp'),
    moveDown: document.getElementById('map-moveDown'),
    moveLeft: document.getElementById('map-moveLeft'),
    moveRight: document.getElementById('map-moveRight'),
    leftClick: document.getElementById('map-leftClick'),
    rightClick: document.getElementById('map-rightClick')
};

const emotivOptions = {
    // Mental Commands
    'com:push': 'Push (Mental)',
    'com:pull': 'Pull (Mental)',
    'com:left': 'Left (Mental)',
    'com:right': 'Right (Mental)',
    'com:lift': 'Lift (Mental)',
    'com:drop': 'Drop (Mental)',
    // Facial Expressions
    'fac:blink': 'Blink (Facial)',
    'fac:winkL': 'Left Wink (Facial)',
    'fac:winkR': 'Right Wink (Facial)',
    'fac:clench': 'Clench (Facial)',
    'fac:smile': 'Smile (Facial)',
    'fac:smirkLeft': 'Smirk Left (Facial)',
    'fac:smirkRight': 'Smirk Right (Facial)',
    'none:none': 'Disabled'
};

// Populate Mapping Selects
Object.values(mappingSelects).forEach(select => {
    Object.entries(emotivOptions).forEach(([val, label]) => {
        const opt = document.createElement('option');
        opt.value = val;
        opt.textContent = label;
        select.appendChild(opt);
    });
});

// Command Progress Bars
const commandBars = {
    push: document.querySelector('#cmd-push .progress-fill'),
    pull: document.querySelector('#cmd-pull .progress-fill'),
    left: document.querySelector('#cmd-left .progress-fill'),
    right: document.querySelector('#cmd-right .progress-fill')
};

// State
let lastLoggedAction = '';

// Socket Events
socket.on('emotiv-data', (data) => {
    // Handle Mental Commands
    if (data.com) {
        const action = data.com[0];
        const power = data.com[1];
        
        // Update Bars
        if (commandBars[action]) {
            commandBars[action].style.width = `${power * 100}%`;
        } else if (action === 'neutral') {
            // Reset all bars slightly if neutral
            Object.values(commandBars).forEach(bar => bar.style.width = '0%');
        }

        // Log if it's a significant action and changed
        if (power > 0.3 && action !== 'neutral' && action !== lastLoggedAction) {
            addLog(`Mental Command: ${action.toUpperCase()}`, 'command');
            lastLoggedAction = action;
        } else if (action === 'neutral') {
            lastLoggedAction = 'neutral';
        }
    }

    // Handle Facial Expressions
    if (data.fac) {
        const eyeAction = data.fac[0];
        const lowerFaceAction = data.fac[2];
        const lowerFacePower = data.fac[3];

        if (eyeAction === 'blink') {
            addLog('Gesture Detected: BLINK (Click)', 'gesture');
        } else if (lowerFaceAction === 'clench' && lowerFacePower > 0.5) {
            addLog('Gesture Detected: CLENCH (Click)', 'gesture');
        }
    }
});

socket.on('headset-status', (status) => {
    if (status.connected) {
        statusBadge.className = 'status-badge connected';
        statusText.textContent = `Headset Connected: ${status.id.substring(0, 10)}...`;
        addLog(`System: Headset connected (${status.id})`, 'system');
    } else {
        statusBadge.className = 'status-badge disconnected';
        statusText.textContent = status.error || 'Headset Disconnected';
        addLog(`System Error: ${status.error || 'Connection lost'}`, 'system');
    }
});

socket.on('status-update', (state) => {
    if (state.mouseControlEnabled !== undefined) {
        mouseToggle.checked = state.mouseControlEnabled;
    }
    if (state.moveSpeed !== undefined) {
        speedRange.value = state.moveSpeed;
        speedValueDisplay.textContent = `${state.moveSpeed}px`;
    }
    if (state.hasConfig === false) {
        configModal.classList.remove('hidden');
        addLog("System: Please configure API credentials to begin.", "system");
    }
    if (state.mappings) {
        Object.entries(state.mappings).forEach(([actionKey, mapping]) => {
            if (mappingSelects[actionKey]) {
                const val = `${mapping.type}:${mapping.action}`;
                mappingSelects[actionKey].value = val;
            }
        });
    }
});

// UI Event Listeners
openConfigBtn.addEventListener('click', () => {
    configModal.classList.remove('hidden');
});

closeConfigBtn.addEventListener('click', () => {
    configModal.classList.add('hidden');
});

saveConfigBtn.addEventListener('click', () => {
    const clientId = clientIdInput.value.trim();
    const clientSecret = clientSecretInput.value.trim();

    if (!clientId || !clientSecret) {
        alert("Both Client ID and Client Secret are required.");
        return;
    }

    socket.emit('save-credentials', { clientId, clientSecret });
    configModal.classList.add('hidden');
    addLog("System: Saving credentials and attempting to connect...", "system");
});

document.getElementById('save-mappings-btn').addEventListener('click', () => {
    const newMappings = {};
    Object.entries(mappingSelects).forEach(([actionKey, select]) => {
        const [type, action] = select.value.split(':');
        newMappings[actionKey] = { type, action };
    });
    socket.emit('save-mappings', newMappings);
    addLog("System: Checking and saving new command mappings...", "system");
});

mouseToggle.addEventListener('change', (e) => {
    socket.emit('toggle-control', e.target.checked);
});

speedRange.addEventListener('input', (e) => {
    speedValueDisplay.textContent = `${e.target.value}px`;
});

speedRange.addEventListener('change', (e) => {
    socket.emit('update-speed', e.target.value);
});

// Test Panel Arrows Logic
const arrowBtns = {
    ArrowUp: document.getElementById('btn-up'),
    ArrowDown: document.getElementById('btn-down'),
    ArrowLeft: document.getElementById('btn-left'),
    ArrowRight: document.getElementById('btn-right')
};

function emitMove(direction) {
    socket.emit('test-move', direction);
}

if (arrowBtns.ArrowUp) {
    arrowBtns.ArrowUp.addEventListener('click', () => emitMove('up'));
    arrowBtns.ArrowDown.addEventListener('click', () => emitMove('down'));
    arrowBtns.ArrowLeft.addEventListener('click', () => emitMove('left'));
    arrowBtns.ArrowRight.addEventListener('click', () => emitMove('right'));

    window.addEventListener('keydown', (e) => {
        if (arrowBtns[e.key]) {
            e.preventDefault();
            arrowBtns[e.key].classList.add('active');
            const dir = e.key.replace('Arrow', '').toLowerCase();
            emitMove(dir);
        }
    });

    window.addEventListener('keyup', (e) => {
        if (arrowBtns[e.key]) {
            arrowBtns[e.key].classList.remove('active');
        }
    });
}

// Helper Functions
function addLog(message, type = 'system') {
    const entry = document.createElement('div');
    entry.className = `log-entry ${type}`;
    const time = new Date().toLocaleTimeString();
    entry.textContent = `[${time}] ${message}`;
    
    logContainer.prepend(entry);

    // Maintain max logs
    if (logContainer.children.length > 50) {
        logContainer.lastElementChild.remove();
    }
}
