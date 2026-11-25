[CmdletBinding()]
param([switch]$Rebuild, [switch]$BuildOnly)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

function Get-BuildFile {
    param([string]$Uri, [string]$Destination)
    if (Test-Path -LiteralPath $Destination -PathType Leaf) { return }
    Write-Host "Downloading $(Split-Path -Leaf $Destination)..."
    $Partial = "$Destination.part"
    Invoke-WebRequest -UseBasicParsing -Uri $Uri -OutFile $Partial
    Move-Item -LiteralPath $Partial -Destination $Destination -Force
}

function Update-HttpHeaderForMinGW {
    param([string]$Path)
    $Original = [IO.File]::ReadAllText($Path)
    $HeaderText = $Original
    $HeaderText = $HeaderText -creplace '::CreateFile2\(wpath\.c_str\(\),\s*GENERIC_READ,\s*FILE_SHARE_READ,\s*OPEN_EXISTING,\s*NULL\)', '::CreateFileW(wpath.c_str(), GENERIC_READ, FILE_SHARE_READ, nullptr, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, nullptr)'
    $HeaderText = $HeaderText -creplace '::CreateFileMappingFromApp\(hFile_, NULL, PAGE_READONLY, size_, NULL\)', '::CreateFileMappingW(hFile_, nullptr, PAGE_READONLY, 0, 0, nullptr)'
    $HeaderText = $HeaderText -creplace '::MapViewOfFileFromApp\(hMapping_, FILE_MAP_READ, 0, 0\)', '::MapViewOfFile(hMapping_, FILE_MAP_READ, 0, 0, 0)'
    if ($HeaderText -cne $Original) {
        $Pending = "$Path.prepindex.part"
        [IO.File]::WriteAllText($Pending, $HeaderText)
        Move-Item -LiteralPath $Pending -Destination $Path -Force
    }
}

function Invoke-Compiler {
    param([string]$Compiler, [string[]]$CompilerArgs)
    & $Compiler @CompilerArgs
    if ($LASTEXITCODE -ne 0) { throw "$(Split-Path -Leaf $Compiler) failed (exit $LASTEXITCODE)." }
}

Push-Location -LiteralPath $PSScriptRoot
try {
    if ($Rebuild -or -not (Test-Path -LiteralPath '.\db.exe' -PathType Leaf)) {
        $Architecture = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString()
        if ($Architecture -ne 'X64') {
            throw "This build launcher expects x64 Windows. Detected: $Architecture."
        }

        $BuildDir = Join-Path $PSScriptRoot '.build'
        $Assets = Join-Path $PSScriptRoot 'prep-assets'
        New-Item -ItemType Directory -Path $BuildDir, $Assets -Force | Out-Null

        $Tag = '16.2.0posix-14.0.0-ucrt-r2'
        $WinLibsFile = 'winlibs-x86_64-posix-seh-gcc-16.2.0-mingw-w64ucrt-14.0.0-r2.zip'
        $WinLibsUri = "https://github.com/brechtsanders/winlibs_mingw/releases/download/$Tag/$WinLibsFile"
        $ToolchainDir = Join-Path $BuildDir $Tag
        $Bin = Join-Path $ToolchainDir 'mingw64\bin'
        $ToolchainReady = Join-Path $ToolchainDir '.extracted'
        if (-not (Test-Path -LiteralPath $ToolchainReady -PathType Leaf)) {
            $ToolchainZip = Join-Path $BuildDir $WinLibsFile
            Get-BuildFile $WinLibsUri $ToolchainZip
            Write-Host 'Extracting the portable compiler...'
            Expand-Archive -LiteralPath $ToolchainZip -DestinationPath $ToolchainDir -Force
            New-Item -ItemType File -Path $ToolchainReady -Force | Out-Null
        }
        $CC = Join-Path $Bin 'gcc.exe'
        $CXX = Join-Path $Bin 'g++.exe'
        if (-not (Test-Path -LiteralPath $CC -PathType Leaf) -or -not (Test-Path -LiteralPath $CXX -PathType Leaf)) {
            throw "The portable compiler archive did not contain mingw64\bin. Check $ToolchainDir."
        }

        $SQLiteRelease = '3540100'
        $SQLiteZip = Join-Path $BuildDir "sqlite-amalgamation-$SQLiteRelease.zip"
        $SQLiteDir = Join-Path $BuildDir "sqlite-amalgamation-$SQLiteRelease"
        $SQLiteSource = Join-Path $SQLiteDir 'sqlite3.c'
        $SQLiteHeader = Join-Path $SQLiteDir 'sqlite3.h'
        if (-not (Test-Path -LiteralPath $SQLiteSource -PathType Leaf) -or -not (Test-Path -LiteralPath $SQLiteHeader -PathType Leaf)) {
            Get-BuildFile "https://www.sqlite.org/2026/sqlite-amalgamation-$SQLiteRelease.zip" $SQLiteZip
            Expand-Archive -LiteralPath $SQLiteZip -DestinationPath $BuildDir -Force
        }

        $HttpSource = 'https://raw.githubusercontent.com/yhirose/cpp-httplib/v0.42.0'
        $HttpHeader = Join-Path $PSScriptRoot 'httplib.h'
        Get-BuildFile "$HttpSource/httplib.h" $HttpHeader
        Update-HttpHeaderForMinGW $HttpHeader
        Get-BuildFile "$HttpSource/LICENSE" (Join-Path $PSScriptRoot 'THIRD_PARTY_CPP_HTTPLIB.txt')

        $PdfSource = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.5.438'
        foreach ($Module in @('pdf.mjs', 'pdf.worker.mjs')) {
            Get-BuildFile "$PdfSource/build/$Module" (Join-Path $Assets $Module)
        }
        Get-BuildFile "$PdfSource/LICENSE" (Join-Path $Assets 'LICENSE')

        $SQLiteObject = Join-Path $BuildDir 'sqlite3.o'
        if ($Rebuild -or -not (Test-Path -LiteralPath $SQLiteObject -PathType Leaf)) {
            Write-Host 'Compiling SQLite with full-text search...'
            $PendingObject = Join-Path $BuildDir 'sqlite3.pending.o'
            Invoke-Compiler $CC @('-O2', '-DSQLITE_ENABLE_FTS5', '-DSQLITE_OMIT_LOAD_EXTENSION', '-c', $SQLiteSource, '-o', $PendingObject)
            Move-Item -LiteralPath $PendingObject -Destination $SQLiteObject -Force
        }

        Write-Host 'Compiling PrepIndex...'
        $PendingExe = Join-Path $BuildDir 'prepindex.pending.exe'
        Invoke-Compiler $CXX @('-std=c++17', '-O2', '-static', '-I', $SQLiteDir, 'main.cpp', $SQLiteObject, '-o', $PendingExe, '-lws2_32', '-lcrypt32')
        Move-Item -LiteralPath $PendingExe -Destination '.\db.exe' -Force
    }

    if ($BuildOnly) { return }
    Write-Host 'Open http://localhost:8080 after the server starts. Press Ctrl+C to stop it.'
    & '.\db.exe'
    if ($LASTEXITCODE -ne 0) { throw "PrepIndex exited with code $LASTEXITCODE." }
} finally {
    Pop-Location
}
