#!/usr/bin/env bash
# Exit on error
set -o errexit

echo "==> Starting Render Build for Sodo Player Backend..."

python -m pip install --upgrade pip

if [ -f "requirements.txt" ]; then
    python -m pip install -r requirements.txt
    TARGET_BIN="bin"
elif [ -f "backend/requirements.txt" ]; then
    python -m pip install -r backend/requirements.txt
    TARGET_BIN="backend/bin"
else
    echo "Error: requirements.txt not found!"
    exit 1
fi

# Ensure FFmpeg is available
if command -v ffmpeg >/dev/null 2>&1; then
    echo "==> System FFmpeg detected at $(command -v ffmpeg)"
else
    echo "==> FFmpeg not found in system PATH. Installing static FFmpeg binary for Linux..."
    mkdir -p "$TARGET_BIN"
    if [ ! -f "$TARGET_BIN/ffmpeg" ]; then
        curl -L https://github.com/eugeneware/ffmpeg-static/releases/latest/download/linux-x64 -o "$TARGET_BIN/ffmpeg"
        chmod +x "$TARGET_BIN/ffmpeg"
        echo "==> Static FFmpeg binary installed to $TARGET_BIN/ffmpeg"
    fi
fi

echo "==> Render build completed successfully!"
