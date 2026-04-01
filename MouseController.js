const { exec, execFile } = require('child_process');
const os = require('os');

class MouseController {
    constructor() {
        this.currentX = 0;
        this.currentY = 0;
        this.platform = os.platform(); // 'win32', 'darwin', etc.
        
        if (this.platform === 'win32') {
            const { spawn } = require('child_process');
            this.psProcess = spawn('powershell', ['-NoProfile', '-Command', '-']);
            this.psProcess.stdin.write('Add-Type -AssemblyName System.Windows.Forms\n');
            this.psProcess.stdin.write(`Add-Type -MemberDefinition '[DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, int dx, int dy, uint cButtons, uint dwExtraInfo); [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int vKey);' -Name Win32 -Namespace Native\n`);
        } else if (this.platform === 'darwin') {
            const { spawn } = require('child_process');
            const pyInit = `import sys, ctypes, time
CG = ctypes.cdll.LoadLibrary('/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics')
class CGPoint(ctypes.Structure): _fields_ = [("x", ctypes.c_double), ("y", ctypes.c_double)]
CG.CGEventCreateMouseEvent.argtypes = [ctypes.c_void_p, ctypes.c_uint32, CGPoint, ctypes.c_uint32]
CG.CGEventCreateMouseEvent.restype = ctypes.c_void_p
CG.CGEventPost.argtypes = [ctypes.c_uint32, ctypes.c_void_p]

for line in sys.stdin:
    parts = line.strip().split()
    if not parts: continue
    if parts[0] == 'move':
        x, y = float(parts[1]), float(parts[2])
        ev = CG.CGEventCreateMouseEvent(None, 5, CGPoint(x, y), 0)
        CG.CGEventPost(0, ev)
    elif parts[0] == 'click':
        x, y, downType, upType, mouseBtn = map(float, parts[1:])
        pos = CGPoint(x, y)
        CG.CGEventPost(0, CG.CGEventCreateMouseEvent(None, int(downType), pos, int(mouseBtn)))
        time.sleep(0.01)
        CG.CGEventPost(0, CG.CGEventCreateMouseEvent(None, int(upType), pos, int(mouseBtn)))
    elif parts[0] == 'isTabPressed':
        # Tab keycode on Mac is 48
        isDown = CG.CGEventSourceKeyState(0, 48)
        print("true" if isDown else "false")
`;
            this.pyProcess = spawn('python3', ['-u', '-c', pyInit]);
        }

        this.init();
    }

    async init() {
        try {
            const pos = await this.getMousePosition();
            this.currentX = pos.x;
            this.currentY = pos.y;
            console.log(`Initial Mouse Position (${this.platform}): ${this.currentX}, ${this.currentY}`);
        } catch (err) {
            console.error(`Error initializing mouse position on ${this.platform}:`, err.message);
        }
    }

    getMousePosition() {
        return new Promise((resolve, reject) => {
            if (this.platform === 'win32') {
                const cmd = `powershell -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Cursor]::Position.X; [System.Windows.Forms.Cursor]::Position.Y"`;
                exec(cmd, (err, stdout) => {
                    if (err) return reject(err);
                    const parts = stdout.trim().split(/\r?\n/);
                    resolve({ x: parseInt(parts[0]) || 0, y: parseInt(parts[1]) || 0 });
                });
            } else if (this.platform === 'darwin') {
                const pyScript = `import ctypes
try:
    CG = ctypes.cdll.LoadLibrary('/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics')
    class CGPoint(ctypes.Structure): _fields_ = [("x", ctypes.c_double), ("y", ctypes.c_double)]
    CG.CGEventCreate.restype = ctypes.c_void_p
    CG.CGEventGetLocation.restype = CGPoint
    loc = CG.CGEventGetLocation(ctypes.c_void_p(CG.CGEventCreate(None)))
    print(f"{int(loc.x)}\\n{int(loc.y)}")
except Exception:
    print("0\\n0")`;
                execFile('python3', ['-c', pyScript], (err, stdout) => {
                    if (err) return reject(err);
                    const parts = stdout.trim().split(/\r?\n/);
                    resolve({ x: parseInt(parts[0]) || 0, y: parseInt(parts[1]) || 0 });
                });
            } else {
                resolve({ x: 0, y: 0 });
            }
        });
    }

