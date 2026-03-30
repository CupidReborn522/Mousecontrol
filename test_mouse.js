const { spawn } = require('child_process');

const ps = spawn('powershell', ['-NoProfile', '-Command', '-']);

ps.stderr.on('data', d => console.error("ERR:", d.toString()));
ps.stdout.on('data', d => console.log("OUT:", d.toString()));

ps.stdin.write("Add-Type -AssemblyName System.Windows.Forms\n");

// Test absolute movement
ps.stdin.write("[System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(500, 500)\n");

setTimeout(() => {
    ps.stdin.write("[System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(600, 600)\n");
}, 1000);

setTimeout(() => {
    ps.kill();
}, 2000);
