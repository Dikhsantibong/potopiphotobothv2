import { NextResponse } from 'next/server';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export async function GET() {
    try {
        // List printers on Windows using PowerShell
        // This command returns printer names separated by newlines
        const command = 'powershell "Get-Printer | Select-Object -ExpandProperty Name"';
        const { stdout, stderr } = await execAsync(command);

        if (stderr) {
            console.error('Printers stderr:', stderr);
        }

        const printers = stdout
            .split(/\r?\n/)
            .map(line => line.trim())
            .filter(line => line.length > 0);

        return NextResponse.json({ success: true, data: printers });
    } catch (error) {
        console.error('Failed to get printers:', error);
        
        // Fallback for non-windows or errors: return empty list
        return NextResponse.json({ 
            success: false, 
            message: 'Failed to detect printers', 
            data: [] 
        }, { status: 500 });
    }
}
