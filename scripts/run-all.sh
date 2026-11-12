#!/usr/bin/env bash
set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$SCRIPT_DIR/../backend"
FRONTEND_DIR="$SCRIPT_DIR/../frontend"

# Find a working Python. On Windows we want a Windows Python (sys.platform == win32),
# not a WSL python3 that may lack ensurepip.
find_python() {
  local c
  for c in py python python3; do
    if command -v "$c" >/dev/null 2>&1; then
      if "$c" -c "import sys; sys.exit(0 if sys.platform == 'win32' else 1)" >/dev/null 2>&1; then
        echo "$c"
        return 0
      fi
    fi
  done

  # Fall back to any Python that can run
  for c in py python python3; do
    if command -v "$c" >/dev/null 2>&1; then
      if "$c" --version >/dev/null 2>&1; then
        echo "$c"
        return 0
      fi
    fi
  done

  # Last resort: ask PowerShell where python is
  if command -v powershell.exe >/dev/null 2>&1; then
    local winpy
    winpy=$(powershell.exe -NoProfile -Command "(Get-Command python).Source" 2>/dev/null | tr -d '\r')
    if [ -n "$winpy" ] && [ -f "$winpy" ]; then
      echo "$winpy"
      return 0
    fi
  fi

  return 1
}

PYTHON=$(find_python) || {
  echo "Error: Could not find a working Python interpreter."
  echo "Please install Python for Windows and make sure 'python' or 'py' is available."
  exit 1
}
echo "Using Python: $PYTHON"

start_backend() {
  echo "=== Starting Backend ==="
  cd "$BACKEND_DIR"

  # If a previous venv creation failed half-way, remove it
  if [ -d .venv ] && [ ! -f .venv/Scripts/activate ] && [ ! -f .venv/bin/activate ]; then
    echo "Removing incomplete virtual environment..."
    rm -rf .venv
  fi

  if [ ! -d .venv ]; then
    echo "Creating backend virtual environment..."
    "$PYTHON" -m venv .venv
  fi

  if [ -f .venv/Scripts/activate ]; then
    source .venv/Scripts/activate
  else
    source .venv/bin/activate
  fi

  pip install -r requirements.txt >/dev/null 2>&1
  uvicorn app.main:app --reload --host 0.0.0.0 --port 8000 &
  BACKEND_PID=$!
}

start_frontend() {
  echo "=== Starting Frontend ==="
  cd "$FRONTEND_DIR"
  if [ ! -d node_modules ]; then
    npm ci >/dev/null 2>&1
  fi
  npm run dev &
  FRONTEND_PID=$!
}

start_backend
start_frontend

echo "Both servers are running."
echo "Backend: http://localhost:8000"
echo "Frontend: http://localhost:3000 (or http://localhost:3001)"

wait