    moveMouse(x, y) {
        if (this.platform === 'win32') {
            if (this.psProcess && !this.psProcess.stdin.destroyed) {
                this.psProcess.stdin.write(`[System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${x}, ${y})\n`);
            } else {
                const cmd = `powershell -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${x}, ${y})"`;
                exec(cmd);
            }
        } else if (this.platform === 'darwin') {
            if (this.pyProcess && !this.pyProcess.stdin.destroyed) {
                this.pyProcess.stdin.write(`move ${x} ${y}\n`);
            } else {
                const pyScript = `import ctypes
CG = ctypes.cdll.LoadLibrary('/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics')
class CGPoint(ctypes.Structure): _fields_ = [("x", ctypes.c_double), ("y", ctypes.c_double)]
CG.CGEventCreateMouseEvent.argtypes = [ctypes.c_void_p, ctypes.c_uint32, CGPoint, ctypes.c_uint32]
CG.CGEventCreateMouseEvent.restype = ctypes.c_void_p
CG.CGEventPost.argtypes = [ctypes.c_uint32, ctypes.c_void_p]
ev = CG.CGEventCreateMouseEvent(None, 5, CGPoint(${x}, ${y}), 0)
CG.CGEventPost(0, ev)`;
                execFile('python3', ['-c', pyScript]);
            }
        }
        
        this.currentX = x;
        this.currentY = y;
    }

    moveRelative(dx, dy) {
        if (this.platform === 'win32') {
            if (this.psProcess && !this.psProcess.stdin.destroyed) {
                this.psProcess.stdin.write(`[Native.Win32]::mouse_event(1, ${dx}, ${dy}, 0, 0)\n`);
            } else {
                const cmd = `powershell -Command "Add-Type -MemberDefinition '[DllImport(\\"user32.dll\\")] public static extern void mouse_event(uint dwFlags, int dx, int dy, uint cButtons, uint dwExtraInfo);' -Name Win32 -Namespace Native; [Native.Win32]::mouse_event(1, ${dx}, ${dy}, 0, 0);"`;
                exec(cmd);
            }
        } else if (this.platform === 'darwin') {
            this.currentX += dx;
            this.currentY += dy;
            this.moveMouse(this.currentX, this.currentY);
        }
    }

    click(button = 'left') {
        console.log(`Mouse ${button} Click!`);
        if (this.platform === 'win32') {
            let downFlag = button === 'right' ? '0x08' : '0x02';
            let upFlag = button === 'right' ? '0x10' : '0x04';
            const cmd = `powershell -Command "Add-Type -MemberDefinition '[DllImport(\\"user32.dll\\")] public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint cButtons, uint dwExtraInfo);' -Name Win32 -Namespace Native; [Native.Win32]::mouse_event(${downFlag}, 0, 0, 0, 0); [Native.Win32]::mouse_event(${upFlag}, 0, 0, 0, 0);"`;
            exec(cmd);
        } else if (this.platform === 'darwin') {
            let downType = button === 'right' ? 3 : 1;
            let upType = button === 'right' ? 4 : 2;
            let mouseBtn = button === 'right' ? 1 : 0;
            
            if (this.pyProcess && !this.pyProcess.stdin.destroyed) {
                this.pyProcess.stdin.write(`click ${this.currentX} ${this.currentY} ${downType} ${upType} ${mouseBtn}\n`);
            } else {
                const pyScript = `import ctypes, time
CG = ctypes.cdll.LoadLibrary('/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics')
class CGPoint(ctypes.Structure): _fields_ = [("x", ctypes.c_double), ("y", ctypes.c_double)]
CG.CGEventCreateMouseEvent.argtypes = [ctypes.c_void_p, ctypes.c_uint32, CGPoint, ctypes.c_uint32]
CG.CGEventCreateMouseEvent.restype = ctypes.c_void_p
CG.CGEventPost.argtypes = [ctypes.c_uint32, ctypes.c_void_p]
pos = CGPoint(${this.currentX}, ${this.currentY})
CG.CGEventPost(0, CG.CGEventCreateMouseEvent(None, ${downType}, pos, ${mouseBtn}))
time.sleep(0.01)
CG.CGEventPost(0, CG.CGEventCreateMouseEvent(None, ${upType}, pos, ${mouseBtn}))`;
                execFile('python3', ['-c', pyScript]);
            }
        }
    }

    isTabPressed() {
        return new Promise((resolve) => {
            if (this.platform === 'win32') {
                if (this.psProcess && !this.psProcess.stdin.destroyed) {
                    // Check high bit of short (0x8000)
                    this.psProcess.stdin.write(`[Native.Win32]::GetAsyncKeyState(0x09) -band 0x8000\n`);
                    this.psProcess.stdout.once('data', (data) => {
                        const val = parseInt(data.toString().trim());
                        resolve(val !== 0);
                    });
                } else {
                    exec(`powershell -Command "[Native.Win32]::GetAsyncKeyState(0x09) -band 0x8000"`, (err, stdout) => {
                        resolve(stdout.trim() !== "0");
                    });
                }
            } else if (this.platform === 'darwin') {
                if (this.pyProcess && !this.pyProcess.stdin.destroyed) {
                    this.pyProcess.stdin.write(`isTabPressed\n`);
                    this.pyProcess.stdout.once('data', (data) => {
                        resolve(data.toString().trim() === "true");
                    });
                } else {
                    resolve(false);
                }
            } else {
                resolve(false);
            }
        });
    }
}

module.exports = MouseController;
