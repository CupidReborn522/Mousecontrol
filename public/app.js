const socket = io();

// UI Elements
const statusBadge = document.getElementById('connection-status');
const statusText = statusBadge.querySelector('.text');
const mouseToggle = document.getElementById('mouse-toggle');
const speedRange = document.getElementById('speed-range');
const speedValueDisplay = document.getElementById('speed-value');
const modeToggle = document.getElementById('mode-toggle');
const joyKnob = document.getElementById('joy-knob');
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

const mappingThresholds = {
    moveUp: document.getElementById('thresh-moveUp'),
    moveDown: document.getElementById('thresh-moveDown'),
    moveLeft: document.getElementById('thresh-moveLeft'),
    moveRight: document.getElementById('thresh-moveRight'),
    leftClick: document.getElementById('thresh-leftClick'),
    rightClick: document.getElementById('thresh-rightClick')
};

const mappingThreshVals = {
    moveUp: document.getElementById('val-moveUp'),
    moveDown: document.getElementById('val-moveDown'),
    moveLeft: document.getElementById('val-moveLeft'),
    moveRight: document.getElementById('val-moveRight'),
    leftClick: document.getElementById('val-leftClick'),
    rightClick: document.getElementById('val-rightClick')
};

// Bind range values to spans and auto-save
Object.keys(mappingThresholds).forEach(key => {
    mappingThresholds[key].addEventListener('input', (e) => {
        mappingThreshVals[key].textContent = `${e.target.value}%`;
    });
    // Auto-save when slider is released
    mappingThresholds[key].addEventListener('change', () => {
        document.getElementById('save-mappings-btn').click();
    });
});

// Auto-save on dropdown change too
Object.values(mappingSelects).forEach(select => {
    select.addEventListener('change', () => {
        document.getElementById('save-mappings-btn').click();
    });
});

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

let localMappings = {};

const actionBars = {
    moveUp: document.getElementById('bar-moveUp'),
    moveDown: document.getElementById('bar-moveDown'),
    moveLeft: document.getElementById('bar-moveLeft'),
    moveRight: document.getElementById('bar-moveRight'),
    leftClick: document.getElementById('bar-leftClick'),
    rightClick: document.getElementById('bar-rightClick')
};

// State
let lastLoggedAction = '';

let frameValues = {
    moveUp: 0, moveDown: 0, moveLeft: 0, moveRight: 0, leftClick: 0, rightClick: 0
};

// Data Streaming
socket.on('emotiv-data', (data) => {
    let logMsg = "";
    
    // Decay old values gradually to smooth transitions
    Object.keys(frameValues).forEach(k => {
        frameValues[k] = Math.max(0, frameValues[k] - 0.05);
    });

    if (data.com) {
        const action = data.com[0];
        const power = data.com[1];
        
        if (action !== 'neutral' && power > 0.05 && action !== lastLoggedAction) {
            logMsg = `Thought: ${action} (${Math.round(power*100)}%)`;
            addLog(logMsg, "command");
            lastLoggedAction = action;
        } else if (action === 'neutral') {
            lastLoggedAction = '';
        }

        Object.entries(localMappings).forEach(([key, mapping]) => {
            if (mapping.type === 'com' && mapping.action === action) {
                frameValues[key] = power;
            }
        });
    }

    if (data.fac) {
        const eye = data.fac[0];
        const upper = data.fac[1];
        const lower = data.fac[3];
        const lowerPower = data.fac[4];

        let gestures = [];
        if (eye !== 'neutral') gestures.push(eye);
        if (upper !== 'neutral') gestures.push(upper);
        if (lower !== 'neutral') gestures.push(`${lower} (${Math.round(lowerPower*100)}%)`);

        if (gestures.length > 0) {
            logMsg = `Face: ${gestures.join(', ')}`;
            addLog(logMsg, "gesture");
        }

        Object.entries(localMappings).forEach(([key, mapping]) => {
            if (mapping.type === 'fac') {
                if (mapping.action === eye) frameValues[key] = Math.max(frameValues[key], eye !== 'neutral' ? 1.0 : 0);
                else if (mapping.action === upper) frameValues[key] = Math.max(frameValues[key], upper !== 'neutral' ? 1.0 : 0);
                else if (mapping.action === lower) frameValues[key] = Math.max(frameValues[key], lower !== 'neutral' ? lowerPower : 0);
            }
        });
    }

    // Update UI progress bars
    Object.entries(actionBars).forEach(([key, el]) => {
        if (el) {
            const percent = Math.round(frameValues[key] * 100);
            el.style.width = `${percent}%`;
            el.textContent = `${percent}%`; // Always show text!
        }
    });

    // Update Virtual Joystick visuals
    if (joyKnob) {
        const maxX = 70; // Half of base minus half of knob
        const maxY = 70;
        const x = (frameValues.moveRight - frameValues.moveLeft) * maxX;
        const y = (frameValues.moveDown - frameValues.moveUp) * maxY;
        joyKnob.style.transform = `translate(${x}px, ${y}px)`;
        
        // Add glow if actively moving
        const intensity = Math.max(frameValues.moveUp, frameValues.moveDown, frameValues.moveLeft, frameValues.moveRight);
        joyKnob.style.boxShadow = `0 0 ${15 + intensity * 20}px var(--accent-magenta)`;
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
    if (state.mouseControlMode !== undefined) {
        modeToggle.checked = (state.mouseControlMode === 'joystick');
    }
    if (state.hasConfig === false) {
        configModal.classList.remove('hidden');
        addLog("System: Please configure API credentials to begin.", "system");
    }
    if (state.mappings) {
        localMappings = state.mappings;
        
        const baseNames = {
            moveUp: 'Move Up ▲',
            moveDown: 'Move Down ▼',
            moveLeft: 'Move Left ◀',
            moveRight: 'Move Right ▶',
            leftClick: 'Left Click 🖱️',
            rightClick: 'Right Click 🖱️'
        };

        Object.entries(state.mappings).forEach(([actionKey, mapping]) => {
            if (mappingSelects[actionKey]) {
                const val = `${mapping.type}:${mapping.action}`;
                mappingSelects[actionKey].value = val;
                
                // Update Mapped Action Intensity Labels
                const actionLabelEl = document.querySelector(`#act-${actionKey} label`);
                if (actionLabelEl) {
                    const emotivName = emotivOptions[val] || 'Unmapped';
                    actionLabelEl.textContent = `${baseNames[actionKey]} [${emotivName}]`;
                }
            }
            if (mappingThresholds[actionKey] && mapping.threshold !== undefined) {
                const percent = Math.round(mapping.threshold * 100);
                mappingThresholds[actionKey].value = percent;
                mappingThreshVals[actionKey].textContent = `${percent}%`;
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
        const threshold = mappingThresholds[actionKey] ? parseInt(mappingThresholds[actionKey].value, 10) / 100 : 0.5;
        newMappings[actionKey] = { type, action, threshold };
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

modeToggle.addEventListener('change', (e) => {
    const mode = e.target.checked ? 'joystick' : 'discrete';
    socket.emit('toggle-mode', mode);
    addLog(`System: Switched to ${mode.toUpperCase()} mode`, 'system');
});

// Emergency Stop with TAB key
window.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
        e.preventDefault(); // Prevent focus switching
        if (mouseToggle.checked) {
            mouseToggle.checked = false;
            socket.emit('toggle-control', false);
            addLog("System: Emergency Stop (TAB pressed)", "system");
        }
    }
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
